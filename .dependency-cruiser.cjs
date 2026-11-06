// Tether's layers: src/ runs in the browser (and, for server.ts and astro.ts, in Node at build time); server/src/ is
// the user's own Worker, run from source. A deployed Worker copy holds only server/, so what both need lives in
// server/src/shared/, which imports nothing outside itself.
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
          // Declaration files type imports; nothing imports them by path.
          '[.]d[.]ts$',
          '^src/(index|server|astro|lazy-iife)[.]ts$',
          '^src/(parts|presets)/',
          '^server/src/(entry[.](js|ts)|index[.]ts)$',
          '^server/(bin|scripts)/',
          '^scripts/',
        ],
      },
      to: {},
    },
    {
      name: 'browser-only-uses-shared-server-code',
      severity: 'error',
      comment: 'The browser script may use the shared modules in server/src/shared/, not the Worker itself.',
      from: { path: '^src/' },
      to: { path: '^server/', pathNot: '^server/src/shared/' },
    },
    {
      name: 'worker-not-browser',
      severity: 'error',
      comment: 'A deployed Worker copy has no src/ folder next to it.',
      from: { path: '^server/' },
      to: { path: '^src/' },
    },
    {
      name: 'shared-stands-alone',
      severity: 'error',
      comment: 'server/src/shared/ runs in the browser and the Worker, so it imports only itself.',
      from: { path: '^server/src/shared/' },
      to: { pathNot: '^server/src/shared/' },
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
