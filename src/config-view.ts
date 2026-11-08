/**
 * `Tether.config`: the live config, read through a view that refuses every change, so a value can only reach it
 * through `configure()`, which validates it.
 */
import { cfg, warn } from './config.ts';
import type { TetherConfig } from './config.ts';

function refuseChange(key: string | symbol): false {
  warn(`Tether.config is read-only (${String(key)}): pass options to Tether.init() instead`);
  return false;
}

/** Each config object's read-only view, made once, so reading the same object twice gives the same view. */
const readOnlyViews = new WeakMap<object, object>();

/**
 * Reads the live values, each object among them through its own view, and refuses every change: a write throws in
 * strict-mode code (as on a frozen object) and warns in any code.
 */
const READ_ONLY: ProxyHandler<object> = {
  get: (object, key) => viewOf(Reflect.get(object, key)),
  // A descriptor's value is the view too, so `Object.getOwnPropertyDescriptor` doesn't hand out the live object.
  getOwnPropertyDescriptor(object, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    if (descriptor) descriptor.value = viewOf(descriptor.value);
    return descriptor;
  },
  set: (_object, key) => refuseChange(key),
  deleteProperty: (_object, key) => refuseChange(key),
  defineProperty: (_object, key) => refuseChange(key),
};

/** @returns An object's read-only view; any other value as it is. */
function viewOf(value: unknown): unknown {
  // The config's objects are its own copies (`resolveConfig`), never frozen and configurable, so a view of each is
  // allowed, in `get` and in a descriptor.
  return typeof value === 'object' && value !== null ? readOnlyView(value) : value;
}

/** @returns The read-only view of `target`, the same one on every call. */
function readOnlyView(target: object): object {
  let view = readOnlyViews.get(target);
  if (!view) {
    view = new Proxy(target, READ_ONLY);
    readOnlyViews.set(target, view);
  }
  return view;
}

/**
 * `cfg` as `Tether.config` shows it. A value written there would skip the validation `configure()` does, so the view
 * is read-only; `Tether.init(options)` is how a site changes the config.
 */
export const configView = new Proxy<TetherConfig>(cfg, READ_ONLY);
