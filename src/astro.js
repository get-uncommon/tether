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
 * View Transitions (<ClientRouter />) work without extra code.
 */

const ENV_KEYS = {
  domain: ['PUBLIC_SHOPIFY_DOMAIN', 'PUBLIC_SHOPIFY_STORE_DOMAIN', 'SHOPIFY_DOMAIN'],
  token: ['PUBLIC_SHOPIFY_STOREFRONT_TOKEN', 'PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN', 'SHOPIFY_STOREFRONT_TOKEN'],
};

/** .env files the way Vite reads them (later files win), plus process.env on top. */
async function readEnv(command, root) {
  const mode = command === 'dev' ? 'development' : 'production';
  const out = {};
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
      let text;
      try { text = await readFile(join(root, name), 'utf8'); } catch { continue; }
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m || line.trim().startsWith('#')) continue;
        let v = m[2];
        const q = /^(["'])(.*?)\1/.exec(v); // "quoted" (a # comment may follow)
        v = q ? q[2] : v.replace(/\s+#.*$/, '');
        out[m[1]] = v;
      }
    }
  } catch { /* not in Node: nothing to read */ }
  return { ...out, ...process.env };
}

export default function tether(options = {}) {
  const { inject = true, ...config } = options;
  return {
    name: '@occluze/tether',
    hooks: {
      'astro:config:setup': async ({ injectScript, command, config: astroConfig, logger }) => {
        const root = astroConfig?.root ? decodeURIComponent(new URL(astroConfig.root).pathname) : process.cwd();
        const env = await readEnv(command, root);
        for (const [key, names] of Object.entries(ENV_KEYS)) {
          if (!config[key]) config[key] = names.map((n) => env[n]).find(Boolean);
        }
        const bad = Object.entries(config).filter(([, v]) => typeof v === 'function').map(([k]) => k);
        bad.forEach((k) => delete config[k]);
        if (bad.length) logger.warn(`${bad.join(', ')}: functions can't be passed here. Set them in window.TETHER_CONFIG in your layout.`);
        if (!config.domain || !config.token) {
          logger.warn('No Shopify store configured: set PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN in .env (the public Storefront API token).');
        }
        if (!inject) return;
        // Before any module runs: window.TETHER_CONFIG in the layout doesn't auto-start a second init.
        injectScript('head-inline', 'window.TETHER_INTEGRATION="astro";');
        injectScript('page', [
          "import Tether from '@occluze/tether';",
          `Tether.init({ ...${JSON.stringify({ autoMount: false, ...config })}, ...(window.TETHER_CONFIG || {}) }).then(() => Tether.mount(document));`,
        ].join('\n'));
      },
    },
  };
}
