// The <script> build's tether.lists.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../lists.ts';
import { registerPart } from '../part-registry.ts';

registerPart('lists', part);
