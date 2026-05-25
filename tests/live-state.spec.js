// tests/live-state.spec.js
// Drift guard: the live state/session.json pointer and its referenced bundle's
// session.json must validate against the committed schemas every time the
// suite runs. This catches the class of M2 finding the Reviewer flagged on
// TASK-004 — fixture-based tests don't notice when the orchestrator writes
// payloads the schema rejects.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from './helpers/repoRoot.js';

describe('drift guard — live state validates against committed schemas', () => {
  it('live_pointer_and_bundle_validate', () => {
    const pointerPath = join(REPO_ROOT, 'state', 'session.json');
    const pointerSchemaPath = join(REPO_ROOT, 'state', 'session.schema.json');
    const bundleSchemaPath = join(REPO_ROOT, 'state', 'bundle.schema.json');

    expect(existsSync(pointerPath), 'state/session.json must exist').toBe(true);
    expect(existsSync(pointerSchemaPath), 'state/session.schema.json must exist').toBe(true);
    expect(existsSync(bundleSchemaPath), 'state/bundle.schema.json must exist').toBe(true);

    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
    const pointerSchema = JSON.parse(readFileSync(pointerSchemaPath, 'utf8'));
    const bundleSchema = JSON.parse(readFileSync(bundleSchemaPath, 'utf8'));

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    // Pointer.
    const validatePointer = ajv.compile(pointerSchema);
    const pointerOk = validatePointer(pointer);
    expect(
      pointerOk,
      'state/session.json failed pointer schema: ' + JSON.stringify(validatePointer.errors, null, 2),
    ).toBe(true);

    // If active_session_id is null, the orchestrator is idle — no bundle to validate.
    if (pointer.active_session_id === null) return;

    const bundleSessionPath = join(
      REPO_ROOT,
      'state',
      'sessions',
      pointer.active_session_id,
      'session.json',
    );
    expect(
      existsSync(bundleSessionPath),
      `pointer names active_session_id=${pointer.active_session_id} but bundle session.json missing at ${bundleSessionPath}`,
    ).toBe(true);

    const bundle = JSON.parse(readFileSync(bundleSessionPath, 'utf8'));
    const validateBundle = ajv.compile(bundleSchema);
    const bundleOk = validateBundle(bundle);
    expect(
      bundleOk,
      `live bundle session.json (${pointer.active_session_id}) failed bundle schema: ` +
        JSON.stringify(validateBundle.errors, null, 2),
    ).toBe(true);
  });
});
