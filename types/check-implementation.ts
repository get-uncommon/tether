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
import type { AccountCustomer as ImplCustomer } from '../src/account/answers.js';
import type { AccountOrder as ImplOrder } from '../server/src/shared/account-orders.js';
import type * as implPlans from '../src/selling-plans.js';
import type { createStorefront as implCreateStorefront, ServerOptions as ImplServerOptions } from '../src/server.js';

/** Compiles only when `From` can be used where `To` is expected. */
type Fits<From extends To, To> = [From, To];
/** Compiles only when `A` and `B` fit each other. */
type Same<A extends B, B extends C, C = A> = [A, B, C];

type ImplApi = typeof api;
type ImplStorefront = ReturnType<typeof implCreateStorefront>;
/** `init` and `ready` answer the whole `Tether`, which holds both: left out of the whole-object check. */
type Separate = 'init' | 'ready';

export type Checks = [
  // window.Tether
  Fits<Omit<ImplApi, Separate>, Omit<Public.Tether, Separate>>,
  Same<Pick<typeof implPlans, keyof Public.SellingPlanHelpers>, Public.SellingPlanHelpers>,
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
  // @occluze/tether/server
  Fits<ImplStorefront, PublicServer.Storefront>,
  Fits<PublicServer.StorefrontOptions, ImplOptions & ImplServerOptions>,
];
