// The <script> build's tether.extras.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../extras.ts';
import type { TetherInternals } from '../lazy.ts';

const { Tether } = window as { Tether?: TetherInternals };
if (!Tether) throw new Error('tether.extras.js runs after the Tether script, which loads it');
Tether.__parts.extras = part;
