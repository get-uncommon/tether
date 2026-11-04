// Cloudflare Worker entry (used by wrangler.jsonc and the Deploy to Cloudflare button).
import config from '../tether-sync.config.js';
import { createWorker } from './worker.js';

export default createWorker(config);
