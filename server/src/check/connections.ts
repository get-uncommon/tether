/**
 * The setup check's second half: calls Shopify and Webflow with the configured credentials, without retries, and
 * says what each answer means for the setup. Only runs with the bearer secret (Worker) or without --offline (CLI).
 */
import { checkMapping, mapProduct } from '../mapping.ts';
import { createShopify } from '../shopify.ts';
import { createWebflow } from '../webflow.ts';
import { webhookStatus } from '../webhooks.ts';
import { httpStatusOf } from '../util.ts';
import { messageOf } from '../shared/error-message.ts';
import type { Steps } from './steps.ts';
import type { ConnectionSettings } from './settings.ts';
import type { CleanEnv } from '../env.ts';
import type { MappingProblem, SyncConfig } from '../mapping.ts';
import type { Product } from '../product.ts';
import type { WebflowCollection } from '../webflow.ts';

type ShopifyClient = ReturnType<typeof createShopify>;

interface ConnectionContext {
  config: SyncConfig;
  env: CleanEnv;
  /** Test doubles, when given. */
  network: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };
  webhookUri: string | null;
}

function shopifyApiFix(error: unknown): string {
  const status = httpStatusOf(error);
  if (status === 401 || /token request failed \((400|401)/.test(messageOf(error)))
    return 'The credentials were rejected: check them, and that the app is installed on this store (client credentials only work for your own organization).';
  if (status === 404) return 'Store or API version not found: check SHOPIFY_DOMAIN and shopify.apiVersion.';
  if (status === 403) return 'The app lacks access: add read_products and reinstall.';
  return 'Check the domain and your network.';
}

function webflowApiFix(error: unknown): string {
  const status = httpStatusOf(error);
  if (status === 401) return 'WEBFLOW_TOKEN was rejected: generate a new site token.';
  if (status === 403) return 'The token lacks CMS access: generate one with CMS read and write.';
  if (status === 404)
    return 'Collection not found: check WEBFLOW_COLLECTION_ID, and that the token belongs to the same site.';
  return 'Check your network.';
}

/**
 * @returns `sample` is the first product, if any.
 */
async function checkShopifyApi(
  steps: Steps,
  shopify: ShopifyClient,
  apiVersion: string,
): Promise<{ reachable: boolean; sample: Product | null }> {
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

async function checkWebhookRegistration(steps: Steps, shopify: ShopifyClient, uri: string): Promise<void> {
  try {
    const { missing } = await webhookStatus({ shopify, uri });
    if (missing.length === 0) steps.add('ok', 'Shopify webhooks', `registered for ${uri}`);
    else
      steps.add(
        'warn',
        'Shopify webhooks',
        `not registered: ${missing.join(', ')}.`,
        'POST /reconcile with the SYNC_SECRET (?since=all for the first import) registers the missing ones. Until then the cron syncs every 10 minutes.',
      );
  } catch (error) {
    steps.add('warn', 'Shopify webhooks', `couldn't list them: ${messageOf(error)}`);
  }
}

/**
 * The mapping against the collection's fields. With `skipMissingFields`, fields the collection lacks are expected
 * (the default mapping names more than most collections have), so they become one line instead of a warning each.
 */
function reportMapping(steps: Steps, config: SyncConfig, collection: WebflowCollection, sample: Product | null): void {
  const problems = checkMapping(config, collection);
  const existing = new Set(collection.fields.map((field) => field.slug));
  const written = (slug: string) =>
    !config.webflow.skipMissingFields || slug === 'name' || slug === 'slug' || existing.has(slug);
  const skipped = Object.keys(config.fields).filter((slug) => !written(slug));
  const isSkipNote = (problem: MappingProblem) =>
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

async function checkWebflowApi(
  steps: Steps,
  { config, network }: ConnectionContext,
  { token, collectionId }: { token: string; collectionId: string },
  sample: Product | null,
): Promise<void> {
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
 */
export async function checkConnections(
  steps: Steps,
  { domain, target }: ConnectionSettings,
  context: ConnectionContext,
): Promise<void> {
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
