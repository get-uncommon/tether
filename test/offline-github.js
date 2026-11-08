// Loaded with `node --import` into a released updater by upgrade-from-released.test.js. Those updaters name GitHub's
// hosts in their code, with no setting to change them, so this sends their requests to the test's own server
// (TETHER_TEST_GITHUB) instead: `https://api.github.com/…` to `<server>/api/…`, `https://codeload.github.com/…` to
// `<server>/codeload/…`, and `https://github.com/…`, where a Release's assets are, to `<server>/web/…`. Anything else
// is refused, so the run can't reach the network.
const server = process.env['TETHER_TEST_GITHUB'];
if (!server) throw new Error('TETHER_TEST_GITHUB is not set');
const GITHUB_HOST = /^https:\/\/(?:(api|codeload)\.)?github\.com\//;
const localFetch = globalThis.fetch;

/** @type {typeof fetch} */
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const host = GITHUB_HOST.exec(url);
  if (!host) return Promise.reject(new Error(`offline-github: ${url} is not a GitHub URL`));
  return localFetch(`${server}/${host[1] ?? 'web'}/${url.slice(host[0].length)}`, init);
};
