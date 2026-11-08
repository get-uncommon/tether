/**
 * Optional part, loaded on first use: market detection, the store's countries (`Tether.getLocalization()`),
 * `select[tether-country-select]`, `tether-country-bind` and `Tether.setCountry()`. See markets.ts for the detection
 * rules.
 */
import { cfg, reportError } from './config.ts';
import { gql, shaped, TetherError } from './client.ts';
import { Cart } from './cart.ts';
import { listSelector } from './collection.ts';
import { clearProductCache } from './loader.ts';
import { attr, sel, get, emit } from './dom.ts';
import { within, pruneLive, liveLists, liveProducts, mountedProducts, mountProduct } from './mounting.ts';
import { rememberMarket } from './markets.ts';
import { toCountry, toLanguage } from './market-codes.ts';
import type { LocalizedCountry, Localization } from './markets.ts';
import type { CountryCode, LanguageCode } from './market-codes.ts';

export { detectMarket } from './markets.ts';

const DEFAULT_LABEL = '{name} ({currency})';
const DEFAULT_BIND = 'name';

let localizationPromise: Promise<Localization> | null = null;

/** Forgets the cached localization, for when country names change language. */
function clearLocalization(): void {
  localizationPromise = null;
}

const LOCALIZATION_QUERY = `query TetherLocalization {
  localization {
    country { isoCode name currency { isoCode symbol } }
    language { isoCode name }
    availableCountries { isoCode name currency { isoCode symbol } availableLanguages { isoCode name } }
  }
}`;

/** A country with the code, name and currency the country select and binds read. */
const COUNTRY = { isoCode: 'string', name: 'string', currency: 'object' } as const;
const isLocalizationAnswer = shaped<{ localization: Localization }>({
  localization: { country: COUNTRY, availableCountries: [COUNTRY] },
});

/**
 * The countries the store sells to (Shopify Markets), with their currency. Cached per page; a failed request is not
 * cached, so the next call tries again.
 */
export function getLocalization(): Promise<Localization> {
  localizationPromise ??= gql(LOCALIZATION_QUERY, {}, isLocalizationAnswer).then(
    (data) => data.localization,
    (error: unknown) => {
      localizationPromise = null;
      throw error;
    },
  );
  return localizationPromise;
}

interface SetCountryOptions {
  /** A Shopify language; `null` clears it. Default: the `markets.locales` entry for the country, else unchanged. */
  language?: string | null | undefined;
  /** The money format. Default: the `markets.locales` entry, else unchanged. */
  locale?: string | undefined;
  /** Save the choice for the next pages (default true). */
  remember?: boolean | undefined;
}

/**
 * @param field A `tether-country-bind` value or a label placeholder: `name`, `code`, `currency`, `symbol`.
 * @returns `''` for any other field.
 */
function countryField(country: LocalizedCountry, field: string): string {
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

/** @param template `tether-country-label`, e.g. `{name} ({currency})`. */
const fillLabel = (template: string, country: LocalizedCountry) =>
  template.replace(/\{(name|code|currency|symbol)\}/g, (_match, field: string) => countryField(country, field));

/**
 * @param countries The store's countries, sorted by name.
 * @param current The country in use.
 */
function fillCountrySelect(select: HTMLSelectElement, countries: LocalizedCountry[], current: string): void {
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

function fillCountries(selects: HTMLSelectElement[], binds: HTMLElement[], localization: Localization): void {
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

/** Whether the document's `change` listener for the country selects is bound: once, with the first select. */
let followingSelects = false;

/** A country the visitor chose in a `select[tether-country-select]` becomes the market. */
function onCountrySelectChange(event: Event): void {
  const { target } = event;
  if (!(target instanceof window.HTMLSelectElement) || !target.matches(sel('country-select')) || !target.value) return;
  setCountry(target.value).catch((error: unknown) => {
    reportError(error, 'country');
  });
}

/**
 * Fills `select[tether-country-select]` with the countries the store sells to (Shopify Markets), and
 * `tether-country-bind="name|code|currency|symbol"` with the current country. `tether-country-label` sets the option
 * text from `{name}`, `{code}`, `{currency}` and `{symbol}`. A failure is reported, never thrown.
 */
export function renderCountrySelects(root: ParentNode = document): Promise<void> {
  // The selector matches `select` elements only.
  const selects = within(root, `select${sel('country-select')}`) as HTMLSelectElement[];
  const binds = within(root, sel('country-bind'));
  if (selects.length && !followingSelects) {
    followingSelects = true;
    document.addEventListener('change', onCountrySelectChange);
  }
  if (!selects.length && !binds.length) return Promise.resolve();
  return getLocalization()
    .then((localization) => {
      fillCountries(selects, binds, localization);
    })
    .catch((error: unknown) => {
      reportError(error, 'country select');
    });
}

/** The `markets.locales` entry for `country`. */
const localeEntryFor = (country: CountryCode) =>
  Object.values(cfg.markets?.locales ?? {}).find((entry) => toCountry(entry.country) === country);

/**
 * @param language The `setCountry()` option.
 * @param entry The `markets.locales` entry for the country.
 * @returns The option, else the entry's language (which may have none), else unchanged.
 */
function languageFor(
  language: string | null | undefined,
  entry: { language?: string } | undefined,
): LanguageCode | null | undefined {
  if (language !== undefined) return toLanguage(language);
  if (!entry) return cfg.language;
  return entry.language ? toLanguage(entry.language) : undefined;
}

/**
 * Loads every live product and list again in the market `cfg` now holds, and moves an existing cart to `country`.
 *
 * @returns The cart update and the list loads.
 */
function rerenderInMarket(country: CountryCode): Promise<unknown>[] {
  clearProductCache();
  const jobs: Promise<unknown>[] = [];
  // Only an existing cart moves; switching country never creates one.
  if (Cart.id()) {
    jobs.push(
      Cart.setBuyerIdentity({ countryCode: country }, { create: false }).catch((error: unknown) => {
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
 * @returns The cart once everything is in the new market.
 * @throws {TetherError} `INVALID_COUNTRY` for anything that isn't a country code.
 */
export async function setCountry(
  code: string,
  { language, locale, remember = true }: SetCountryOptions = {},
): Promise<typeof Cart.state> {
  const country = toCountry(code);
  if (!country) throw new TetherError(`Not a country code: ${code}`, { code: 'INVALID_COUNTRY' });
  const entry = localeEntryFor(country);
  const ownLocale = locale || entry?.locale;
  const nextLocale = ownLocale || cfg.locale;
  const nextLanguage = languageFor(language, entry);
  const changed = country !== cfg.country || nextLanguage !== cfg.language || nextLocale !== cfg.locale;
  const previousLanguage = cfg.language;
  cfg.country = country;
  cfg.language = nextLanguage || undefined;
  cfg.locale = nextLocale;
  if (remember) rememberMarket({ country, language: nextLanguage, locale: ownLocale });
  if (!changed) {
    void renderCountrySelects();
    return Cart.state;
  }
  // Country names follow the language.
  if (cfg.language !== previousLanguage) clearLocalization();
  const jobs = rerenderInMarket(country);
  void renderCountrySelects();
  emit('country-changed', { country, language: cfg.language });
  await Promise.all(jobs);
  return Cart.state;
}
