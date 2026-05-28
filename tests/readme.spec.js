// tests/readme.spec.js
// TASK-015 AC1 — A top-level README.md walks a non-technical operator
// through the wizard. Lightweight content checks only — wording is the
// developer's call, but the README MUST exist, be under 200 lines, name
// `bin/init.js` and `Claude Code` as the two anchors a first-time reader
// keys off of, AND avoid internal jargon (`subagent`, `atomic write`,
// `bundle`, `PROD map`).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const README_PATH = join(REPO_ROOT, 'README.md');

describe('AC1 — README.md non-technical quickstart at the repo root', () => {
  it('readme_exists_at_repo_root', () => {
    expect(
      existsSync(README_PATH),
      'README.md must exist at the repo root',
    ).toBe(true);
  });

  it('readme_has_a_top_level_heading', () => {
    const text = readFileSync(README_PATH, 'utf8');
    // First non-empty line should be an H1, OR a markdown file with at least
    // one `# ` heading line. We match the latter so the README is free to
    // open with a short tagline above the heading if the author prefers.
    expect(
      /^# .+/m.test(text),
      'README.md must contain at least one `# ` top-level heading',
    ).toBe(true);
  });

  it('readme_is_under_200_lines', () => {
    const text = readFileSync(README_PATH, 'utf8');
    const lines = text.split(/\r?\n/);
    expect(
      lines.length,
      `README.md must stay under 200 lines (got ${lines.length})`,
    ).toBeLessThan(200);
  });

  it('readme_mentions_the_init_command', () => {
    const text = readFileSync(README_PATH, 'utf8');
    expect(
      text.includes('bin/init.js'),
      'README.md must mention `bin/init.js` so the first-time operator knows what to run',
    ).toBe(true);
  });

  it('readme_mentions_claude_code', () => {
    const text = readFileSync(README_PATH, 'utf8');
    // Case-insensitive — the README author may write "Claude Code" or
    // "claude code". Both are fine; the anchor word is the brand name.
    expect(
      /claude code/i.test(text),
      'README.md must mention Claude Code so the operator knows how to start the first chat',
    ).toBe(true);
  });

  it('readme_omits_internal_jargon', () => {
    const text = readFileSync(README_PATH, 'utf8');
    // Banned terms are case-insensitive — any casing of these internal terms
    // is jargon as far as a first-time operator is concerned.
    const banned = ['subagent', 'atomic write', 'bundle', 'PROD map'];
    for (const term of banned) {
      const hit = new RegExp(term.replace(/\s+/g, '\\s+'), 'i').test(text);
      expect(
        hit,
        `README.md must not mention the internal term "${term}" — keep the quickstart jargon-free`,
      ).toBe(false);
    }
  });
});
