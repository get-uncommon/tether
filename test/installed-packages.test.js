// The release's check that node_modules holds what package-lock.json locks, against npm's hidden lockfile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMismatches } from '../scripts/installed-packages.ts';

const LOCKED = {
  lockfileVersion: 3,
  packages: {
    '': { name: '@occluze/tether', version: '0.9.0' },
    'node_modules/eslint': { version: '10.14.0', dev: true },
    'node_modules/eslint/node_modules/ajv': { version: '6.12.6', dev: true },
    'node_modules/@esbuild/darwin-arm64': { version: '0.25.12', dev: true, optional: true },
  },
};

/** @param {Record<string, unknown>} packages */
const hidden = (packages) => ({ name: '@occluze/tether', lockfileVersion: 3, packages });

test('a tree npm installed from the lockfile matches, an optional package for another platform left out', () => {
  const installed = hidden({
    'node_modules/eslint': { version: '10.14.0', dev: true },
    'node_modules/eslint/node_modules/ajv': { version: '6.12.6', dev: true },
  });
  assert.deepEqual(installMismatches(LOCKED, installed), []);
});

test('a locked package missing from node_modules is named', () => {
  const installed = hidden({ 'node_modules/eslint': { version: '10.14.0', dev: true } });
  assert.deepEqual(installMismatches(LOCKED, installed), ['eslint/node_modules/ajv is not installed']);
});

test('a package installed at another version than the lockfile has is named with both versions', () => {
  const installed = hidden({
    'node_modules/eslint': { version: '10.13.0', dev: true },
    'node_modules/eslint/node_modules/ajv': { version: '6.12.6', dev: true },
  });
  assert.deepEqual(installMismatches(LOCKED, installed), ['eslint is 10.13.0, locked at 10.14.0']);
});

test('without a hidden lockfile, nothing counts as installed', () => {
  assert.deepEqual(installMismatches(LOCKED, null), [
    'eslint is not installed',
    'eslint/node_modules/ajv is not installed',
  ]);
});
