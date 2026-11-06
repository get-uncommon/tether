/**
 * Where the `<script>` build's parts meet the core: `window.Tether` as the core script set it up (`TetherInternals`).
 * Another script can replace that global after the core, with an object that has none of it; each side checks it.
 */
import { isRecord } from '../server/src/shared/json.ts';
import type { PartName, Parts, TetherInternals } from './lazy.ts';

/** @returns True when `value` carries the core's modules and parts, as the core script's `window.Tether` does. */
export function isTetherInternals(value: unknown): value is TetherInternals {
  return isRecord(value) && isRecord(value['__core']) && isRecord(value['__parts']);
}

/**
 * Registers a part's module with the core that loads it.
 *
 * @throws {Error} When `window.Tether` isn't the core script's: the part ran without it, or another script replaced it.
 */
export function registerPart<Name extends PartName>(name: Name, part: Parts[Name]): void {
  const tether: unknown = Reflect.get(window, 'Tether');
  if (!isTetherInternals(tether)) {
    throw new Error(`tether.${name}.js runs after the Tether script, which loads it, and needs its window.Tether`);
  }
  tether.__parts[name] = part;
}
