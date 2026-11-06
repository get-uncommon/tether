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
 * Options are Tether's config (domain and token override .env). Functions (onError, formatMoney, hooks) can't be
 * passed here: set them in window.TETHER_CONFIG in your layout, it is merged in. View Transitions (<ClientRouter />)
 * work without extra code. In dev, changes to src/shop.config.js restart the dev server (other files:
 * tether({ ..., watch: ['my/config.js'] })). Runs in Node, inside Astro's config step.
 */
import { DEFAULTS } from './config.ts';
import type { TetherOptions } from './config.ts';
import { isSecretShopifyToken, STORE_ENV_NAMES } from './shopify-values.ts';

// Astro isn't a dependency, so the parts of its integration API this file uses are described here.
interface AstroLogger {
  warn: (message: string) => void;
}
type EnvStringField = (options: { context: 'client'; access: 'public'; optional: boolean }) => unknown;
/** The argument of Astro's `astro:config:setup` hook. */
interface AstroConfigSetup {
  injectScript: (stage: 'head-inline' | 'page', content: string) => void;
  /** `dev`, `build`, `preview` or `sync`. */
  command: string;
  config: { root?: URL };
  logger: AstroLogger;
  addWatchFile?: (path: string) => void;
  /** Takes a partial Astro config. A method, so that Astro's own `DeepPartial<AstroConfig>` parameter fits. */
  updateConfig?(config: { env?: { schema?: Record<string, unknown> } }): unknown;
}

/** The config options a page can be handed as JSON: all but the functions. */
type SerializableOptions = {
  [
    Key in keyof TetherOptions as Exclude<TetherOptions[Key], null | undefined> extends (...args: never[]) => unknown
      ? never
      : Key
  ]?: TetherOptions[Key];
};

/** Tether's serializable config, plus the integration's own options. */
interface TetherAstroOptions extends SerializableOptions {
  /** Add the Tether script to every page (default true). */
  inject?: boolean;
  /** Files that restart the dev server when they change. */
  watch?: string[] | null;
}
interface PageConfig {
  domain?: unknown;
  token?: unknown;
  [option: string]: unknown;
}
type Env = Record<string, string | undefined>;

export type { TetherAstroOptions, AstroConfigSetup };

const DEFAULT_WATCH = ['src/shop.config.js', 'src/shop.config.mjs', 'src/shop.config.ts'];
/** `createStorefront()`'s own options, which a shared `shop.config.js` may hold: the browser has no use for them. */
const SERVER_OPTIONS = new Set(['siteUrl', 'pageSize', 'fetch']);
/**
 * Astro is an optional peer dependency. A variable specifier keeps both tsc and the bundler from resolving it.
 */
const ASTRO_CONFIG_MODULE = 'astro/config';
const ENV_LINE = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/;
/** A quoted value; a `#` comment may follow the closing quote. */
const QUOTED_VALUE = /^(["'])(.*?)\1/;

/** @returns The mode Astro runs in: `--mode`, else development for dev and production for everything else. */
function modeOf(command: string, argv: readonly string[] = process.argv): string {
  const defaultMode = command === 'dev' ? 'development' : 'production';
  const index = argv.findIndex((arg) => arg === '--mode' || arg.startsWith('--mode='));
  if (index < 0) return defaultMode;
  const flag = argv[index] ?? '';
  const mode = flag.includes('=') ? flag.split('=')[1] : argv[index + 1];
  return mode ?? defaultMode;
}

/** @returns True for Node's "no such file" error. */
const isMissingFile = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** @returns The file's text, `null` when it doesn't exist: every .env file is optional. */
async function readOptionalFile(path: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/**
 * @param text A .env file.
 * @param into Receives each variable; a later line wins.
 */
function parseEnvFile(text: string, into: Env) {
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const [, name = '', raw = ''] = match;
    const quoted = QUOTED_VALUE.exec(raw);
    into[name] = quoted ? (quoted[2] ?? '') : raw.replace(/\s+#.*$/, '');
  }
}

/**
 * @param root The project folder.
 * @returns The .env files the way Vite reads them (later files win), with `process.env` on top.
 */
async function readEnv(command: string, root: string): Promise<Env> {
  const path = await import('node:path');
  const mode = modeOf(command);
  const env: Env = {};
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const text = await readOptionalFile(path.join(root, name));
    if (text !== null) parseEnvFile(text, env);
  }
  return { ...env, ...process.env };
}

/**
 * Fills the store's domain and token from .env when the options don't set them, and refuses a secret token: whatever
 * is read here is written into every page.
 *
 * @param config Changed in place.
 * @throws {Error} When the token is a secret Shopify token.
 */
function applyStoreEnv(config: PageConfig, env: Env, logger: AstroLogger) {
  for (const key of ['domain', 'token'] as const) {
    if (config[key]) continue;
    const name = STORE_ENV_NAMES[key].find((candidate) => env[candidate]);
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

/**
 * The options usually come from a file the Astro config imports (src/shop.config.js): the dev server restarts when it
 * changes, so the browser gets the new config too.
 */
async function watchConfigFiles(root: string, files: readonly string[], addWatchFile: (path: string) => void) {
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (existsSync(absolute)) addWatchFile(absolute);
  }
}

/** @returns The module, `null` when the package isn't installed. */
async function importIfInstalled(specifier: string): Promise<unknown> {
  try {
    const module: unknown = await import(specifier);
    return module;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}

/**
 * @param envField `astro/config`'s `envField`, which Astro 4 doesn't have.
 * @returns True when it has the `string` field Astro 5 documents.
 */
const hasStringField = (envField: unknown): envField is { string: EnvStringField } =>
  typeof envField === 'object' && envField !== null && 'string' in envField && typeof envField.string === 'function';

/**
 * Declares the store variables in `astro:env` (Astro 5+), so Astro checks them. Astro 4 has no `envField`.
 */
async function declareEnvSchema(setup: AstroConfigSetup) {
  if (!setup.updateConfig) return;
  const astroConfig = await importIfInstalled(ASTRO_CONFIG_MODULE);
  const envField =
    typeof astroConfig === 'object' && astroConfig !== null && 'envField' in astroConfig ? astroConfig.envField : null;
  if (!hasStringField(envField)) return;
  const field = () => envField.string({ context: 'client', access: 'public', optional: true });
  try {
    setup.updateConfig({
      env: { schema: { PUBLIC_SHOPIFY_DOMAIN: field(), PUBLIC_SHOPIFY_STOREFRONT_TOKEN: field() } },
    });
  } catch (error) {
    // Astro versions with `envField` but without a stable `env` option refuse it; the variables still work unchecked.
    setup.logger.warn(
      `.env variables not declared in astro:env: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** @param config Changed in place: functions can't be written into a page. */
function dropFunctions(config: PageConfig, logger: AstroLogger) {
  const functions = Object.keys(config).filter((key) => typeof config[key] === 'function');
  for (const key of functions) Reflect.deleteProperty(config, key);
  if (functions.length) {
    logger.warn(
      `${functions.join(', ')}: functions can't be passed here. Set them in window.TETHER_CONFIG in your layout.`,
    );
  }
}

/** @param config Changed in place: only browser options are written into the page. */
function keepBrowserOptions(config: PageConfig, logger: AstroLogger) {
  for (const key of Object.keys(config)) {
    if (key in DEFAULTS) continue;
    Reflect.deleteProperty(config, key);
    if (!SERVER_OPTIONS.has(key)) logger.warn(`${key} is not a Tether option: left out of the page.`);
  }
}

function injectTether(injectScript: AstroConfigSetup['injectScript'], config: PageConfig) {
  // Before any module runs: window.TETHER_CONFIG in the layout doesn't auto-start a second init.
  injectScript('head-inline', 'window.TETHER_INTEGRATION="astro";');
  injectScript(
    'page',
    [
      "import Tether from '@occluze/tether';",
      // As the base config (like window.TETHER_CONFIG), not as overrides: a visitor's saved market (country, money
      // format) then wins over the defaults, as on a plain script-tag site.
      `window.TETHER_CONFIG = { ...${JSON.stringify({ autoMount: false, ...config })}, ...(window.TETHER_CONFIG || {}) };`,
      'Tether.init().then(() => Tether.mount(document));',
    ].join('\n'),
  );
}

export default function tether(options: TetherAstroOptions = {}): {
  name: string;
  hooks: { 'astro:config:setup': (setup: AstroConfigSetup) => Promise<void> };
} {
  const { inject = true, watch = DEFAULT_WATCH, ...pageOptions } = options;
  return {
    name: '@occluze/tether',
    hooks: {
      'astro:config:setup': async (setup) => {
        const { injectScript, command, config: astroConfig, logger, addWatchFile } = setup;
        const { fileURLToPath } = await import('node:url');
        const root = astroConfig.root ? fileURLToPath(astroConfig.root) : process.cwd();
        if (command === 'dev' && addWatchFile) await watchConfigFiles(root, watch ?? [], addWatchFile);
        await declareEnvSchema(setup);
        const config: PageConfig = { ...pageOptions };
        applyStoreEnv(config, await readEnv(command, root), logger);
        dropFunctions(config, logger);
        keepBrowserOptions(config, logger);
        if (!config.domain || !config.token) {
          logger.warn(
            'No Shopify store configured: set PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN in .env (the public Storefront API token).',
          );
        }
        if (inject) injectTether(injectScript, config);
      },
    },
  };
}
