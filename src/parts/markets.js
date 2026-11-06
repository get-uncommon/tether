// The <script> build's tether.markets.js: registers the part where the core script's loader (lazy-iife.js) finds it.
import * as part from '../markets-ui.js';

const { Tether } = /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */ (window);
if (!Tether) throw new Error('tether.markets.js runs after the Tether script, which loads it');
Tether.__parts['markets'] = part;
