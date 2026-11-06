/**
 * Optional part, loaded on first use: market detection, `select[tether-country-select]`, `tether-country-bind` and
 * `Tether.setCountry()`. See markets.js for the detection rules.
 */
import { cfg, reportError } from './config.js';
import { TetherError } from './client.js';
import { Cart } from './cart.js';
import { listSelector } from './collection.js';
import { clearProductCache } from './loader.js';
import { attr, sel, get, emit } from './dom.js';
import { within, pruneLive, liveLists, liveProducts, mountedProducts, mountProduct } from './mounting.js';
import { rememberMarket, getLocalization, clearLocalization } from './markets.js';
import { toCountry, toLanguage } from './market-codes.js';
/** @import { LocalizedCountry, Localization } from './markets.js' */
/** @import { CountryCode } from './market-codes.js' */

export { detectMarket, getLocalization } from './markets.js';

const DEFAULT_LABEL = '{name} ({currency})';
const DEFAULT_BIND = 'name';

/**
 * @typedef {object} SetCountryOptions
 * @property {string | null | undefined} [language] A Shopify language; `null` clears it. Default: the
 *   `markets.locales` entry for the country, else unchanged.
 * @property {string | undefined} [locale] The money format. Default: the `markets.locales` entry, else unchanged.
 * @property {boolean | undefined} [remember] Save the choice for the next pages (default true).
 */

/**
 * @param {LocalizedCountry} country
 * @param {string} field A `tether-country-bind` value or a label placeholder: `name`, `code`, `currency`, `symbol`.
 * @returns {string} `''` for any other field.
 */
function countryField(country, field) {
  switch (field) {
    case 'name':
      return country.name;
    case 'code':
      return country.isoCode;
    case 'currency':
      return country.currency.isoCode;
    case 'symbol':
      return country.currency.symbol;
    default:
      return '';
  }
}

/**
 * @param {string} template `tether-country-label`, e.g. `{name} ({currency})`.
 * @param {LocalizedCountry} country
 */
const fillLabel = (template, country) =>
  template.replace(/\{(name|code|currency|symbol)\}/g, (_match, /** @type {string} */ field) =>
    countryField(country, field),
  );

/**
 * @param {HTMLSelectElement} select
 * @param {LocalizedCountry[]} countries The store's countries, sorted by name.
 * @param {string} current The country in use.
 */
function fillCountrySelect(select, countries, current) {
  const template = select.getAttribute(attr('country-label')) || DEFAULT_LABEL;
  // tether-countries="NL,DE,BE": only these, in that order; otherwise every country of the store.
  const only = (select.getAttribute(attr('countries')) || '')
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const listed = only.length
    ? only
        .map((code) => countries.find((country) => country.isoCode === code))
        .filter((country) => country !== undefined)
    : countries;
  select.replaceChildren(...listed.map((country) => new Option(fillLabel(template, country), country.isoCode)));
  select.value = current;
  // A country the store doesn't sell to selects nothing.
  if (select.value !== current) select.selectedIndex = -1;
  select.disabled = listed.length < 2 && !select.hasAttribute(attr('always-enabled'));
}

/**
 * @param {HTMLSelectElement[]} selects
 * @param {HTMLElement[]} binds
 * @param {Localization} localization
 */
function fillCountries(selects, binds, localization) {
  const current = (cfg.country || localization.country.isoCode).toUpperCase();
  const countries = [...localization.availableCountries].sort((a, b) =>
    a.name.localeCompare(b.name, cfg.locale || undefined),
  );
  const inUse = countries.find((country) => country.isoCode === current) ?? localization.country;
  selects.forEach((select) => {
    fillCountrySelect(select, countries, current);
  });
  binds.forEach((el) => {
    el.textContent = countryField(inUse, get(el, 'country-bind') || DEFAULT_BIND);
  });
}

/**
 * Fills `select[tether-country-select]` with the countries the store sells to (Shopify Markets), and
 * `tether-country-bind="name|code|currency|symbol"` with the current country. `tether-country-label` sets the option
 * text from `{name}`, `{code}`, `{currency}` and `{symbol}`. A failure is reported, never thrown.
 *
 * @param {ParentNode} [root]
 * @returns {Promise<void>}
 */
export function renderCountrySelects(root = document) {
  const selects = /** @type {HTMLSelectElement[]} */ (within(root, `select${sel('country-select')}`));
  const binds = within(root, sel('country-bind'));
  if (!selects.length && !binds.length) return Promise.resolve();
  return getLocalization()
    .then((localization) => {
      fillCountries(selects, binds, localization);
    })
    .catch((/** @type {unknown} */ error) => {
      reportError(error, 'country select');
    });
}

/**
 * @param {CountryCode} country
 * @returns {{ country?: string, language?: string, locale?: string } | undefined} The `markets.locales` entry for it.
 */
const localeEntryFor = (country) =>
  Object.values(cfg.markets?.locales ?? {}).find((entry) => toCountry(entry.country) === country);

/**
 * @param {string | null | undefined} language The `setCountry()` option.
 * @param {{ language?: string } | undefined} entry The `markets.locales` entry for the country.
 * @returns {string | null | undefined} The option, else the entry's language (which may have none), else unchanged.
 */
function languageFor(language, entry) {
  if (language !== undefined) return toLanguage(language);
  if (!entry) return cfg.language;
  return entry.language ? toLanguage(entry.language) : undefined;
}

/**
 * Loads every live product and list again in the market `cfg` now holds, and moves an existing cart to `country`.
 *
 * @param {CountryCode} country
 * @returns {Promise<unknown>[]} The cart update and the list loads.
 */
function rerenderInMarket(country) {
  clearProductCache();
  /** @type {Promise<unknown>[]} */
  const jobs = [];
  // Only an existing cart moves; switching country never creates one.
  if (Cart.id()) {
    jobs.push(
      Cart.setBuyerIdentity({ countryCode: country }, { create: false }).catch((/** @type {unknown} */ error) => {
        reportError(error, 'cart country');
      }),
    );
  }
  pruneLive();
  liveLists.forEach((list) => jobs.push(list.load()));
  liveProducts.forEach((el) => {
    // A product inside a list is re-rendered by its list.
    if (el.closest(listSelector())) return;
    mountedProducts.delete(el);
    mountProduct(el);
  });
  return jobs;
}

/**
 * Switches the market: prices, currency and translations follow (`@inContext`), the cart's
 * `buyerIdentity.countryCode` is updated, and every product and list on the page re-renders.
 *
 *   Tether.setCountry('DE')            Tether.setCountry('BE', { language: 'FR' })
 *
 * @param {string} code
 * @param {SetCountryOptions} [options]
 * @returns {Promise<typeof Cart.state>} The cart once everything is in the new market.
 * @throws {TetherError} `INVALID_COUNTRY` for anything that isn't a country code.
 */
export async function setCountry(code, { language, locale, remember = true } = {}) {
  const country = toCountry(code);
  if (!country) throw new TetherError(`Not a country code: ${code}`, { code: 'INVALID_COUNTRY' });
  const entry = localeEntryFor(country);
  const ownLocale = locale || entry?.locale;
  const nextLocale = ownLocale || cfg.locale;
  const nextLanguage = languageFor(language, entry);
  const changed = country !== cfg.country?.toUpperCase() || nextLanguage !== cfg.language || nextLocale !== cfg.locale;
  cfg.country = country;
  cfg.language = nextLanguage || undefined;
  cfg.locale = nextLocale;
  if (remember) rememberMarket({ country, language: nextLanguage, locale: ownLocale });
  if (!changed) {
    void renderCountrySelects();
    return Cart.state;
  }
  // Country names follow the language.
  if (language !== undefined) clearLocalization();
  const jobs = rerenderInMarket(country);
  void renderCountrySelects();
  emit('country-changed', { country, language: cfg.language });
  await Promise.all(jobs);
  return Cart.state;
}
