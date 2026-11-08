// The <script> build's tether.extras.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../extras.ts';
import { registerPart } from '../part-registry.ts';

registerPart('extras', part);
