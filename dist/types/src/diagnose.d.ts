import { apiVersionStatus } from './api-version.js';
import { checkMarkup, didYouMean } from './diagnose-markup.js';
import type { ApiVersionStatus } from './api-version.js';
import type { DetectedMarket } from './markets.js';
import type { Problem } from './diagnose-markup.js';
export { apiVersionStatus, checkMarkup, didYouMean };
/** The market in use (a visitor's choice included), and what detection would pick. */
interface MarketReport {
    country: string | null;
    language: string | null;
    locale: string | null;
    /** `null` without `markets.detect`. */
    detected: DetectedMarket | null;
}
interface ShopReport {
    name: string;
    url: string;
    currency: string;
}
type ProductReport = {
    key: string;
    handle: string;
    title: string;
    plans: number;
    requiresSellingPlan: boolean;
} | {
    key: string;
    error: string | undefined;
};
interface SellingPlanReport {
    product: string;
    group: string;
    plan: string;
    id: string;
}
export interface DiagnoseReport {
    /** Tether's version, `''` when the caller didn't say. */
    version: string;
    /** The config, with the token masked. */
    config: Record<string, unknown>;
    apiVersion: ApiVersionStatus;
    market: MarketReport;
    reachable: boolean;
    shop: ShopReport | null;
    latencyMs: number | null;
    products: ProductReport[];
    sellingPlans: SellingPlanReport[];
    problems: Problem[];
}
export interface DiagnoseOptions {
    root?: ParentNode;
    /** Return the report without logging it. */
    silent?: boolean;
    /** Tether's version, for the report. */
    version?: string;
    /** The date the API version's support is measured against. */
    now?: Date;
}
/** What's wrong on the page: config, token, API version, products, plans, markup. */
export declare function diagnose({ root, silent, version, now, }?: DiagnoseOptions): Promise<DiagnoseReport>;
