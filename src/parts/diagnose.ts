// The <script> build's tether.diagnose.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../diagnose.ts';
import { registerPart } from '../part-registry.ts';

registerPart('diagnose', part);
