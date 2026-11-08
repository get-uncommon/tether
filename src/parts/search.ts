// The <script> build's tether.search.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../search.ts';
import { registerPart } from '../part-registry.ts';

registerPart('search', part);
