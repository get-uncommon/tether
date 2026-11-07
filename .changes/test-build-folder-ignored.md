- Repository: the folder the test build writes beside `.test-dist/` is named
  `.test-dist-building-…`, as the ignore files expect, not `..test-dist-building-…`, so ESLint and
  Prettier no longer read a test build that is being written or was interrupted.
