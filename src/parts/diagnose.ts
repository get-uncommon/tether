// The <script> build's tether.diagnose.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../diagnose.ts';

const { Tether } = window as { Tether?: { __parts: Record<string, unknown> } };
if (!Tether) throw new Error('tether.diagnose.js runs after the Tether script, which loads it');
Tether.__parts['diagnose'] = part;
