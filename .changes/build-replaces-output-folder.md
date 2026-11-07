- Repository: the build writes a new output folder and puts it in place of the old one once every
  step has succeeded, so a part or preset the source no longer has can't stay in `dist/` (and ship
  with a release) or in the test build, and a failed build leaves the folder as it was. It refuses
  an `--out` folder that holds files a build doesn't write. The docs' part sizes are tested against
  the built parts.
