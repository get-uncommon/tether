import { defineConfig } from 'astro/config';
import tether from '@occluze/tether/astro';
import shopConfig from './src/shop.config.js';

export default defineConfig({
  // Tether on every page; store and token come from .env.
  integrations: [tether(shopConfig)],
});
