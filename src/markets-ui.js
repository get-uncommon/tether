// @ts-nocheck
/**
 * Optional part, loaded on first use: market detection, select[tether-country-select],
 * tether-country-bind and Tether.setCountry(). See markets.js for the detection rules.
 */
import { cfg, reportError } from './config.js';
import { TetherError } from './client.js';
import { Cart } from './cart.js';
import { listSelector } from './collection.js';
import { clearProductCache } from './loader.js';
import { attr, sel, get, emit } from './dom.js';
import { within, pruneLive, liveLists, liveProducts, mountedProducts, mountProduct } from './mounting.js';
import { rememberMarket, getLocalization, clearLocalization, toCountry, toLanguage } from './markets.js';

export { detectMarket, getLocalization } from './markets.js';

export /**
 * select[tether-country-select]: countries the store sells to (Shopify Markets).
 * tether-country-label="{name} ({currency})" sets the option text ({name}, {code}, {currency}, {symbol}).
 * tether-country-bind="name|code|currency|symbol" shows the current country anywhere.
 */
function renderCountrySelects(root = document) {
  const selects = within(root, `select${sel('country-select')}`);
  const binds = within(root, sel('country-bind'));
  if (!selects.length && !binds.length) return Promise.resolve();
  return getLocalization().then((loc) => {
    const current = (cfg.country || loc.country?.isoCode || '').toUpperCase();
    const countries = [...(loc.availableCountries || [])].sort((a, b) => a.name.localeCompare(b.name, cfg.locale || undefined));
    const info = countries.find((c) => c.isoCode === current) || loc.country;
    const fill = (tpl, c) => tpl.replace(/\{name\}/g, c.name).replace(/\{code\}/g, c.isoCode)
      .replace(/\{currency\}/g, c.currency?.isoCode || '').replace(/\{symbol\}/g, c.currency?.symbol || '');
    selects.forEach((s) => {
      const tpl = s.getAttribute(attr('country-label')) || '{name} ({currency})';
      // tether-countries="NL,DE,BE": only these (in your order); otherwise every country of the store.
      const only = (s.getAttribute(attr('countries')) || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
      const list = only.length ? only.map((c) => countries.find((x) => x.isoCode === c)).filter(Boolean) : countries;
      s.innerHTML = '';
      list.forEach((c) => s.appendChild(new Option(fill(tpl, c), c.isoCode)));
      s.value = current;
      if (s.value !== current) s.selectedIndex = -1; // a country the store doesn't sell to
      s.disabled = list.length < 2 && !s.hasAttribute(attr('always-enabled'));
    });
    binds.forEach((el) => {
      const k = get(el, 'country-bind') || 'name';
      const v = { name: info?.name, code: info?.isoCode, currency: info?.currency?.isoCode, symbol: info?.currency?.symbol }[k];
      el.textContent = v || '';
    });
  }).catch((err) => reportError(err, 'country select'));
}

/**
 * Switches the market: prices, currency and translations follow (@inContext), the cart's
 * buyerIdentity.countryCode is updated, and every product and list on the page re-renders.
 *   Tether.setCountry('DE')            Tether.setCountry('BE', { language: 'FR' })
 */
export async function setCountry(code, { language, locale, remember = true } = {}) {
  const country = toCountry(code);
  if (!country) throw new TetherError(`Not a country code: ${code}`, { code: 'INVALID_COUNTRY' });
  // Money format: the option, else a markets.locales entry for this country, else unchanged.
  const entry = Object.values(cfg.markets?.locales || {}).find((m) => toCountry(m?.country) === country);
  const own = locale || entry?.locale;
  const loc = own || cfg.locale;
  // Language: the option, else the markets.locales entry for this country (which may have none), else unchanged.
  const lang = language !== undefined ? toLanguage(language) : entry ? (entry.language ? toLanguage(entry.language) : undefined) : cfg.language;
  const changed = country !== String(cfg.country || '').toUpperCase() || lang !== cfg.language || loc !== cfg.locale;
  cfg.country = country;
  cfg.language = lang || undefined;
  cfg.locale = loc;
  if (remember) rememberMarket({ country, language: lang, locale: own });
  if (!changed) { renderCountrySelects(); return Cart.state; }

  clearProductCache();
  const jobs = [];
  if (language !== undefined) clearLocalization(); // country names follow the language
  // Only an existing cart moves; switching country never creates one.
  if (Cart.id()) jobs.push(Cart.setBuyerIdentity({ countryCode: country }, { create: false }).catch((err) => reportError(err, 'cart country')));

  pruneLive();
  liveLists.forEach((list) => jobs.push(list.load()));
  liveProducts.forEach((el) => {
    if (el.closest(listSelector())) return; // re-rendered by its list
    mountedProducts.delete(el);
    mountProduct(el);
  });

  renderCountrySelects();
  emit('country-changed', { country, language: cfg.language });
  await Promise.all(jobs);
  return Cart.state;
}

