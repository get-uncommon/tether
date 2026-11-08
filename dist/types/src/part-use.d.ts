import type { PartName, Parts } from './lazy.js';
/** Runs `use` once the part `name` has loaded; a failure to load it, or of `use`, is reported under `name`. */
export declare function withPart<Name extends PartName>(name: Name, use: (part: Parts[Name]) => unknown): void;
