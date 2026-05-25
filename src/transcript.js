// src/transcript.js
// Claude Code transcript snapshot logic.
//
// Per resolved Q #2: when a session was started with snapshotTranscript=true,
// we capture the transcript on EVERY pause and on end. Not opt-in per-call.
//
// Per resolved Q #3: the actual transcript directory on Windows is not yet
// known. We read it from env var CLAUDE_CODE_TRANSCRIPT_DIR (see test-runtime
// proposal §8 Concerns #3). When unset, snapshot is a no-op (the bundle still
// works; it just won't carry verbatim history across machines).

import {
  existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { atomicWriteFile } from './atomic-write.js';
import {
  bundleTranscriptRefPath, bundleTranscriptSnapshotDir,
} from './bundle.js';

/**
 * Resolve the configured Claude Code transcript directory, if any.
 * Returns null when CLAUDE_CODE_TRANSCRIPT_DIR is unset.
 */
export function resolveTranscriptDir() {
  const p = process.env.CLAUDE_CODE_TRANSCRIPT_DIR;
  return p && p.length > 0 ? p : null;
}

/**
 * Compute checksums for transcript files in the source dir and write them
 * to transcript.ref.json inside the bundle. Does NOT modify the source files.
 *
 * @returns {Promise<Array<{path: string, sha256: string, exists_at_capture: boolean}>>}
 */
export async function captureTranscriptRefs({ repoRoot, sessionId }) {
  const src = resolveTranscriptDir();
  if (!src || !existsSync(src)) {
    return [];
  }
  const refs = [];
  for (const name of readdirSync(src)) {
    const full = join(src, name);
    let exists = false;
    let sha = null;
    try {
      const stat = statSync(full);
      if (stat.isFile()) {
        exists = true;
        const content = readFileSync(full);
        sha = createHash('sha256').update(content).digest('hex');
      }
    } catch {
      exists = false;
    }
    refs.push({ path: full, exists_at_capture: exists, sha256: sha });
  }
  const refDoc = { claude_code_transcripts: refs };
  await atomicWriteFile(
    bundleTranscriptRefPath(repoRoot, sessionId),
    JSON.stringify(refDoc, null, 2) + '\n',
  );
  return refs;
}

/**
 * Copy every file from the configured transcript dir into the bundle's
 * transcript.snapshot/ directory. Overwrites any previous snapshot copy
 * (snapshot is taken on every pause+end per resolved Q #2).
 *
 * Does NOT touch the source files.
 */
export async function snapshotTranscripts({ repoRoot, sessionId }) {
  const src = resolveTranscriptDir();
  if (!src || !existsSync(src)) {
    return { copied: 0, skipped: 'no_transcript_dir' };
  }
  const dstDir = bundleTranscriptSnapshotDir(repoRoot, sessionId);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(src)) {
    const full = join(src, name);
    let isFile = false;
    try {
      isFile = statSync(full).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;
    const dst = join(dstDir, name);
    copyFileSync(full, dst);
    copied++;
  }
  return { copied };
}
