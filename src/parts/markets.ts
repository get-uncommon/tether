// The <script> build's tether.markets.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../markets-ui.ts';
import type { TetherInternals } from '../lazy.ts';

const { Tether } = window as { Tether?: TetherInternals };
if (!Tether) throw new Error('tether.markets.js runs after the Tether script, which loads it');
Tether.__parts.markets = part;
