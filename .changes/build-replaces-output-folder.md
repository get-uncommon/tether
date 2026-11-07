- Repository: the build writes a new output folder and puts it in place of the old one only once
  every step has succeeded, moving the old one aside first and back when the new one can't take its
  place, so a failed build leaves `dist/` as it was. It refuses an `--out` folder that holds files a
  build doesn't write.
