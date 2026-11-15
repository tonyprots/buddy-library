"""Export an allowlisted local delivery without publishing or overwriting files."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED = {
    "tests/browser/deck-integration-check.mjs",
    "tests/browser/transition-browser-check.mjs",
}
FORBIDDEN = {".git", ".memory", "PROJECT.md", "drafts", "node_modules", ".DS_Store"}
PRIVATE_TERMS = json.loads(os.environ.get("BUDDY_EXPORT_PRIVATE_TERMS", "[]"))
if not isinstance(PRIVATE_TERMS, list) or any(not isinstance(term, str) or not term for term in PRIVATE_TERMS):
    raise ValueError("BUDDY_EXPORT_PRIVATE_TERMS: expected a JSON array of nonempty strings")


def collect(entries):
    files = {}
    for entry in entries:
        path = ROOT / entry
        if not path.exists():
            raise ValueError(f"Missing delivery file: {entry}")
        paths = sorted(path.rglob("*")) if path.is_dir() else [path]
        for file in paths:
            name = file.relative_to(ROOT).as_posix()
            if name in EXCLUDED:
                continue
            if file.is_symlink() or FORBIDDEN.intersection(file.relative_to(ROOT).parts):
                raise ValueError(f"Private file or symlink in delivery: {name}")
            if file.is_file():
                data = file.read_bytes()
                if file.suffix in {".js", ".mjs", ".ts", ".md", ".json", ".html", ".yml"}:
                    if re.search(rb"/Users/|/home/[^/]+/", data) or any(term.encode() in data for term in PRIVATE_TERMS):
                        raise ValueError(f"Private path or prohibited term in delivery: {name}")
                files[name] = data
    return files


def write_delivery(output, name, files):
    folder = output / name
    archive = output / (name + ".zip")
    if folder.exists() or archive.exists():
        raise FileExistsError(f"Delivery already exists: {name}. Choose a new directory.")
    manifest = {path: hashlib.sha256(data).hexdigest() for path, data in sorted(files.items())}
    files = {**files, "manifest.sha256.json": (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()}
    folder.mkdir(parents=True)
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path, data in sorted(files.items()):
            target = folder / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            info = zipfile.ZipInfo(f"{name}/{path}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, data)
    # Verify archive bytes as well as the planned file list.
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        assert set(bundle.namelist()) == {f"{name}/{path}" for path in files}
        for path, data in files.items():
            assert bundle.read(f"{name}/{path}") == data
    return {"archive": archive.name, "files": len(files),
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: npm run export -- /path/to/new-directory")
    output = Path(sys.argv[1]).resolve()
    package = json.loads((ROOT / "package.json").read_text())
    version = package["version"]
    assert re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version)
    assert f"@tony-prots/buddy {version} ".encode() in (ROOT / "dist/buddy.js").read_bytes()[:300], "Run npm run build first"
    source = collect(package["files"] + [
        "package.json", "CONTRIBUTING.md", ".gitignore", ".github/workflows/ci.yml",
        "scripts", "tests", "docs/dev",
    ])
    web = collect([
        "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md",
        "llms.txt", "docs/api.md", "docs/agent-integration.md", "docs/slide-context.md",
        "docs/slide-reactions.md", "docs/slide-intelligence.md", "docs/buddy-preview.png", "docs/media",
        "examples/quick-start.html", "examples/brand.html", "examples/showcase.html",
    ])
    web["buddy.js"] = source["dist/buddy.js"]
    web["llms.txt"] = web["llms.txt"].replace(b"dist/buddy.js", b"buddy.js")
    web["README.md"] = web["README.md"].replace(b"](dist/buddy.js)", b"](buddy.js)")
    for example in ["examples/quick-start.html", "examples/brand.html", "examples/showcase.html"]:
        web[example] = web[example].replace(b"../dist/buddy.js", b"../buddy.js")
    web["CONTRIBUTING.md"] = ("# Contributing\n\nThis archive is for integration. "
        "Sources, build tools and checks are in buddy-" + version + "-source.zip.\n"
        "To add Buddy to a presentation, use the [agent guide](docs/agent-integration.md).\n").encode()
    output.mkdir(parents=True, exist_ok=True)
    names = [f"buddy-{version}-web", f"buddy-{version}-source"]
    for name in names:
        if (output / name).exists() or (output / (name + ".zip")).exists():
            raise FileExistsError(f"Choose a new output directory: {output}")
    results = [write_delivery(output, name, files) for name, files in zip(names, [web, source])]
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
