// The <script> build's tether.diagnose.js: registers the part where the core script's loader (lazy-iife.js) finds it.
import * as part from '../diagnose.js';

const { Tether } = /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */ (window);
if (!Tether) throw new Error('tether.diagnose.js runs after the Tether script, which loads it');
Tether.__parts['diagnose'] = part;
