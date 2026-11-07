/**
 * Selections the core's product queries share with the lists part and the sync's catalog. They import nothing, so the
 * lists part bundles its own copy of `collectionFields` instead of the core shipping it for that part alone.
 */

/** The image fields Tether renders, for inside an `Image` selection. */
export const IMAGE_FIELDS = 'url altText width height';

/** The collection fields Tether renders, for inside a `collection { }` selection. */
export function collectionFields(): string {
  return `
  id handle title description descriptionHtml
  image { ${IMAGE_FIELDS} }
  seo { title description }`;
}
