// Cloudflare Worker entry (used by wrangler.jsonc and the Deploy to Cloudflare button).
import config from '../tether-sync.config.js';
import { parseConfigFile } from './config-file.ts';
import { createWorker } from './worker.ts';

export default createWorker(parseConfigFile(config, 'tether-sync.config.js'));
