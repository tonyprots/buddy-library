"""Compare TGZ contents with the package allowlist and current source files."""
import json
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / "package.json").read_text())
expected = {}
for entry in package["files"] + ["package.json"]:
    path = root / entry
    for file in sorted(path.rglob("*")) if path.is_dir() else [path]:
        if file.is_file():
            assert not file.is_symlink(), file
            expected["package/" + file.relative_to(root).as_posix()] = file.read_bytes()
with tarfile.open(sys.argv[1], "r:gz") as archive:
    members = [member for member in archive.getmembers() if not member.isdir()]
    assert len(members) == len(expected), "TGZ file count mismatch"
    assert {member.name for member in members} == set(expected), "TGZ file list mismatch"
    for member in members:
        assert member.isfile(), member.name
        assert archive.extractfile(member).read() == expected[member.name], member.name
print(f"TGZ {package['version']}: {len(expected)} files match the source tree")
