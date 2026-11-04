import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { entryPoints: ['src/index.js'], bundle: true, target: 'es2019', logLevel: 'info' };
const builds = [
  { ...common, format: 'iife', outfile: 'dist/tether.js' },
  { ...common, format: 'iife', outfile: 'dist/tether.min.js', minify: true, sourcemap: true },
  { ...common, format: 'esm', outfile: 'dist/tether.esm.js' },
  { entryPoints: ['src/presets/barba.js'], bundle: true, target: 'es2019', logLevel: 'info', format: 'esm', outfile: 'dist/presets/barba.esm.js' },
];

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
