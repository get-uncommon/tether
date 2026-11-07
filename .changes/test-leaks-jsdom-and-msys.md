- Repository: a test file fails when a jsdom page throws an exception nothing catches, from a script
  or an event listener, which jsdom only hands to the page's console. jsdom's other errors, such as
  "Not implemented: navigation", still don't fail a test.
- Repository: on Windows, the test runner keeps Git for Windows' MSYS runtime running for the whole
  run, so a test's bash or tar can't be the first MSYS program and set `/tmp` for every other MSYS
  shell on the machine to that test file's temp folder, which then failed the file for what those
  shells wrote there.
- Repository: `npm run dev` writes the plain `tether.js` core through `writeAtomically` too, like
  every other `<script>` file, so a browser never reads it half written.
