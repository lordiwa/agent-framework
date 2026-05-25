// tests/docs.spec.js
// AC11 — CLAUDE.md and state/README.md updated to teach the v2 pointer/bundle layout.
//
// Maps research §H:
//   #23 claude_md_explains_pointer_file
//   #24 state_readme_explains_bundle_layout
//
// Note: as called out in the test-runtime proposal §8 Concerns #1, these are
// string-presence assertions. They prove the prose was updated; they cannot
// prove it is *correct*. Reviewer subagent spot-checks the prose.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

describe('AC11 — docs explain pointer + bundle layout', () => {
  it('claude_md_explains_pointer_file', () => {
    const text = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    // The CLAUDE.md RESUME-FIRST contract must reflect the v2 indirection:
    // pointer file -> bundle session.json. We assert on stable phrases.
    expect(text).toMatch(/pointer/i);
    expect(text).toMatch(/active_session_id/);
    expect(text).toMatch(/state\/sessions\//);
  });

  it('state_readme_explains_bundle_layout', () => {
    const text = readFileSync(join(REPO_ROOT, 'state', 'README.md'), 'utf8');
    expect(text).toMatch(/state\/sessions\/<.*?>\//);
    expect(text).toMatch(/manifest\.json/);
    expect(text).toMatch(/lifecycle\.log/);
    expect(text).toMatch(/summary\.md/);
    expect(text).toMatch(/pointer/i);
  });
});
