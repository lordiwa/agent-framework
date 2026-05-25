// src/migrate.js
// v1 -> v2 state migration (research §B "Safe lift to v2").
//
// Detection rule:
//   - { version: 1, workflow_step: ..., handoff_summary: ... } => v1
//   - { schema_version: 2, active_session_id: ..., updated_at: ... } => v2
//   - missing                                                       => fresh (treat as v2 idle)
//   - anything else                                                 => hard error
//
// Lift refuses to run if state/sessions/ already has any entries (resolved Q #10):
// "treat as 'someone else already lifted, re-read instead'".

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { writePointer } from './pointer.js';
import {
  newSessionId, bundleDirFor, writeBundleSession, writeManifest,
  appendLifecycleLog, sessionsDir, makeManifest,
} from './bundle.js';

/**
 * Detect the state-file version of a parsed pointer payload.
 * @param {object} payload
 * @returns {1|2}
 */
export function detectStateVersion(payload) {
  if (payload == null || typeof payload !== 'object') {
    throw new Error('detectStateVersion: payload must be an object');
  }
  if (payload.version === 1 && typeof payload.workflow_step === 'string') {
    return 1;
  }
  if (payload.schema_version === 2 && 'active_session_id' in payload) {
    return 2;
  }
  const err = new Error(
    'detectStateVersion: unrecognized state shape; refusing to mutate. Keys: ' +
      Object.keys(payload).sort().join(','),
  );
  err.code = 'E_STATE_SHAPE';
  throw err;
}

/**
 * Lift a v1 state payload into a v2 pointer + bundle.
 * Refuses (throws) if state/sessions/ already contains any directories.
 *
 * @param {{ repoRoot: string, v1Payload: object }} args
 * @returns {Promise<{ sessionId: string }>}
 */
export async function liftV1ToV2({ repoRoot, v1Payload }) {
  if (!repoRoot) throw new Error('liftV1ToV2: repoRoot is required');
  if (!v1Payload || v1Payload.version !== 1) {
    throw new Error('liftV1ToV2: v1Payload must have version=1');
  }

  // Guard: refuse if sessions/ is non-empty.
  const sDir = sessionsDir(repoRoot);
  if (existsSync(sDir)) {
    const entries = readdirSync(sDir);
    if (entries.length > 0) {
      const err = new Error(
        `liftV1ToV2: state/sessions/ is not empty (${entries.length} entries); ` +
          'someone else already lifted. Refusing to re-lift.',
      );
      err.code = 'E_ALREADY_LIFTED';
      throw err;
    }
  } else {
    mkdirSync(sDir, { recursive: true });
  }

  // Use the v1 updated_at as the lifted bundle's created_at so chronology is preserved.
  const sourceTime = v1Payload.updated_at || new Date().toISOString();
  const createdAtDate = new Date(sourceTime);
  const sessionId = newSessionId(createdAtDate);

  // Bundle session payload — v1 shape with schema_version=2, plus session_id and lifecycle_state.
  const { version: _v1, ...rest } = v1Payload;
  const bundlePayload = {
    schema_version: 2,
    session_id: sessionId,
    lifecycle_state: 'active',
    open_questions: [],
    blockers: [],
    decisions: [],
    subagent_results: [],
    pending_human_confirmation: null,
    ...rest,
  };

  // Ensure bundle dir exists, then write files.
  mkdirSync(bundleDirFor(repoRoot, sessionId), { recursive: true });
  await writeBundleSession(repoRoot, sessionId, bundlePayload);
  await writeManifest(repoRoot, sessionId, {
    ...makeManifest({
      sessionId,
      createdAt: sourceTime,
      snapshotTranscript: false,
      transcriptRefs: [],
    }),
    lifted_from_v1: true,
  });
  appendLifecycleLog(repoRoot, sessionId, {
    at: new Date().toISOString(),
    op: 'migrate_v1',
    from_step: v1Payload.workflow_step,
    to_step: v1Payload.workflow_step,
    idempotent_noop: false,
  });

  // Last write: pointer file. If this fails, the bundle survives for retry.
  await writePointer(repoRoot, { activeSessionId: sessionId });

  return { sessionId };
}
