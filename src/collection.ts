/**
 * The core's side of product lists ([tether-collection="handle"], [tether-products="search query"] and
 * [tether-recommendations]): finding them, and the handle each mounted list keeps. Querying and rendering them is the
 * optional lists part (`lists.ts`), which the first load of a list loads.
 */
import { reportError } from './config.ts';
import { sel } from './dom.ts';
import { loadPart } from './lazy.ts';
import { setScopeStatus } from './status.ts';

export const listSelector = () => `${sel('collection')},${sel('products')},${sel('recommendations')}`;

/** A mounted list: its root, and loading its products again (after a country switch, or back online). */
export interface MountedList {
  root: HTMLElement;
  /** Never rejects: a failure shows in the list's state and is reported. */
  load: () => Promise<void>;
}

/** @returns The list at `root`, in its loading state until its first load renders it. */
export function mountedList(root: HTMLElement): MountedList {
  setScopeStatus(root, 'loading');
  return {
    root,
    load: () =>
      loadPart('lists')
        .then((part) => part.loadList(root))
        .catch((error: unknown) => {
          // The part didn't load: the list can't show its products.
          setScopeStatus(root, 'error', error);
          reportError(error, 'lists');
        }),
  };
}
