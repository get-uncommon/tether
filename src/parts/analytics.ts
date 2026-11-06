// The <script> build's tether.analytics.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../analytics.ts';
import type { TetherInternals } from '../lazy.ts';

const { Tether } = window as { Tether?: TetherInternals };
if (!Tether) throw new Error('tether.analytics.js runs after the Tether script, which loads it');
Tether.__parts.analytics = part;
