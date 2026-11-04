// Cloudflare Worker entry. Copy to worker.js next to your tether-sync.config.js.
import config from './tether-sync.config.js';
import { createWorker } from './src/worker.js';

export default createWorker(config);
