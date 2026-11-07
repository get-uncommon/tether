/** Running code of an optional part from the core, where the core has no answer to wait for. */
import { reportError } from './config.ts';
import { loadPart } from './lazy.ts';
import type { PartName, Parts } from './lazy.ts';

/** Runs `use` once the part `name` has loaded; a failure to load it, or of `use`, is reported under `name`. */
export function withPart<Name extends PartName>(name: Name, use: (part: Parts[Name]) => unknown): void {
  loadPart(name)
    .then(use)
    .catch((error: unknown) => {
      reportError(error, name);
    });
}
