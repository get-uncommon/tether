import type { TetherConfig } from './config.js';
/**
 * `cfg` as `Tether.config` shows it. A value written there would skip the validation `configure()` does, so the view
 * is read-only; `Tether.init(options)` is how a site changes the config.
 */
export declare const configView: TetherConfig;
