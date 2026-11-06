// The published .d.ts checked against the source's own JSDoc types (npm run test:types). Not shipped.
// A line here stops compiling when the hand-written public types and the code drift apart: what the code hands out
// must fit the public type (`Fits<Code, Public>`), and what a site passes by the public type must fit what the code
// takes (`Fits<Public, Code>`). `Same` checks both ways.
import type * as Public from '@occluze/tether';
import type * as PublicServer from '@occluze/tether/server';
import type { api } from '../src/index.js';
import type { Cart as implCart } from '../src/cart.js';
import type { ProductScope as ImplProductScope } from '../src/product.js';
import type { TetherConfig as ImplConfig, TetherOptions as ImplOptions } from '../src/config.js';
import type { TetherErrorCode as ImplErrorCode, TetherError as ImplTetherError } from '../src/client.js';
import type { AccountCustomer as ImplCustomer, AccountOrder as ImplOrder } from '../src/account/answers.js';
import type * as implPlans from '../src/selling-plans.js';
import type { createStorefront as implCreateStorefront, ServerOptions as ImplServerOptions } from '../src/server.js';

/** Compiles only when `From` can be used where `To` is expected. */
type Fits<From extends To, To> = [From, To];
/** Compiles only when `A` and `B` fit each other. */
type Same<A extends B, B extends C, C = A> = [A, B, C];
/** What each function of `T` returns. */
type Returns<T> = { [Key in keyof T]: T[Key] extends (...args: never[]) => infer Result ? Result : T[Key] };

type ImplApi = typeof api;
type ImplStorefront = ReturnType<typeof implCreateStorefront>;
/**
 * Left out of the whole-object check, each checked on its own below:
 * - the selling plan helpers take any `ShopifyProduct`, a looser type than the fields they read, so what they return
 *   is compared;
 * - `init` and `ready` answer the whole `Tether`, which holds both.
 */
type Separate = 'plans' | 'init' | 'ready';

export type Checks = [
  // window.Tether
  Fits<Omit<ImplApi, Separate>, Omit<Public.Tether, Separate>>,
  Fits<Pick<Returns<typeof implPlans>, keyof Public.SellingPlanHelpers>, Returns<Public.SellingPlanHelpers>>,
  Fits<Public.TetherConfig, NonNullable<Parameters<ImplApi['init']>[0]>>,
  // The cart and a product scope
  Fits<typeof implCart, Public.Cart>,
  Fits<ImplProductScope, Public.ProductScope>,
  // Config: a site's options by the public type are options the code takes; the resolved config is the public one.
  Fits<Public.TetherConfig, ImplOptions>,
  Fits<ImplConfig, Public.ResolvedTetherConfig>,
  Fits<ImplApi['config'], Public.Tether['config']>,
  // Errors
  Same<ImplErrorCode, Public.TetherErrorCode>,
  Fits<ImplTetherError, Public.TetherError>,
  // The account part's answers.
  Same<ImplCustomer, Public.AccountCustomer>,
  Same<ImplOrder, Public.AccountOrder>,
  // @occluze/tether/server. `initialState` has a non-null overload for a product with variants, which every Shopify
  // product has, so it is compared by what it returns.
  Fits<Omit<ImplStorefront, 'initialState' | 'plans'>, Omit<PublicServer.Storefront, 'initialState' | 'plans'>>,
  Fits<ReturnType<ImplStorefront['initialState']>, PublicServer.InitialState | null>,
  Fits<PublicServer.StorefrontOptions, ImplOptions & ImplServerOptions>,
];
