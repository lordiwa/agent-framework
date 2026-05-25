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

/**
 * Atomically write a batch of {target, bytes} pairs using the same
 * tmp+rename recipe, but in two phases so that every fsync happens BEFORE
 * any rename. This gives an observer the guarantee that either all tmp files
 * are durable on disk before any of them is promoted, or none of the
 * promotions has begun. Used by callers (e.g. task-store) that mutate two
 * files in lock-step (the canonical file and its regenerable index).
 *
 * Phase 1 (prepare): for each entry, open tmp O_CREAT|O_EXCL, write, fsync, close.
 * Phase 2 (commit): for each entry, rename(tmp, target) with the same EBUSY retry.
 *
 * On any error in phase 1, already-prepared tmps are left on disk for
 * recovery.sweepAndRecover() to clean up. On any error in phase 2, prior
 * renames stay (they are independently durable); the failure is rethrown.
 *
 * @param {Array<{target: string, bytes: string|Uint8Array}>} entries
 */
export async function atomicWriteFiles(entries) {
  // Phase 1: prepare all tmp files.
  const prepared = [];
  for (const { target, bytes } of entries) {
    const dir = dirname(target);
    const base = basename(target);
    const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
    const tmp = join(dir, `${base}.tmp.${suffix}`);
    const payload = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;

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
    prepared.push({ tmp, target });
  }

  // Phase 2: commit all renames.
  const results = [];
  for (const { tmp, target } of prepared) {
    let lastErr;
    let committed = false;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        renameSync(tmp, target);
        committed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
          if (attempt < RETRY_ATTEMPTS - 1) {
            await sleep(RETRY_BACKOFF_MS);
            continue;
          }
        }
        throw err;
      }
    }
    if (!committed) throw lastErr;
    results.push({ tmp, target });
  }
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
