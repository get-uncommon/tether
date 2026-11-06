/**
 * The markup half of `Tether.diagnose()`: problems that show without the network. It knows every value and attribute
 * name Tether reads, so a typo gets a "did you mean".
 */
import { cfg } from './config.js';
import { attr, sel, get, qsa, hasTemplate } from './dom.js';
import { resolveProductKey, boundary } from './status.js';

/** @typedef {'error' | 'warn'} ProblemLevel */
/**
 * @typedef {object} Problem
 * @property {ProblemLevel} level
 * @property {string} message
 * @property {string} [element] The element, described for people: `<div#id.class>`.
 * @property {Element} [el] The element itself, for the console.
 */
/** @typedef {(level: ProblemLevel, message: string, el?: Element) => void} AddProblem */

/** Every `tether-show` value. */
const SHOW = new Set([
  'in-stock',
  'out-of-stock',
  'backorder',
  'low-stock',
  'plenty-in-stock',
  'on-sale',
  'not-on-sale',
  'has-variants',
  'single-variant',
  'subscription-available',
  'subscription-unavailable',
  'subscription-only',
  'one-time-available',
  'subscription-selected',
  'one-time-selected',
  'has-savings',
  'loading',
  'ready',
  'error',
  'not-found',
  'cart-empty',
  'cart-filled',
  'cart-has-subscription',
  'cart-no-subscription',
  'cart-has-discount',
  'cart-error',
  'cart-warning',
  'list-empty',
  'list-filled',
  'search-empty',
  'search-results',
  'logged-in',
  'logged-out',
  'orders-empty',
  'orders-loading',
  'addresses-loading',
  'addresses-empty',
  'addresses-error',
  'subscriptions-loading',
  'subscriptions-empty',
  'subscriptions-error',
]);
/** Every `tether-bind` value, apart from `image:<n>` and `metafield:<namespace.key>`. */
const BIND = new Set([
  'title',
  'description',
  'description-text',
  'vendor',
  'type',
  'handle',
  'published-at',
  'price',
  'total-price',
  'compare-at-price',
  'unit-price',
  'min-price',
  'max-price',
  'discount-percentage',
  'discount-amount',
  'variant-title',
  'variant-id',
  'sku',
  'barcode',
  'stock',
  'quantity',
  'featured-image',
  'variant-image',
  'images',
  'tags',
  'link',
  'url',
  'one-time-price',
  'subscription-price',
  'subscription-savings',
  'subscription-savings-amount',
  'checkout-charge',
  'plan-name',
  'plan-description',
  'plan-group',
  'option-value',
  'swatch',
  'image',
]);
/** Every attribute name Tether reads, without the prefix. */
const ATTRIBUTES = new Set(
  `account account-bind account-link account-login account-logout add-label add-to-cart adding-text
  always-enabled bind cart-checkout-charge cart-clear cart-close cart-count cart-discounts cart-drawer cart-label cart-lines
  cart-note cart-open cart-subtotal cart-total cart-warning checkout code collection collection-bind countries country
  country-bind country-label country-select default-plan default-purchase discount discount-code discount-form discount-input
  discount-remove display error group group-add hide-single language limit line line-attribute line-attributes line-id
  line-minus line-plan line-plus line-remove line-show list load-more market-pending one-time-label option option-list
  option-selected option-value order order-bind order-line order-lines order-line-show order-show order-state order-fulfillments
  fulfillment-bind order-return return-quantity return-reason return-note orders profile-form address-form addresses address-bind
  address-show address-edit address-new address-delete address-default subscriptions subscription-bind subscription-lines
  subscription-line subscription-show subscription-action subscription-status subscription-state confirm form-state form-error page-country page-language page-locale page-title plan plan-bind plan-list
  plan-value product products purchase purchase-mode qty qty-minus qty-plus quantity recommendations reverse search
  search-bind search-collections search-input search-limit search-min search-products search-queries search-results
  search-state show soldout-text sort state subscribe-text variant variant-select variant-url max-width max-height crop
  sig label hydrated busy`
    .split(/\s+/)
    .filter(Boolean),
);
/** Attributes that only work inside a `tether-product`. */
const PRODUCT_ONLY = [
  'bind',
  'option-list',
  'option',
  'variant-select',
  'add-to-cart',
  'purchase',
  'plan-list',
  'plan',
  'qty',
  'line-attribute',
];
const REPEATERS = ['option-list', 'plan-list', 'cart-lines', 'list'];
const METAFIELD_BIND = 'metafield:';
const IMAGE_BIND = /^image:\d+$/;
/** The class names of an element that its description shows. */
const DESCRIBED_CLASSES = 2;

/**
 * @param {string} from
 * @param {string} to
 * @returns {number} The Levenshtein distance: the fewest single-character edits from one to the other.
 */
function editDistance(from, to) {
  /** @type {number[]} */
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let i = 1; i <= from.length; i++) {
    const row = [i];
    for (let j = 1; j <= to.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (from[i - 1] === to[j - 1] ? 0 : 1);
      row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, substitution));
    }
    previous = row;
  }
  return previous[to.length] ?? 0;
}

/**
 * @param {string} value What the markup says.
 * @param {Iterable<string>} options What Tether reads.
 * @param {string} [prefix] Put before the suggestion, e.g. `tether-`.
 * @returns {string} ` Did you mean "…"?` for an option close enough to `value`, else `''`.
 */
export function didYouMean(value, options, prefix = '') {
  /** @type {string | null} */
  let best = null;
  let bestDistance = Infinity;
  for (const option of options) {
    const distance = editDistance(value, option);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  const closeEnough = Math.max(2, Math.floor(value.length / 4));
  return best !== null && bestDistance <= closeEnough ? ` Did you mean "${prefix}${best}"?` : '';
}

/**
 * @param {Element} el
 * @returns {string} `<div#id.first.second>`.
 */
function describe(el) {
  const id = el.id ? `#${el.id}` : '';
  const classes = el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
  const classText = classes.length ? `.${classes.slice(0, DESCRIBED_CLASSES).join('.')}` : '';
  return `<${el.tagName.toLowerCase()}${id}${classText}>`;
}

const listSelector = () => `${sel('collection')},${sel('products')},${sel('recommendations')}`;

/**
 * @param {ParentNode} root
 * @param {AddProblem} add
 */
function checkProductKeys(root, add) {
  qsa(root, sel('product')).forEach((el) => {
    // A list card gets its handle when the list renders.
    if (el.closest(listSelector()) && el.closest(sel('list'))) return;
    const { key, fromUrl, raw } = resolveProductKey(el);
    if (!raw) {
      add(
        'error',
        `${attr('product')} has no value. Bind it to the Shopify handle (CMS field), or use "url:handle".`,
        el,
      );
    } else if (fromUrl && !key) {
      add('warn', `${attr('product')}="${raw}" but this URL has no value for it (e.g. ?handle=my-product).`, el);
    }
  });
}

/**
 * @param {ParentNode} root
 * @param {AddProblem} add
 */
function checkPlacement(root, add) {
  for (const name of PRODUCT_ONLY) {
    qsa(root, sel(name)).forEach((el) => {
      if (el.closest(sel('product'))) return;
      if (name === 'line-attribute' && el.closest(sel('group'))) return;
      add('warn', `${attr(name)} outside any ${attr('product')}: it does nothing here.`, el);
    });
  }
  qsa(root, sel('group-add')).forEach((el) => {
    if (!el.closest(sel('group'))) add('warn', `${attr('group-add')} outside a ${attr('group')}.`, el);
  });
  for (const name of REPEATERS) {
    qsa(root, sel(name)).forEach((el) => {
      if (!el.firstElementChild && !hasTemplate(el)) {
        add('warn', `${attr(name)} without a template child: put one example element inside it.`, el);
      }
    });
  }
  qsa(root, listSelector()).forEach((el) => {
    if (!qsa(el, sel('list')).length) {
      add('error', `List without a ${attr('list')} child: products have nowhere to render.`, el);
    }
  });
}

/**
 * @param {ParentNode} root
 * @param {AddProblem} add
 */
function checkValues(root, add) {
  qsa(root, sel('show')).forEach((el) => {
    const value = get(el, 'show') ?? '';
    if (!SHOW.has(value)) add('warn', `Unknown ${attr('show')}="${value}".${didYouMean(value, SHOW)}`, el);
  });
  qsa(root, sel('bind')).forEach((el) => {
    const value = get(el, 'bind') || '';
    if (!value || BIND.has(value) || IMAGE_BIND.test(value) || value.startsWith(METAFIELD_BIND)) return;
    add('warn', `Unknown ${attr('bind')}="${value}": it stays empty.${didYouMean(value, BIND)}`, el);
  });
}

/**
 * @param {ParentNode} root
 * @param {AddProblem} add
 */
function checkMetafieldBinds(root, add) {
  qsa(root, sel('bind')).forEach((el) => {
    const value = get(el, 'bind') || '';
    if (!value.startsWith(METAFIELD_BIND)) return;
    const ref = value.slice(METAFIELD_BIND.length);
    const listed = cfg.metafields.some(
      (metafield) => (typeof metafield === 'string' ? metafield : `${metafield.namespace}.${metafield.key}`) === ref,
    );
    if (!listed) {
      add('error', `${attr('bind')}="${value}" but "${ref}" is not in config.metafields, so it stays empty.`, el);
    }
  });
}

/**
 * Typos in attribute names (tether-bnd, tether-add-to-card) do nothing, silently. Each unknown name is reported once.
 *
 * @param {ParentNode} root
 * @param {AddProblem} add
 */
function checkAttributeNames(root, add) {
  const prefix = `${cfg.prefix}-`;
  /** @type {Set<string>} */
  const reported = new Set();
  qsa(root, '*').forEach((el) => {
    for (const { name: fullName } of el.attributes) {
      if (!fullName.startsWith(prefix)) continue;
      const name = fullName.slice(prefix.length);
      if (ATTRIBUTES.has(name) || reported.has(name)) continue;
      reported.add(name);
      add('warn', `Unknown attribute ${fullName}: Tether ignores it.${didYouMean(name, ATTRIBUTES, prefix)}`, el);
    }
  });
}

/**
 * @param {ParentNode} root
 * @param {AddProblem} add
 */
function checkCartAndScopes(root, add) {
  const drawers = qsa(root, sel('cart-drawer')).length;
  if (qsa(root, sel('cart-open')).length && !drawers) {
    add('warn', `${attr('cart-open')} exists but there is no ${attr('cart-drawer')} on this page.`);
  }
  if (drawers > 1) add('warn', `More than one ${attr('cart-drawer')}.`);
  qsa(root, `[${attr('state')}="error"]`).forEach((el) => {
    if (el.matches(boundary())) add('error', `Scope failed to load (${get(el, 'error') || 'error'}).`, el);
  });
}

/**
 * @param {ParentNode} [root]
 * @returns {Problem[]} The markup problems in `root`, in page order per check.
 */
export function checkMarkup(root = document) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {AddProblem} */
  const add = (level, message, el) => {
    problems.push(el ? { level, message, element: describe(el), el } : { level, message });
  };
  checkProductKeys(root, add);
  checkPlacement(root, add);
  checkValues(root, add);
  checkAttributeNames(root, add);
  checkMetafieldBinds(root, add);
  checkCartAndScopes(root, add);
  return problems;
}
