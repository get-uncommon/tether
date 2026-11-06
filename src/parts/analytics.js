// The <script> build's tether.analytics.js: registers the part where the core script's loader (lazy-iife.js) finds it.
import * as part from '../analytics.js';

const { Tether } = /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */ (window);
if (!Tether) throw new Error('tether.analytics.js runs after the Tether script, which loads it');
Tether.__parts['analytics'] = part;
