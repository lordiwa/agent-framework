// tests/helpers/tmpRepo.js
// Spin up / tear down a tmp working dir simulating a clone of the framework.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = new Set();

export function makeTmpDir(label = 'af') {
  const p = mkdtempSync(join(tmpdir(), `${label}-`));
  created.add(p);
  return p;
}

export function cleanupAll() {
  for (const p of created) {
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // Windows can leave a transient EBUSY here from AV scans; ignore.
    }
  }
  created.clear();
}
