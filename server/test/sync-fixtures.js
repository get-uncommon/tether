// The sync app over the fake Shopify and Webflow APIs, for the sync tests.
import { createApp, memoryStore } from '../src/index.ts';
import { createMockApis, baseConfig, env, instantSleep } from './mocks.js';

/**
 * @param {Parameters<typeof createMockApis>[0] & { store?: import('../src/store.ts').Store }} [opts]
 * @param {import('../src/mapping.ts').RawConfig} [config]
 */
export const setup = (opts = {}, config = baseConfig) => {
  const apis = createMockApis(opts);
  const store = opts.store ?? memoryStore();
  const app = createApp(config, env, { store, fetch: apis.fetch, sleep: instantSleep });
  return { ...apis, store, app, sync: app.sync };
};
