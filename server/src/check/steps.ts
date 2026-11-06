/** The lines of a setup check report, collected in the order the checks run. */

import type { FieldData } from '../mapping.ts';

export type CheckLevel = 'ok' | 'warn' | 'error' | 'info';

export interface CheckStep {
  /** `error` makes the report not ok. */
  level: CheckLevel;
  title: string;
  /** Can name the store, the collection or the site: only shown with the bearer secret. */
  message: string;
  fix?: string;
  /** What the first product would be written as. */
  sample?: FieldData;
}

export interface Steps {
  list: CheckStep[];
  add: (level: CheckLevel, title: string, message: string, fix?: string) => void;
  addSample: (title: string, message: string, sample: FieldData) => void;
  /** No step is an error. */
  ok: () => boolean;
}

export function createSteps(): Steps {
  const list: CheckStep[] = [];
  return {
    list,
    add(level, title, message, fix) {
      list.push({ level, title, message, ...(fix ? { fix } : {}) });
    },
    addSample(title, message, sample) {
      list.push({ level: 'info', title, message, sample });
    },
    ok: () => !list.some((step) => step.level === 'error'),
  };
}
