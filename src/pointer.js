// src/pointer.js
// Read/write the v2 pointer file at state/session.json.
// Pointer file shape (research §B):
//   { schema_version: 2, active_session_id: string|null, updated_at: RFC3339 }

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { atomicWriteFile } from './atomic-write.js';

export function pointerFilePath(repoRoot) {
  return join(repoRoot, 'state', 'session.json');
}

/**
 * Read the v2 pointer file. Returns the parsed object, or null if the file
 * is missing (fresh repo). Caller is responsible for detection-vs-lift
 * (see src/migrate.js).
 */
export function readPointer(repoRoot) {
  const p = pointerFilePath(repoRoot);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Atomically write a v2 pointer. Pass active_session_id=null to clear it.
 *
 * @param {string} repoRoot
 * @param {{ activeSessionId: string|null, updatedAt?: string }} opts
 */
export async function writePointer(repoRoot, { activeSessionId, updatedAt }) {
  const payload = {
    schema_version: 2,
    active_session_id: activeSessionId,
    updated_at: updatedAt || new Date().toISOString(),
  };
  const target = pointerFilePath(repoRoot);
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
  await atomicWriteFile(target, JSON.stringify(payload, null, 2) + '\n');
  return payload;
}
