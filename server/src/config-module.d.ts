// The config file (server/tether-sync.config.js) belongs to whoever deploys the Worker and stays JavaScript, so its
// default export is unchecked input: entry.ts parses it with the check the CLI applies to a config file.
declare module '*/tether-sync.config.js' {
  const config: unknown;
  export default config;
}
