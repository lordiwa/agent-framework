// src/schemas.js
// JSON Schemas as JS objects, for direct import + ajv compilation.
// Also re-exported from this single module so tests can `import { ... } from 'schemas.js'`
// without juggling JSON imports / assertion syntax.
//
// Note on the two independent schema_version dimensions:
//   * The bundle-STATE version is `2`. It lives in BOTH `state/session.json`
//     (the pointer file) and inside each bundle's `session.json`. This
//     tracks the shape of the orchestrator-state payload.
//   * The bundle-LAYOUT version is `1`. It lives in `manifest.json` and
//     tracks the directory structure of a bundle (what files are present:
//     session.json, manifest.json, lifecycle.log, summary.md, etc.).
// They are independent on purpose: the state payload can evolve without
// renaming the bundle's files, and the bundle layout can grow new optional
// files without invalidating older state payloads. Do not try to unify
// them — different change axes deserve different version numbers.

export const pointerSchema = {
  $id: 'https://agentic-framework.local/state/session.schema.json',
  title: 'SessionPointer',
  description:
    'Pointer file. Names the currently-active session bundle under state/sessions/. Read first on every new chat.',
  type: 'object',
  required: ['schema_version', 'active_session_id', 'updated_at'],
  additionalProperties: false,
  properties: {
    schema_version: { const: 2 },
    active_session_id: {
      type: ['string', 'null'],
      pattern: '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$',
      description:
        'ID of the bundle under state/sessions/. Null = no active session (idle between sessions).',
    },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

// Bundle-state schema (state/sessions/<id>/session.json). Per resolved Q #8 the
// version field is named schema_version (matching the pointer), not version.
// Field set: every v1 field, plus session_id, plus lifecycle_state.
export const bundleStateSchema = {
  $id: 'https://agentic-framework.local/state/sessions/bundle.schema.json',
  title: 'BundleSession',
  description: 'Per-session orchestrator state living inside a portable bundle.',
  type: 'object',
  required: [
    'schema_version',
    'session_id',
    'lifecycle_state',
    'updated_at',
    'active_task',
    'workflow_step',
    'next_action',
    'handoff_summary',
  ],
  additionalProperties: false,
  properties: {
    schema_version: { const: 2 },
    session_id: {
      type: 'string',
      pattern: '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$',
    },
    lifecycle_state: { type: 'string', enum: ['active', 'paused', 'ended'] },
    updated_at: { type: 'string', format: 'date-time' },
    active_task: {
      type: ['string', 'null'],
      pattern: '^TASK-[0-9]{3,}$',
    },
    workflow_step: {
      type: 'string',
      enum: ['idle', 'fetch', 'research', 'test', 'impl', 'review', 'update'],
    },
    next_action: { type: ['string', 'null'], maxLength: 300 },
    handoff_summary: { type: 'string' },
    open_questions: { type: 'array', default: [], items: { type: 'string' } },
    blockers: { type: 'array', default: [], items: { type: 'string' } },
    decisions: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['at', 'decision', 'rationale'],
        additionalProperties: false,
        properties: {
          at: { type: 'string', format: 'date-time' },
          decision: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
    subagent_results: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['agent', 'at', 'summary'],
        additionalProperties: false,
        properties: {
          agent: { type: 'string', enum: ['researcher', 'developer', 'reviewer'] },
          at: { type: 'string', format: 'date-time' },
          summary: { type: 'string', maxLength: 1000 },
          artifacts: { type: 'array', default: [], items: { type: 'string' } },
        },
      },
    },
    pending_human_confirmation: { type: ['string', 'null'], default: null },
  },
};

// Manifest schema (state/sessions/<id>/manifest.json). manifest.schema_version
// is independent of the bundle session.schema_version; the manifest tracks the
// bundle-layout version, currently 1.
export const manifestSchema = {
  $id: 'https://agentic-framework.local/state/sessions/manifest.schema.json',
  title: 'BundleManifest',
  type: 'object',
  required: ['session_id', 'schema_version', 'created_at', 'host', 'snapshot_transcript'],
  additionalProperties: true, // tolerate forward-compat fields
  properties: {
    session_id: { type: 'string', pattern: '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$' },
    schema_version: { const: 1 },
    created_at: { type: 'string', format: 'date-time' },
    host: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    snapshot_transcript: { type: 'boolean' },
    transcript_refs: { type: 'array', items: { type: 'object' } },
    lifted_from_v1: { type: 'boolean' },
  },
};
