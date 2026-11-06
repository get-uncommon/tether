// The <script> build's tether.account.js: registers the part where the core script's loader (lazy-iife.ts) finds it.
import * as part from '../account.ts';
import { registerPart } from '../part-registry.ts';

registerPart('account', part);
