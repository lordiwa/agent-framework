// tests/orchestrator-agent-v2.spec.js
// TASK-025 — Plugin chain P5: reconcile orchestrator.md to the v2 contract (AC4).
//
// Both .claude/agents/orchestrator.md AND the plugin-root agents/orchestrator.md
// (kept byte-identical by tests/agents-parity.spec.js) currently document the
// STALE v1 single-file session model: "single source of truth" applied to
// session.json, the atomic temp `session.json.tmp` rename, the
// "Archive ... to state/sessions/<updated_at>.json ... reset to idle template"
// scheme, and Workflow step 8's "reset to idle template". Shipping this in the
// plugin would propagate the wrong session model into every user project — the
// spike flagged this as the highest-risk correctness item in the package.
//
// This spec greps the orchestrator.md text and asserts:
//   • ZERO occurrences of the v1 markers (these FAIL NOW — the file is v1), AND
//   • the v2 contract IS present (pointer state/session.json with
//     active_session_id, bundle dir state/sessions/<active_session_id>/, the
//     four-step RESUME-FIRST sequence) — these also FAIL NOW (absent in v1).
//
// It runs against the DEV copy (.claude/agents/orchestrator.md). agents-parity
// keeps the plugin-root copy byte-identical, so checking one suffices; a guard
// here asserts agents-parity still covers orchestrator.md so this stays honest.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const DEV_ORCH = join(REPO_ROOT, '.claude', 'agents', 'orchestrator.md');
const PLUGIN_ORCH = join(REPO_ROOT, 'agents', 'orchestrator.md');
const PARITY_SPEC = join(REPO_ROOT, 'tests', 'agents-parity.spec.js');

function readOrch() {
  expect(existsSync(DEV_ORCH), '.claude/agents/orchestrator.md must exist').toBe(true);
  return readFileSync(DEV_ORCH, 'utf8');
}

describe('AC4 — orchestrator.md carries ZERO v1 session-model markers', () => {
  it('no_updated_at_archive_scheme', () => {
    const text = readOrch();
    // The v1 archive path: state/sessions/<updated_at>.json (and the bare
    // <updated_at>.json token). v2 uses opaque bundle ids, never <updated_at>.
    expect(
      /sessions\/<updated_at>/.test(text),
      'v1 archive path sessions/<updated_at> must be gone',
    ).toBe(false);
    expect(
      /<updated_at>\.json/.test(text),
      'v1 <updated_at>.json archive token must be gone',
    ).toBe(false);
  });

  it('no_single_source_of_truth_applied_to_session_json', () => {
    const text = readOrch();
    expect(
      /single source of truth/i.test(text),
      'the "single source of truth" framing of session.json is v1 — must be gone',
    ).toBe(false);
  });

  it('no_idle_template_reset_language', () => {
    const text = readOrch();
    expect(
      /idle template/i.test(text),
      'the "reset to idle template" archive language is v1 — must be gone',
    ).toBe(false);
  });

  it('no_session_json_tmp_atomic_recipe', () => {
    const text = readOrch();
    expect(
      /session\.json\.tmp/.test(text),
      'the inline session.json.tmp atomic-rename recipe is v1 detail — must be gone',
    ).toBe(false);
  });
});

describe('AC4 — orchestrator.md carries the v2 pointer/bundle contract', () => {
  it('mentions_the_pointer_with_active_session_id', () => {
    const text = readOrch();
    expect(text.includes('state/session.json')).toBe(true);
    expect(
      text.includes('active_session_id'),
      'must reference the pointer field active_session_id',
    ).toBe(true);
    expect(/pointer/i.test(text)).toBe(true);
  });

  it('mentions_the_bundle_directory', () => {
    const text = readOrch();
    expect(
      /state\/sessions\/<active_session_id>\//.test(text)
        || /state\/sessions\/<[^>]*session[^>]*>\//.test(text),
      'must reference the bundle dir state/sessions/<active_session_id>/',
    ).toBe(true);
  });

  it('carries_the_four_step_resume_first_sequence', () => {
    const text = readOrch();
    expect(/RESUME[- ]FIRST/i.test(text)).toBe(true);
    // The four-step chain: pointer -> bundle session.json -> task -> restate.
    expect(/state\/sessions\/.*session\.json/s.test(text)).toBe(true);
    expect(/tasks\/<active_task>\.json|active_task/.test(text)).toBe(true);
    expect(/restate/i.test(text)).toBe(true);
    expect(/handoff_summary/.test(text)).toBe(true);
  });
});

describe('AC4 — agents-parity still covers orchestrator.md (so checking one copy is sound)', () => {
  it('both_copies_exist', () => {
    expect(existsSync(DEV_ORCH)).toBe(true);
    expect(existsSync(PLUGIN_ORCH)).toBe(true);
  });

  it('agents_parity_spec_enumerates_orchestrator_md', () => {
    // Guard: if someone drops orchestrator.md from the parity guard's file list,
    // this v2 reconcile could silently ship a stale plugin-root copy. Assert the
    // parity spec still names orchestrator.md in its AGENT_FILES list.
    const parity = readFileSync(PARITY_SPEC, 'utf8');
    expect(parity.includes("'orchestrator.md'")).toBe(true);
  });
});
