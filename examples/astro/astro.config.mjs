import { defineConfig } from 'astro/config';
import tether from '@occluze/tether/astro';
import shopConfig from './src/shop.config.js';

export default defineConfig({
  // Your shop's address: absolute URLs in the structured data and canonical links.
  site: process.env.SITE_URL || 'https://your-shop.example',
  // Tether on every page; store and token come from .env.
  integrations: [tether(shopConfig)],
});
