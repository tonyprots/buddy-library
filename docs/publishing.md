# Publishing

Repository: https://github.com/tonyprots/buddy-library.
Author: Anton Protsenko. The package name remains `@tony-prots/buddy`;
the npm scope and GitHub account intentionally differ.

## Repository page

About:

> An animated 3D companion for HTML presentations. One local script, autonomous tricks and slide reactions. No server required.

Topics: html-presentation, presentation, javascript, animation, threejs, webgl,
mascot, offline. These describe the project; they do not promise search ranking.

README links to the ready bundle, examples, Releases and the agent integration
guide. There is no hosted Pages demo; do not add an unverified demo URL.

## Release workflow

1. Update the version, changelog and package metadata. Keep source history free
   of private notes; use the allowlisted export when working from a private tree.
2. Build, run the appropriate checks and pack. Export web/source ZIPs to a new
   directory. Never overwrite an existing release's files.
3. Commit the public tree and wait for GitHub Actions to pass.
4. Create a version tag and GitHub Release containing buddy-X.Y.Z-web.zip,
   buddy-X.Y.Z-source.zip, tony-prots-buddy-X.Y.Z.tgz and checksums-X.Y.Z.json.
5. Download every asset without authentication, verify SHA-256 and check the
   downloaded web example in a browser.

manifest.sha256.json describes an export, not the working source tree; it belongs
in ZIPs and is ignored by git. npm publication is separate and has not been enabled.
Do not advertise registry installation until that publication actually exists.

## Discovery

GitHub searches repository names, descriptions, topics and README with `in:readme`.
Npm uses description and keywords. llms.txt is navigation for coding agents,
not a guarantee of search ranking or automatic agent discovery.

References: [GitHub repository search](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories),
[topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics),
[npm package fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
