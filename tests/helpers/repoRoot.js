// tests/helpers/repoRoot.js
// Locate the framework repo root from inside any test file.
// Walks up from import.meta.url until it finds the dir containing package.json.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

export function findRepoRoot() {
  let here = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(here, 'package.json'))) return here;
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  throw new Error('repo root (package.json) not found from ' + here);
}

export const REPO_ROOT = findRepoRoot();
