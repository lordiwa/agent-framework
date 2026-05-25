// src/atomic-write.js
// Windows-first atomic file write recipe (research §C).
//
// Recipe:
//   1. Serialize JSON to bytes.
//   2. openSync(tmp, O_CREAT|O_EXCL|O_WRONLY) — sibling tmp in target's directory.
//   3. writeSync(fd, bytes).
//   4. fsyncSync(fd) — flush to disk; on Windows maps to FlushFileBuffers.
//   5. closeSync(fd).
//   6. renameSync(tmp, target) — with EBUSY retry (5x50ms) per research §C.
//
// On crash between (2) and (6), the orphan tmp file is left on disk.
// recovery.sweepAndRecover() promotes or deletes orphans on next read.

import {
  openSync, writeSync, fsyncSync, closeSync, renameSync,
  constants,
} from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const RETRY_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = 50;

/**
 * Atomically write `bytes` to `target` using the same-directory tmp+rename recipe.
 * Throws if all rename retries are exhausted; the tmp file is preserved on disk
 * for recovery.sweepAndRecover() to handle on the next read.
 *
 * @param {string} target - absolute path to the destination file
 * @param {string|Uint8Array} bytes - payload (string is utf-8 encoded)
 */
export async function atomicWriteFile(target, bytes) {
  const dir = dirname(target);
  const base = basename(target);
  const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const tmp = join(dir, `${base}.tmp.${suffix}`);

  const payload = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;

  // 1-5: write + fsync + close. O_EXCL ensures we never trample a sibling tmp.
  const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    let written = 0;
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // 6: rename with EBUSY retry loop. On final failure we re-throw and leave
  // the tmp file in place for the recovery sweep.
  let lastErr;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      renameSync(tmp, target);
      return { tmp, target };
    } catch (err) {
      lastErr = err;
      // Only retry on EBUSY (Windows antivirus held a handle) or EPERM (similar).
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
        if (attempt < RETRY_ATTEMPTS - 1) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
      }
      // Any other error code: don't retry, just rethrow with tmp left in place.
      throw err;
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
