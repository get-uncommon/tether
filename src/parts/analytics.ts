// The <script> build's tether.analytics.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../analytics.ts';
import { registerPart } from '../part-registry.ts';

registerPart('analytics', part);
