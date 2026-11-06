// @ts-nocheck
/**
 * Astro integration: Tether on every page, configured from .env.
 *
 *   // astro.config.mjs
 *   import { defineConfig } from 'astro/config';
 *   import tether from '@occluze/tether/astro';
 *   export default defineConfig({ integrations: [tether({ country: 'NL', locale: 'nl-NL' })] });
 *
 *   // .env
 *   PUBLIC_SHOPIFY_DOMAIN=your-store.myshopify.com
 *   PUBLIC_SHOPIFY_STOREFRONT_TOKEN=your-public-storefront-token
 *
 * Options are Tether's config (domain and token override .env). Functions (onError, formatMoney,
 * hooks) can't be passed here: set them in window.TETHER_CONFIG in your layout, it is merged in.
 * View Transitions (<ClientRouter />) work without extra code. In dev, changes to
 * src/shop.config.js restart the dev server (other files: tether({ ..., watch: ['my/config.js'] })).
 */
import { isSecretShopifyToken, STORE_ENV_NAMES } from './shopify-values.js';

/** The mode Astro runs in: --mode, else development for dev and production for build. */
function modeOf(command, argv = process.argv) {
  const i = argv.findIndex((a) => a === '--mode' || a.startsWith('--mode='));
  if (i >= 0) return argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  return command === 'dev' ? 'development' : 'production';
}

/** .env files the way Vite reads them (later files win), plus process.env on top. */
async function readEnv(command, root) {
  const mode = modeOf(command);
  const out = {};
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
      let text;
      try {
        text = await readFile(join(root, name), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m || line.trim().startsWith('#')) continue;
        let v = m[2];
        const q = /^(["'])(.*?)\1/.exec(v); // "quoted" (a # comment may follow)
        v = q ? q[2] : v.replace(/\s+#.*$/, '');
        out[m[1]] = v;
      }
    }
  } catch {
    /* not in Node: nothing to read */
  }
  return { ...out, ...process.env };
}

/**
 * Fills the store's domain and token from .env when the options don't set them, and refuses a secret token: whatever
 * is read here is written into every page.
 */
function applyStoreEnv(config, env, logger) {
  for (const [key, names] of Object.entries(STORE_ENV_NAMES)) {
    if (config[key]) continue;
    const name = names.find((n) => env[n]);
    if (!name) continue;
    config[key] = env[name];
    // Whatever is read here is written into every page, so a name without PUBLIC_ is a mistake waiting to happen.
    if (!name.startsWith('PUBLIC_')) {
      logger.warn(`${name} is written into every page as Tether's ${key}. Name it PUBLIC_${name} to say so.`);
    }
  }
  if (typeof config.token === 'string' && isSecretShopifyToken(config.token)) {
    throw new Error(
      'The Shopify token for Tether is a secret token (shpat_/shpss_/…), which would be published in every page. Use the public Storefront API token from the Headless channel.',
    );
  }
}

export default function tether(options = {}) {
  const {
    inject = true,
    watch = ['src/shop.config.js', 'src/shop.config.mjs', 'src/shop.config.ts'],
    ...config
  } = options;
  return {
    name: '@occluze/tether',
    hooks: {
      'astro:config:setup': async ({
        injectScript,
        command,
        config: astroConfig,
        logger,
        addWatchFile,
        updateConfig,
      }) => {
        const { fileURLToPath } = await import('node:url');
        const root = astroConfig?.root ? fileURLToPath(astroConfig.root) : process.cwd();
        // The options usually come from a file the Astro config imports (src/shop.config.js):
        // the dev server restarts when it changes, so the browser gets the new config too.
        if (command === 'dev' && addWatchFile) {
          const { existsSync } = await import('node:fs');
          const { resolve } = await import('node:path');
          []
            .concat(watch || [])
            .map((f) => resolve(root, f))
            .filter((f) => existsSync(f))
            .forEach((f) => addWatchFile(f));
        }
        // Astro 5+: declare the store variables, so Astro checks them (astro:env).
        if (updateConfig) {
          try {
            const { envField } = await import('astro/config');
            if (envField) {
              const field = () => envField.string({ context: 'client', access: 'public', optional: true });
              updateConfig({
                env: { schema: { PUBLIC_SHOPIFY_DOMAIN: field(), PUBLIC_SHOPIFY_STOREFRONT_TOKEN: field() } },
              });
            }
          } catch {
            /* Astro 4: no astro:env */
          }
        }
        const env = await readEnv(command, root);
        applyStoreEnv(config, env, logger);
        const bad = Object.entries(config)
          .filter(([, v]) => typeof v === 'function')
          .map(([k]) => k);
        bad.forEach((k) => delete config[k]);
        if (bad.length)
          logger.warn(
            `${bad.join(', ')}: functions can't be passed here. Set them in window.TETHER_CONFIG in your layout.`,
          );
        if (!config.domain || !config.token) {
          logger.warn(
            'No Shopify store configured: set PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN in .env (the public Storefront API token).',
          );
        }
        if (!inject) return;
        // Before any module runs: window.TETHER_CONFIG in the layout doesn't auto-start a second init.
        injectScript('head-inline', 'window.TETHER_INTEGRATION="astro";');
        injectScript(
          'page',
          [
            "import Tether from '@occluze/tether';",
            // As the base config (like window.TETHER_CONFIG), not as overrides: a visitor's saved market
            // (country, money format) then wins over the defaults, as on a plain script-tag site.
            `window.TETHER_CONFIG = { ...${JSON.stringify({ autoMount: false, ...config })}, ...(window.TETHER_CONFIG || {}) };`,
            'Tether.init().then(() => Tether.mount(document));',
          ].join('\n'),
        );
      },
    },
  };
}
