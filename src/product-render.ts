/**
 * The DOM writes of a product scope that depend on the product alone, once per product: its binds, the option and
 * plan lists and the options of its selects. `variant-render.ts` writes what follows the visitor's choice.
 */
import {
  attr,
  sel,
  get,
  has,
  qsa,
  formatMoney,
  formatDate,
  setText,
  setImage,
  setStoreHtml,
  show,
  repeat,
  hasTemplate,
  sameImage,
  productUrl,
} from './dom.ts';
import type { Product } from './fragments.ts';
import type { PlanInGroup } from './selling-plans.ts';

/** The product scope as its renders see it. */
export interface RenderScope {
  readonly root: HTMLElement;
  readonly product: Product;
  readonly plans: PlanInGroup[];
  /** Matches in this scope, the root included. */
  $: (selector: string) => HTMLElement[];
  /** The product's option name for one written in the markup. */
  optName: (authored: string | null) => string;
}

/** `tether-bind="image:2"`: the second product image. */
const NTH_IMAGE_BIND = /^image:(\d+)$/;
const METAFIELD_BIND = 'metafield:';
const MULTI_LINE_METAFIELD = /^(rich_text|multi_line_text)_field$/;
/** `tether-plan-list` values that list every plan, not one group: Webflow's Designer can't always leave it empty. */
const ALL_PLAN_GROUPS = ['', 'true', 'all', '*'];

export const isSelect = (el: Element): el is HTMLSelectElement => el.tagName === 'SELECT';

/** @returns The `<select>` elements in the scope that match `selector`. */
export const selectsIn = (scope: RenderScope, selector: string): HTMLSelectElement[] =>
  scope.$(`select${selector}`).filter(isSelect);

/** Leaves a server-rendered gallery with the same images as it is. */
function renderGallery(el: HTMLElement, product: Product): void {
  const images = product.images.nodes;
  const rendered = [...el.children].map((node) => (node.tagName === 'IMG' ? node : node.querySelector('img')));
  const same =
    !hasTemplate(el) &&
    rendered.length === images.length &&
    rendered.every((img, index) => sameImage(img?.getAttribute('src'), images[index]?.url));
  if (same) return;
  repeat(el, images, (node, image) => {
    const target = node.matches(`img,${sel('bind', 'image')}`) ? node : (qsa(node, 'img')[0] ?? node);
    setImage(target, image.url, image.altText || product.title);
  });
}

/** @param ref `namespace.key` */
function renderMetafield(el: HTMLElement, product: Product, ref: string): void {
  const dot = ref.indexOf('.');
  const namespace = ref.slice(0, dot);
  const key = ref.slice(dot + 1);
  const metafield = (product.metafields ?? []).find((field) => field?.namespace === namespace && field.key === key);
  if (!metafield) {
    setText(el, '');
    return;
  }
  const image = metafield.reference?.image;
  if (image) {
    setImage(el, image.url, image.altText);
    return;
  }
  if (MULTI_LINE_METAFIELD.test(metafield.type)) el.style.whiteSpace = 'pre-line';
  setText(el, metafield.value);
}

/** The product binds written as text. */
const PRODUCT_TEXTS = new Map<string, (product: Product) => string>(
  Object.entries({
    title: (product) => product.title,
    'description-text': (product) => product.description,
    vendor: (product) => product.vendor,
    type: (product) => product.productType,
    handle: (product) => product.handle,
    'published-at': (product) => formatDate(product.publishedAt),
    'min-price': (product) => formatMoney(product.priceRange.minVariantPrice),
    'max-price': (product) => formatMoney(product.priceRange.maxVariantPrice),
  }),
);

function renderTags(el: HTMLElement, product: Product): void {
  const exclude = (el.getAttribute('exclude') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const tags = product.tags.filter((tag) => !exclude.includes(tag));
  repeat(el, tags, (node, tag) => {
    setText(node, tag);
  });
}

/**
 * A `tether-bind` of the product itself; binds of the variant are left to `writeVariant`.
 */
function renderProductBind(el: HTMLElement, key: string, product: Product): void {
  const text = PRODUCT_TEXTS.get(key);
  if (text) {
    setText(el, text(product));
    return;
  }
  switch (key) {
    case 'description':
      setStoreHtml(el, product.descriptionHtml);
      break;
    case 'featured-image':
      setImage(el, product.featuredImage?.url, product.featuredImage?.altText || product.title);
      break;
    case 'url':
    case 'link': {
      const url = productUrl(product.handle, product.id);
      if (url) el.setAttribute('href', url);
      if (key === 'url' && !el.firstElementChild && !el.textContent.trim()) setText(el, product.title);
      break;
    }
    case 'images':
      renderGallery(el, product);
      break;
    case 'tags':
      renderTags(el, product);
      break;
    default:
      renderIndexedBind(el, key, product);
  }
}

/** `image:<n>` (falling back to the featured image) and `metafield:<namespace.key>`. */
function renderIndexedBind(el: HTMLElement, key: string, product: Product): void {
  const nth = NTH_IMAGE_BIND.exec(key);
  if (nth) {
    const image = product.images.nodes[Number(nth[1]) - 1] ?? product.featuredImage;
    setImage(el, image?.url, image?.altText || product.title);
  } else if (key.startsWith(METAFIELD_BIND)) {
    renderMetafield(el, product, key.slice(METAFIELD_BIND.length));
  }
}

function renderOptionLists(scope: RenderScope): void {
  const { product } = scope;
  scope.$(sel('option-list')).forEach((container) => {
    const name = scope.optName(get(container, 'option-list'));
    const option = product.options.find((candidate) => candidate.name === name);
    if (!option || (option.optionValues.length <= 1 && has(container, 'hide-single'))) {
      show(container, false);
      return;
    }
    repeat(container, option.optionValues, (node, value) => {
      node.setAttribute(attr('option-value'), value.name);
      const text = qsa(node, sel('bind', 'option-value'))[0];
      if (text) setText(text, value.name);
      else if (!node.firstElementChild) setText(node, value.name);
      const swatchEl = qsa(node, sel('bind', 'swatch'))[0];
      const { swatch } = value;
      if (!swatchEl || !swatch) return;
      if (swatch.color) swatchEl.style.backgroundColor = swatch.color;
      if (swatch.image?.previewImage) setImage(swatchEl, swatch.image.previewImage.url, value.name);
    });
  });
}

function renderSelects(scope: RenderScope): void {
  const { product } = scope;
  selectsIn(scope, sel('option')).forEach((select) => {
    const option = product.options.find((candidate) => candidate.name === scope.optName(get(select, 'option')));
    if (!option) {
      show(select, false);
      return;
    }
    select.replaceChildren(...option.optionValues.map((value) => new Option(value.name, value.name)));
  });
  selectsIn(scope, sel('variant-select')).forEach((select) => {
    select.replaceChildren(...product.variants.nodes.map((variant) => new Option(variant.title, variant.id)));
  });
  selectsIn(scope, sel('plan')).forEach((select) => {
    const plans = scope.plans.map((plan) => new Option(plan.name, plan.id));
    const oneTime = !product.requiresSellingPlan && get(select, 'plan') !== 'subscription-only';
    const oneTimeLabel = select.getAttribute(attr('one-time-label')) || 'One-time purchase';
    select.replaceChildren(...(oneTime ? [new Option(oneTimeLabel, '')] : []), ...plans);
  });
}

function renderPlanLists(scope: RenderScope): void {
  scope.$(sel('plan-list')).forEach((container) => {
    // The value is a selling plan group's name, or one of ALL_PLAN_GROUPS.
    const raw = (get(container, 'plan-list') ?? '').trim();
    const group = ALL_PLAN_GROUPS.includes(raw.toLowerCase()) ? null : raw;
    const plans = scope.plans.filter((plan) => !group || plan.group.name === group);
    repeat(container, plans, (node, plan) => {
      node.setAttribute(attr('plan-value'), plan.id);
      if (!node.firstElementChild && !node.querySelector(sel('plan-bind'))) setText(node, plan.name);
    });
  });
}

/** Writes what depends on the product alone: its binds, option and plan lists and the selects' options. */
export function writeProduct(scope: RenderScope): void {
  scope.$(sel('bind')).forEach((el) => {
    renderProductBind(el, get(el, 'bind') ?? '', scope.product);
  });
  renderOptionLists(scope);
  renderSelects(scope);
  renderPlanLists(scope);
}
