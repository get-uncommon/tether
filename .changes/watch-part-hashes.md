- Repository: `npm run dev` rebuilds each `<script>` core until it carries the hashes of the part
  files as they are, since esbuild's `rebuild()` joins a build already running, which may have read
  a part file before the part rewrote it. A part rebuilds only the core of its kind, and part files
  are written through a temporary file renamed into place, which the next build's folder check
  accepts when an interrupted run leaves it.
