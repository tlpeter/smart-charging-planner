# Release notes

One file per stable version: `vX.Y.Z.md`. It is written during "uitbrengen X.Y.Z" and is part of the release commit on `main`. When the tests on `main` pass for a new stable version, `.github/workflows/release.yml` creates the tag `vX.Y.Z` and the GitHub release with this file as its notes and the release zip as its asset, and closes the milestone `X.Y.Z`.

What goes in the file is described in `AGENTS.md › GitHub releases`. `v0.34.0.md` is the first one and shows the layout.
