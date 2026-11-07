- Repository: the next release's notes are one file per change in `.changes/` instead of a shared
  `## Unreleased` list in `CHANGELOG.md`, so merging a release into an open branch can't move the
  branch's notes into the released section. The release writes them as its section and deletes them.
