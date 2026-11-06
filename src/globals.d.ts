/**
 * What Tether reads from and sets on `window`, for sites that use the `<script>` build or `window.Tether`. Only the
 * published declarations carry it (scripts/build.ts adds it to the generated `index.d.ts`): the source reads these
 * names as unknown and validates them, so they stay out of its own program.
 */
import type { Tether, TetherConfig } from './index.ts';

declare global {
  interface Window {
    Tether: Tether;
    TETHER_CONFIG?: TetherConfig;
    TETHER_COUNTRY?: string;
    TETHER_LANGUAGE?: string;
  }
}
