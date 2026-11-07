- Repository: a test runs `npm run dev`'s watch on a copy of the source, edits a part and a source
  the core shares with it, and checks that each core then carries the hashes of its own kind of
  part. The watch's wiring moves into `scripts/script-build.ts` for it.
- Repository: the build retries a busy rename only on Windows, so a read-only `dist/` on Linux or
  macOS fails at once instead of after about 10 seconds a file.
- Repository: git ignores the temporary files an interrupted `npm run dev` leaves in `dist/`, so the
  release's clean check passes; the next build removes them.
- Repository: the release rehearsal runs, and `npm run release` looks for its run, on every file the
  gate reads (`.config/`, `.changes/`, `docs/`, `examples/`, `dist/`, the workflows and the root
  config files among them), and a test derives those files from Prettier, ESLint, the tests and the
  scripts, so a release can't stand on an older commit's rehearsal.
