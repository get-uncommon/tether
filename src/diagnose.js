/**
 * `Tether.diagnose()`: one call in the browser console that explains what's wrong on a page. Logs a readable report
 * and returns it as an object. The markup checks are in diagnose-markup.js.
 *
 *   await Tether.diagnose()
 *   await Tether.diagnose({ silent: true })   // just the object
 */
import { cfg, isConfigured } from './config.js';
import { gql, endpoint } from './client.js';
import { sel, get, qsa } from './dom.js';
import { getProduct } from './loader.js';
import { allPlans } from './selling-plans.js';
import { resolveProductKey } from './status.js';
import { apiVersionStatus } from './api-version.js';
import { loadPart } from './lazy.js';
import { checkMarkup, didYouMean } from './diagnose-markup.js';
/** @import { ApiVersionStatus } from './api-version.js' */
/** @import { DetectedMarket } from './markets.js' */
/** @import { Problem } from './diagnose-markup.js' */
/** @import { Product } from './fragments.js' */

export { apiVersionStatus, checkMarkup, didYouMean };

/**
 * @typedef {object} MarketReport The market in use (a visitor's choice included), and what detection would pick.
 * @property {string | null} country
 * @property {string | null} language
 * @property {string | null} locale
 * @property {DetectedMarket | null} detected `null` without `markets.detect`.
 */
/** @typedef {{ name: string, url: string, currency: string }} ShopReport */
/**
 * @typedef {{ key: string, handle: string, title: string, plans: number, requiresSellingPlan: boolean }
 *   | { key: string, error: string | undefined }} ProductReport
 */
/** @typedef {{ product: string, group: string, plan: string, id: string }} SellingPlanReport */
/**
 * @typedef {object} DiagnoseReport
 * @property {string | undefined} version
 * @property {Record<string, unknown>} config The config, with the token masked.
 * @property {ApiVersionStatus} apiVersion
 * @property {MarketReport} market
 * @property {boolean} reachable
 * @property {ShopReport | null} shop
 * @property {number | null} latencyMs
 * @property {ProductReport[]} products
 * @property {SellingPlanReport[]} sellingPlans
 * @property {Problem[]} problems
 */
/**
 * @typedef {{ kind: 'not-configured' }
 *   | { kind: 'reachable', shop: ShopReport, latencyMs: number }
 *   | { kind: 'unreachable', error: unknown, latencyMs: number }} StorefrontCheck
 */
/**
 * @typedef {object} DiagnoseOptions
 * @property {ParentNode} [root]
 * @property {boolean} [silent] Return the report without logging it.
 * @property {string} [version] Tether's version, for the report.
 * @property {Date} [now] The date the API version's support is measured against.
 */

/** Products checked at most, so a long CMS page doesn't send a request per card. */
const MAX_PRODUCTS_CHECKED = 20;
/** Matches the warning window of `apiVersionStatus`. */
const API_UPGRADE_WARNING_MONTHS = 3;
const TOKEN_EDGE_CHARACTERS = 4;

/** @param {string} token */
function maskToken(token) {
  if (!token) return '(missing)';
  return `${token.slice(0, TOKEN_EDGE_CHARACTERS)}…${token.slice(-TOKEN_EDGE_CHARACTERS)} (${token.length} chars)`;
}

/**
 * @param {unknown} error
 * @param {string} fallback
 * @returns {string} The error's message, else its code (a `TetherError` has one), else `fallback`.
 */
function errorText(error, fallback) {
  if (error instanceof Error && error.message) return error.message;
  /** @type {unknown} */
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' && code ? code : fallback;
}

/** @returns {Record<string, unknown>} */
function configSummary() {
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
 *
 * @returns {Promise<MarketReport>}
 */
async function marketSummary() {
  return {
    country: cfg.country || null,
    language: cfg.language || null,
    locale: cfg.locale || null,
    detected: cfg.markets?.detect ? (await loadPart('markets')).detectMarket(cfg.markets) : null,
  };
}

/**
 * @param {ApiVersionStatus} status
 * @returns {Problem | null} An error for an unsupported version, a warning when support ends soon.
 */
function apiVersionProblem({ ok, monthsLeft, note }) {
  if (ok && (monthsLeft === undefined || monthsLeft >= API_UPGRADE_WARNING_MONTHS)) return null;
  return { level: ok ? 'warn' : 'error', message: `apiVersion ${cfg.apiVersion}: ${note}` };
}

/** @returns {Promise<StorefrontCheck>} */
async function checkStorefront() {
  if (!isConfigured()) return { kind: 'not-configured' };
  const startedAt = Date.now();
  try {
    /** @type {{ shop: { name: string, primaryDomain: { url: string }, paymentSettings: { currencyCode: string } } }} */
    const data = await gql(
      'query TetherDiagnose { shop { name primaryDomain { url } paymentSettings { currencyCode } } }',
      {},
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
 *
 * @param {ParentNode} root
 * @param {string} key
 * @param {Product} product
 * @returns {Problem[]}
 */
function checkOptions(root, key, product) {
  /** @type {Problem[]} */
  const problems = [];
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
 *
 * @param {ParentNode} root
 * @param {DiagnoseReport} report
 */
async function checkProducts(root, report) {
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

/**
 * @param {DiagnoseOptions} [options]
 * @returns {Promise<DiagnoseReport>} What's wrong on the page: config, token, API version, products, plans, markup.
 */
export async function diagnose({ root = document, silent = false, version, now = new Date() } = {}) {
  const storefront = await checkStorefront();
  /** @type {DiagnoseReport} */
  const report = {
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

/** @param {DiagnoseReport} report */
function print(report) {
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
