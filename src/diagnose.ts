/**
 * `Tether.diagnose()`: one call in the browser console that explains what's wrong on a page. Logs a readable report
 * and returns it as an object. The markup checks are in diagnose-markup.ts.
 *
 *   await Tether.diagnose()
 *   await Tether.diagnose({ silent: true })   // just the object
 */
import { cfg, isConfigured } from './config.ts';
import { gql, endpoint, shaped } from './client.ts';
import { sel, get, qsa } from './dom.ts';
import { getProduct } from './loader.ts';
import { allPlans } from './selling-plans.ts';
import { resolveProductKey } from './status.ts';
import { apiVersionStatus } from './api-version.ts';
import { loadPart } from './lazy.ts';
import { checkMarkup, didYouMean } from './diagnose-markup.ts';
import type { ApiVersionStatus } from './api-version.ts';
import type { DetectedMarket } from './markets.ts';
import type { Problem } from './diagnose-markup.ts';
import type { Product } from './fragments.ts';

export { apiVersionStatus, checkMarkup, didYouMean };

/** The market in use (a visitor's choice included), and what detection would pick. */
interface MarketReport {
  country: string | null;
  language: string | null;
  locale: string | null;
  /** `null` without `markets.detect`. */
  detected: DetectedMarket | null;
}

interface ShopReport {
  name: string;
  url: string;
  currency: string;
}

type ProductReport =
  | { key: string; handle: string; title: string; plans: number; requiresSellingPlan: boolean }
  | { key: string; error: string | undefined };

interface SellingPlanReport {
  product: string;
  group: string;
  plan: string;
  id: string;
}

export interface DiagnoseReport {
  /** Tether's version, `''` when the caller didn't say. */
  version: string;
  /** The config, with the token masked. */
  config: Record<string, unknown>;
  apiVersion: ApiVersionStatus;
  market: MarketReport;
  reachable: boolean;
  shop: ShopReport | null;
  latencyMs: number | null;
  products: ProductReport[];
  sellingPlans: SellingPlanReport[];
  problems: Problem[];
}

type StorefrontCheck =
  | { kind: 'not-configured' }
  | { kind: 'reachable'; shop: ShopReport; latencyMs: number }
  | { kind: 'unreachable'; error: unknown; latencyMs: number };

export interface DiagnoseOptions {
  root?: ParentNode;
  /** Return the report without logging it. */
  silent?: boolean;
  /** Tether's version, for the report. */
  version?: string;
  /** The date the API version's support is measured against. */
  now?: Date;
}

/** Products checked at most, so a long CMS page doesn't send a request per card. */
const MAX_PRODUCTS_CHECKED = 20;
/** Matches the warning window of `apiVersionStatus`. */
const API_UPGRADE_WARNING_MONTHS = 3;
const TOKEN_EDGE_CHARACTERS = 4;

function maskToken(token: string): string {
  if (!token) return '(missing)';
  return `${token.slice(0, TOKEN_EDGE_CHARACTERS)}…${token.slice(-TOKEN_EDGE_CHARACTERS)} (${token.length} chars)`;
}

/** The error's message, else its code (a `TetherError` has one), else `fallback`. */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' && code ? code : fallback;
}

function configSummary(): Record<string, unknown> {
  return {
    domain: cfg.domain || '(missing)',
    token: maskToken(cfg.token),
    apiVersion: cfg.apiVersion,
    endpoint: cfg.domain ? endpoint() : null,
    country: cfg.country,
    language: cfg.language,
    locale: cfg.locale,
    markets: cfg.markets,
    prefix: cfg.prefix,
    productPath: cfg.productPath,
    metafields: cfg.metafields,
    autoMount: cfg.autoMount,
    observe: cfg.observe,
    onError: typeof cfg.onError === 'function',
  };
}

/**
 * Detection runs in the markets part, which init has already loaded whenever `markets.detect` is set.
 */
async function marketSummary(): Promise<MarketReport> {
  return {
    country: cfg.country || null,
    language: cfg.language || null,
    locale: cfg.locale || null,
    detected: cfg.markets?.detect ? (await loadPart('markets')).detectMarket(cfg.markets) : null,
  };
}

/** An error for an unsupported version, a warning when support ends soon. */
function apiVersionProblem({ ok, monthsLeft, note }: ApiVersionStatus): Problem | null {
  if (ok && (monthsLeft === undefined || monthsLeft >= API_UPGRADE_WARNING_MONTHS)) return null;
  return { level: ok ? 'warn' : 'error', message: `apiVersion ${cfg.apiVersion}: ${note}` };
}

const isShopAnswer = shaped<{
  shop: { name: string; primaryDomain: { url: string }; paymentSettings: { currencyCode: string } };
}>({ shop: { name: 'string', primaryDomain: { url: 'string' }, paymentSettings: { currencyCode: 'string' } } });

async function checkStorefront(): Promise<StorefrontCheck> {
  if (!isConfigured()) return { kind: 'not-configured' };
  const startedAt = Date.now();
  try {
    const data = await gql(
      'query TetherDiagnose { shop { name primaryDomain { url } paymentSettings { currencyCode } } }',
      {},
      isShopAnswer,
      { context: false },
    );
    const shop = {
      name: data.shop.name,
      url: data.shop.primaryDomain.url,
      currency: data.shop.paymentSettings.currencyCode,
    };
    return { kind: 'reachable', shop, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { kind: 'unreachable', error, latencyMs: Date.now() - startedAt };
  }
}

/**
 * Options a visitor can't choose on this page get the first available variant's value.
 */
function checkOptions(root: ParentNode, key: string, product: Product): Problem[] {
  const problems: Problem[] = [];
  const names = product.options.map((option) => option.name);
  const roots = qsa(root, sel('product')).filter(
    (el) => resolveProductKey(el).key === key && el.querySelector(sel('add-to-cart')),
  );
  for (const el of roots) {
    const shown = new Set(
      qsa(el, `${sel('option-list')},select${sel('option')}`).map(
        (list) => get(list, 'option-list') || get(list, 'option'),
      ),
    );
    if (!shown.size && qsa(el, `select${sel('variant-select')}`).length) continue;
    // Translated option names (a language in the market) don't match the names in the markup.
    if (!cfg.language) {
      for (const name of shown) {
        if (!name || names.includes(name)) continue;
        problems.push({
          level: 'warn',
          message: `Product "${product.handle}" has no option "${name}" (its options: ${names.join(', ') || 'none'}).${didYouMean(name, names)}`,
        });
      }
    }
    for (const option of product.options) {
      if (option.optionValues.length <= 1 || shown.has(option.name)) continue;
      problems.push({
        level: 'warn',
        message: `Product "${product.handle}": option "${option.name}" (${option.optionValues.length} values) has no tether-option-list, so visitors can't choose it.`,
      });
    }
  }
  return problems;
}

/**
 * Loads the page's products and adds what it finds about each to `report`.
 */
async function checkProducts(root: ParentNode, report: DiagnoseReport): Promise<void> {
  const allKeys = qsa(root, sel('product')).map((el) => resolveProductKey(el).key);
  const keys = [...new Set(allKeys.filter((key) => key !== null && key !== ''))].slice(0, MAX_PRODUCTS_CHECKED);
  const results = await Promise.allSettled(keys.map((key) => getProduct(key)));
  results.forEach((result, index) => {
    const key = keys[index] ?? '';
    if (result.status === 'rejected') {
      const reason = errorText(result.reason, 'not loaded');
      report.products.push({ key, error: result.reason instanceof Error ? result.reason.message : undefined });
      report.problems.push({
        level: 'error',
        message: `Product "${key}": ${reason}. Is it published to the Headless channel?`,
      });
      return;
    }
    const product = result.value;
    const plans = allPlans(product);
    report.products.push({
      key,
      handle: product.handle,
      title: product.title,
      plans: plans.length,
      requiresSellingPlan: product.requiresSellingPlan,
    });
    for (const plan of plans) {
      report.sellingPlans.push({ product: product.handle, group: plan.group.name, plan: plan.name, id: plan.id });
    }
    report.problems.push(...checkOptions(root, key, product));
  });
}

/** What's wrong on the page: config, token, API version, products, plans, markup. */
export async function diagnose({
  root = document,
  silent = false,
  version = '',
  now = new Date(),
}: DiagnoseOptions = {}): Promise<DiagnoseReport> {
  const storefront = await checkStorefront();
  const report: DiagnoseReport = {
    version,
    config: configSummary(),
    apiVersion: apiVersionStatus(cfg.apiVersion, now),
    market: await marketSummary(),
    reachable: storefront.kind === 'reachable',
    shop: storefront.kind === 'reachable' ? storefront.shop : null,
    latencyMs: storefront.kind === 'not-configured' ? null : storefront.latencyMs,
    products: [],
    sellingPlans: [],
    problems: [],
  };
  switch (storefront.kind) {
    case 'not-configured':
      report.problems.push({ level: 'error', message: 'TETHER_CONFIG needs domain and token.' });
      break;
    case 'unreachable':
      report.problems.push({
        level: 'error',
        message: `Storefront API not reachable: ${errorText(storefront.error, 'unknown error')}`,
      });
      break;
    case 'reachable':
      await checkProducts(root, report);
      break;
  }
  const versionProblem = apiVersionProblem(report.apiVersion);
  if (versionProblem) report.problems.push(versionProblem);
  if (typeof document !== 'undefined') report.problems.push(...checkMarkup(root));
  if (!silent) print(report);
  return report;
}

function print(report: DiagnoseReport): void {
  const errors = report.problems.filter((problem) => problem.level === 'error').length;
  const warnings = report.problems.length - errors;
  console.group(`[${cfg.prefix}] diagnose: ${errors ? `${errors} error(s)` : 'no errors'}, ${warnings} warning(s)`);
  console.log('version', report.version, '| API', report.apiVersion.version, `(${report.apiVersion.note})`);
  console.log('config', report.config);
  const { country, language, detected } = report.market;
  const inUse = [country, language].filter(Boolean).join(' / ') || 'the store default';
  console.log('market', `in use: ${inUse}`, detected ? `(detection picks ${JSON.stringify(detected)})` : '');
  console.log(
    report.shop
      ? `Storefront API reachable: ${report.shop.name} (${report.latencyMs ?? 0} ms)`
      : 'Storefront API NOT reachable',
  );
  if (report.products.length) console.table(report.products);
  if (report.sellingPlans.length) console.table(report.sellingPlans);
  else if (report.reachable) console.log('No selling plans on the products of this page.');
  for (const problem of report.problems) {
    if (problem.level === 'error') console.error(problem.message, problem.el ?? '');
    else console.warn(problem.message, problem.el ?? '');
  }
  console.groupEnd();
}
