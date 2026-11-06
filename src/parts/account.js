// The <script> build's tether.account.js: registers the part where the core script's loader (lazy-iife.js) finds it.
import * as part from '../account.js';

const { Tether } = /** @type {Window & { Tether?: { __parts: Record<string, unknown> } }} */ (window);
if (!Tether) throw new Error('tether.account.js runs after the Tether script, which loads it');
Tether.__parts['account'] = part;
