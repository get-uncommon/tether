- Repository: the bash `scripts/test-leaks.ts` keeps running on Windows starts only in the test
  runner, never keeps a process alive, and when it fails to start or prints nothing in time the
  tests run without it, with a note, instead of the run crashing or aborting.
