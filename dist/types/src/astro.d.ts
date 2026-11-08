import type { TetherOptions } from './config.js';
import type { StorefrontOptions } from './server.js';
interface AstroLogger {
    warn: (message: string) => void;
}
/** The argument of Astro's `astro:config:setup` hook. */
interface AstroConfigSetup {
    injectScript: (stage: 'head-inline' | 'page', content: string) => void;
    /** `dev`, `build`, `preview` or `sync`. */
    command: string;
    config: {
        root?: URL;
    };
    logger: AstroLogger;
    addWatchFile?: (path: string) => void;
    /** Takes a partial Astro config. A method, so that Astro's own `DeepPartial<AstroConfig>` parameter fits. */
    updateConfig?(config: {
        env?: {
            schema?: Record<string, unknown>;
        };
    }): unknown;
}
/** The config options a page can be handed as JSON: all but the functions. */
type SerializableOptions = {
    [Key in keyof TetherOptions as Exclude<TetherOptions[Key], null | undefined> extends (...args: never[]) => unknown ? never : Key]?: TetherOptions[Key];
};
/** `createStorefront()`'s own options that a config shared with it may hold, which the page leaves out. */
type ServerOnlyOptions = Pick<StorefrontOptions, 'siteUrl' | 'pageSize'>;
/** Tether's serializable config and the storefront's own options, plus the integration's own options. */
interface TetherAstroOptions extends SerializableOptions, ServerOnlyOptions {
    /** Add the Tether script to every page (default true). */
    inject?: boolean;
    /** Files that restart the dev server when they change. */
    watch?: string[] | null;
}
export type { TetherAstroOptions, AstroConfigSetup };
export default function tether(options?: TetherAstroOptions): {
    name: string;
    hooks: {
        'astro:config:setup': (setup: AstroConfigSetup) => Promise<void>;
    };
};
