// Tether's layers: src/ runs in the browser (and, for server.js and astro.js, in Node at build time); server/src/ is
// the user's own Worker, run from source. Neither imports the other's code; what both need lives in src/shared/.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle means two modules are one module, or a seam is missing. Lazy parts load through import().',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['dynamic-import'] } },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'A file nothing imports is dead, or an entry point this config does not know about.',
      from: {
        orphan: true,
        pathNot: [
          '^src/(index|server|astro|lazy-iife)\.js$',
          '^src/(parts|presets)/',
          '^server/src/(entry|index)\.js$',
          '^server/(bin|scripts)/',
          '^scripts/',
        ],
      },
      to: {},
    },
    {
      name: 'no-dev-deps-in-shipped-code',
      severity: 'error',
      comment: 'What ships must not need a devDependency at run time.',
      from: { path: '^(src|server/src)/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|node_modules|examples)/' },
    moduleSystems: ['es6'],
  },
};
