// tests/mcp-server-skill.spec.js
// TASK-026 — Plugin chain P6: the `mcp-server` training skill ships in BOTH
// locations, byte-identical (the established skills-parity mirror pattern).
//
// The researcher authored the mcp-server skill for this ticket and placed it in
// BOTH skills/mcp-server/ (plugin root) and .claude/skills/mcp-server/ (live
// dev), with byte-identical SKILL.md (mirroring tech-training-template and the
// TASK-025 orchestrator-routing backstop). This spec is the drift-guard,
// mirroring tests/orchestrator-routing-skill.spec.js's parity assertion.
//
// UNLIKE the other TASK-026 specs, this one PASSES NOW: both skill copies already
// exist on disk (the researcher committed them). It is a REGRESSION LOCK — it
// fails only if a future change lets the two copies drift, or deletes one.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL_REL = join('mcp-server', 'SKILL.md');
const PLUGIN_SKILL = join(REPO_ROOT, 'skills', SKILL_REL);
const DEV_SKILL = join(REPO_ROOT, '.claude', 'skills', SKILL_REL);

/** Parse the frontmatter block (text between the first two `---` fences). */
function frontmatterOf(mdText) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return m ? m[1] : '';
}

describe('TASK-026 — mcp-server skill ships at the plugin root', () => {
  it('plugin_skill_file_exists', () => {
    expect(
      existsSync(PLUGIN_SKILL),
      'skills/mcp-server/SKILL.md must exist (the plugin-root copy)',
    ).toBe(true);
  });

  it('skill_opens_with_frontmatter_carrying_name_and_description', () => {
    expect(existsSync(PLUGIN_SKILL)).toBe(true);
    const fm = frontmatterOf(readFileSync(PLUGIN_SKILL, 'utf8'));
    expect(fm.length, 'skill must open with a --- frontmatter block').toBeGreaterThan(0);
    expect(/^name:\s*mcp-server\b/m.test(fm), 'frontmatter name: must be mcp-server').toBe(true);
    expect(
      /^description:\s*\S+/m.test(fm),
      'frontmatter must carry a non-empty description:',
    ).toBe(true);
  });
});

describe('TASK-026 — mcp-server skill is mirrored into .claude/skills (parity)', () => {
  it('dev_copy_exists', () => {
    expect(
      existsSync(DEV_SKILL),
      '.claude/skills/mcp-server/SKILL.md must mirror the plugin copy',
    ).toBe(true);
  });

  it('plugin_and_dev_skill_md_are_byte_identical', () => {
    expect(existsSync(PLUGIN_SKILL), 'plugin skill must exist').toBe(true);
    expect(existsSync(DEV_SKILL), 'dev skill must exist').toBe(true);
    const pluginBytes = readFileSync(PLUGIN_SKILL);
    const devBytes = readFileSync(DEV_SKILL);
    expect(
      pluginBytes.equals(devBytes),
      'skills/mcp-server/SKILL.md must be byte-identical to the .claude/skills copy',
    ).toBe(true);
  });
});
