/** The lines of a setup check report, collected in the order the checks run. */

/** @typedef {import('../mapping.js').FieldData} FieldData */

/** @typedef {'ok' | 'warn' | 'error' | 'info'} CheckLevel */

/**
 * @typedef {object} CheckStep
 * @property {CheckLevel} level `error` makes the report not ok.
 * @property {string} title
 * @property {string} message Can name the store, the collection or the site: only shown with the bearer secret.
 * @property {string} [fix]
 * @property {FieldData} [sample] What the first product would be written as.
 */

/**
 * @typedef {object} Steps
 * @property {CheckStep[]} list
 * @property {(level: CheckLevel, title: string, message: string, fix?: string) => void} add
 * @property {(title: string, message: string, sample: FieldData) => void} addSample
 * @property {() => boolean} ok No step is an error.
 */

/** @returns {Steps} */
export function createSteps() {
  /** @type {CheckStep[]} */
  const list = [];
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
