import { createStorefront } from '@occluze/tether/server';
import shopConfig from '../shop.config.js';

// Build-time Shopify data. Store and token from .env; market and URLs shared with the browser.
export const shop = createStorefront({ ...import.meta.env, ...shopConfig });
