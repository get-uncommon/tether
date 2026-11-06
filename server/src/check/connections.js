/**
 * The setup check's second half: calls Shopify and Webflow with the configured credentials, without retries, and
 * says what each answer means for the setup. Only runs with the bearer secret (Worker) or without --offline (CLI).
 */
import { checkMapping, mapProduct } from '../mapping.js';
import { createShopify } from '../shopify.js';
import { createWebflow } from '../webflow.js';
import { webhookStatus } from '../webhooks.js';
import { httpStatusOf, messageOf } from '../util.js';

/** @typedef {import('./steps.js').Steps} Steps */
/** @typedef {import('./settings.js').ConnectionSettings} ConnectionSettings */
/** @typedef {import('../env.js').CleanEnv} CleanEnv */
/** @typedef {import('../mapping.js').SyncConfig} SyncConfig */
/** @typedef {import('../mapping.js').MappingProblem} MappingProblem */
/** @typedef {import('../product.js').Product} Product */
/** @typedef {import('../webflow.js').WebflowCollection} WebflowCollection */
/** @typedef {ReturnType<typeof createShopify>} ShopifyClient */

/**
 * @typedef {object} ConnectionContext
 * @property {SyncConfig} config
 * @property {CleanEnv} env
 * @property {{ fetch?: typeof fetch, sleep?: (ms: number) => Promise<void> }} network Test doubles, when given.
 * @property {string | null} webhookUri
 */

/** @param {unknown} error */
function shopifyApiFix(error) {
  const status = httpStatusOf(error);
  if (status === 401 || /token request failed \((400|401)/.test(messageOf(error)))
    return 'The credentials were rejected: check them, and that the app is installed on this store (client credentials only work for your own organization).';
  if (status === 404) return 'Store or API version not found: check SHOPIFY_DOMAIN and shopify.apiVersion.';
  if (status === 403) return 'The app lacks access: add read_products and reinstall.';
  return 'Check the domain and your network.';
}

/** @param {unknown} error */
function webflowApiFix(error) {
  const status = httpStatusOf(error);
  if (status === 401) return 'WEBFLOW_TOKEN was rejected: generate a new site token.';
  if (status === 403) return 'The token lacks CMS access: generate one with CMS read and write.';
  if (status === 404)
    return 'Collection not found: check WEBFLOW_COLLECTION_ID, and that the token belongs to the same site.';
  return 'Check your network.';
}

/**
 * @param {Steps} steps
 * @param {ShopifyClient} shopify
 * @param {string} apiVersion
 * @returns {Promise<{ reachable: boolean, sample: Product | null }>} `sample` is the first product, if any.
 */
async function checkShopifyApi(steps, shopify, apiVersion) {
  try {
    const shop = await shopify.shopName();
    steps.add('ok', 'Shopify API', `${shop.name} (API ${apiVersion})`);
  } catch (error) {
    steps.add('error', 'Shopify API', messageOf(error), shopifyApiFix(error));
    return { reachable: false, sample: null };
  }
  try {
    const {
      products: [sample = null],
    } = await shopify.listProducts({ first: 1 });
    if (sample) steps.add('ok', 'Shopify products', `can read products (e.g. "${sample.handle}")`);
    else steps.add('warn', 'Shopify products', 'The store has no products yet.');
    return { reachable: true, sample };
  } catch (error) {
    const message = messageOf(error);
    steps.add(
      'error',
      'Shopify products',
      message,
      /access|scope|denied/i.test(message)
        ? 'Add the read_products scope to the app (and read_inventory if you map inventory), then reinstall/update it.'
        : 'Check the metafields in the mapping exist, and the API version.',
    );
    return { reachable: true, sample: null };
  }
}

/**
 * @param {Steps} steps
 * @param {ShopifyClient} shopify
 * @param {string} uri
 */
async function checkWebhookRegistration(steps, shopify, uri) {
  try {
    const { missing } = await webhookStatus({ shopify, uri });
    if (missing.length === 0) steps.add('ok', 'Shopify webhooks', `registered for ${uri}`);
    else
      steps.add(
        'warn',
        'Shopify webhooks',
        `not registered yet: ${missing.join(', ')}.`,
        'Run the first import (POST /reconcile?since=all): it registers them. Until then the cron syncs every 10 minutes.',
      );
  } catch (error) {
    steps.add('warn', 'Shopify webhooks', `couldn't list them: ${messageOf(error)}`);
  }
}

/**
 * The mapping against the collection's fields. With `skipMissingFields`, fields the collection lacks are expected
 * (the default mapping names more than most collections have), so they become one line instead of a warning each.
 *
 * @param {Steps} steps
 * @param {SyncConfig} config
 * @param {WebflowCollection} collection
 * @param {Product | null} sample
 */
function reportMapping(steps, config, collection, sample) {
  const problems = checkMapping(config, collection);
  const existing = new Set(collection.fields.map((field) => field.slug));
  /** @param {string} slug */
  const written = (slug) =>
    !config.webflow.skipMissingFields || slug === 'name' || slug === 'slug' || existing.has(slug);
  const skipped = Object.keys(config.fields).filter((slug) => !written(slug));
  /** @param {MappingProblem} problem */
  const isSkipNote = (problem) =>
    problem.level === 'warn' &&
    (/doesn't exist in .*it is skipped/.test(problem.message) ||
      (skipped.length > 0 && /^webflowOwned ".*" isn't a field/.test(problem.message)));

  const shown = problems.filter((problem) => !isSkipNote(problem));
  for (const problem of shown) steps.add(problem.level, 'Field mapping', problem.message, problem.fix);
  if (skipped.length)
    steps.add(
      'info',
      'Field mapping',
      `not in this collection, so not synced: ${skipped.join(', ')}`,
      'Add a field with that slug to the collection to sync it.',
    );
  if (!problems.some((problem) => problem.level === 'error'))
    steps.add('ok', 'Field mapping', shown.length ? 'usable (see warnings)' : 'ok');
  if (sample) {
    const fieldData = Object.entries(mapProduct(sample, config)).filter(([slug]) => written(slug));
    steps.addSample('Sample', `"${sample.handle}" would be written as`, Object.fromEntries(fieldData));
  }
}

/**
 * @param {Steps} steps
 * @param {ConnectionContext} context
 * @param {{ token: string, collectionId: string }} target
 * @param {Product | null} sample
 */
async function checkWebflowApi(steps, { config, network }, { token, collectionId }, sample) {
  const webflow = createWebflow({ token, collectionId, perMinute: 0, retries: 0, ...network });
  try {
    const collection = await webflow.getCollection();
    const name = collection.displayName ?? '';
    steps.add('ok', 'Webflow API', `collection "${name}" (${String(collection.fields.length)} fields)`);
    reportMapping(steps, config, collection, sample);
  } catch (error) {
    steps.add('error', 'Webflow API', messageOf(error), webflowApiFix(error));
  }
}

/**
 * Tests the Shopify connection, the webhook subscriptions and, unless only a deploy hook is set, the Webflow
 * collection and the mapping against it.
 *
 * @param {Steps} steps
 * @param {ConnectionSettings} settings
 * @param {ConnectionContext} context
 */
export async function checkConnections(steps, { domain, target }, context) {
  const { config, env, network, webhookUri } = context;
  const shopify = createShopify({
    domain,
    adminToken: env.SHOPIFY_ADMIN_TOKEN,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    apiVersion: config.shopify.apiVersion,
    metafields: config.shopify.metafields,
    inventory: config.shopify.inventory,
    retries: 0,
    ...network,
  });
  const { reachable, sample } = await checkShopifyApi(steps, shopify, config.shopify.apiVersion);
  if (webhookUri && reachable) await checkWebhookRegistration(steps, shopify, webhookUri);
  if (target.kind === 'webflow') await checkWebflowApi(steps, context, target, sample);
}
