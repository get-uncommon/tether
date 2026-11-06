// The <script> build's tether.markets.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../markets-ui.ts';
import { registerPart } from '../part-registry.ts';

registerPart('markets', part);
