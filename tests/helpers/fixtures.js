// tests/helpers/fixtures.js
// Shared fixture builders. These create on-disk skeletons under a caller-provided
// temp directory; they do NOT touch the real repo's state/ or knowledge/ directories.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build a fresh "framework repo" skeleton at `repoDir`.
 * Creates state/ with a v2 pointer file, tasks/, and any provided fixture files.
 * Does NOT create knowledge/ or state/sessions/ — those are the production
 * artifacts under test and must be created by implementation code, not fixtures.
 */
export function makeRepoSkeleton(repoDir, opts = {}) {
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, 'state'), { recursive: true });
  mkdirSync(join(repoDir, 'tasks'), { recursive: true });

  if (opts.pointer) {
    writeFileSync(
      join(repoDir, 'state', 'session.json'),
      JSON.stringify(opts.pointer, null, 2),
      'utf8',
    );
  }
  if (opts.tasks) {
    for (const [key, payload] of Object.entries(opts.tasks)) {
      writeFileSync(
        join(repoDir, 'tasks', `${key}.json`),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
    }
  }
  return repoDir;
}

/**
 * Seed an "active" session bundle at the given path.
 * Writes session.json (bundle-state shape), manifest.json, and lifecycle.log
 * with one start entry. Returns the bundle metadata.
 */
export function seedActiveBundle(bundleDir, overrides = {}) {
  mkdirSync(bundleDir, { recursive: true });

  const sessionId =
    overrides.session_id || bundleDir.split(/[\\/]/).pop();
  const now = overrides.created_at || '2026-05-24T12:00:00Z';

  const sessionJson = {
    schema_version: 2,
    session_id: sessionId,
    lifecycle_state: 'active',
    updated_at: now,
    active_task: 'TASK-004',
    workflow_step: 'test',
    next_action: 'continue working on the failing tests',
    handoff_summary: 'session was just started',
    open_questions: [],
    blockers: [],
    decisions: [],
    subagent_results: [],
    pending_human_confirmation: null,
    ...overrides.session_json_extra,
  };

  const manifestJson = {
    session_id: sessionId,
    schema_version: 1,
    created_at: now,
    host: 'a'.repeat(64), // sha256 hex placeholder
    snapshot_transcript: false,
    transcript_refs: [],
    ...overrides.manifest_extra,
  };

  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify(sessionJson, null, 2),
    'utf8',
  );
  writeFileSync(
    join(bundleDir, 'manifest.json'),
    JSON.stringify(manifestJson, null, 2),
    'utf8',
  );
  writeFileSync(
    join(bundleDir, 'lifecycle.log'),
    JSON.stringify({
      at: now,
      op: 'start',
      from_step: null,
      to_step: 'test',
      idempotent_noop: false,
    }) + '\n',
    'utf8',
  );

  return { sessionId, bundleDir, sessionJson, manifestJson };
}

/**
 * Seed a paused or ended bundle by mutating an already-active one.
 */
export function seedBundleInState(bundleDir, lifecycleState, overrides = {}) {
  const meta = seedActiveBundle(bundleDir, overrides);
  // Rewrite session.json with the given lifecycle_state.
  const path = join(bundleDir, 'session.json');
  const current = JSON.parse(readFileSync(path, 'utf8'));
  current.lifecycle_state = lifecycleState;
  writeFileSync(path, JSON.stringify(current, null, 2), 'utf8');
  if (lifecycleState === 'ended') {
    writeFileSync(
      join(bundleDir, 'summary.md'),
      '# Session ' + meta.sessionId + '\n\n(seeded for tests)\n',
      'utf8',
    );
  }
  return meta;
}

/**
 * Standard ID generator for tests. Deterministic given a counter.
 */
export function makeSessionId(seed = 0) {
  const ts = '20260524T120000Z';
  const hex = (0xdeadbeef + seed).toString(16).padStart(8, '0').slice(-8);
  return `${ts}-${hex}`;
}

/**
 * Path helpers — keep tests insulated from path layout.
 */
export function bundlePath(repoDir, sessionId) {
  return join(repoDir, 'state', 'sessions', sessionId);
}

export function pointerPath(repoDir) {
  return join(repoDir, 'state', 'session.json');
}

/**
 * Assert that a directory tree contains *only* the listed entries (top-level).
 */
export function hasExactly(actualEntries, expected) {
  const a = [...actualEntries].sort();
  const e = [...expected].sort();
  return JSON.stringify(a) === JSON.stringify(e);
}

/**
 * Sentinel file path the production code is supposed to expose. Tests import
 * from non-existent module specifiers so they fail with MODULE_NOT_FOUND in
 * the no-implementation state. Centralize the specifiers here so we can swap
 * the layout once IMPL lands.
 */
export const PROD = Object.freeze({
  lifecycle: '../../src/lifecycle.js',
  pointer: '../../src/pointer.js',
  bundle: '../../src/bundle.js',
  summary: '../../src/summary.js',
  inspection: '../../src/inspection.js',
  knowledge: '../../src/knowledge.js',
  schemas: '../../src/schemas.js',
  recovery: '../../src/recovery.js',
  migrate: '../../src/migrate.js',
  transcript: '../../src/transcript.js',
});
