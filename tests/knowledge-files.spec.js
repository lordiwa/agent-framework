// tests/knowledge-files.spec.js
// AC8 — knowledge/ directory exists with README.md, schema.md, schema.json, and >=1 seed entry.
// AC8 — entries have no project-specific absolute paths in their bodies.
// AC8 — entry frontmatter validates against knowledge/schema.json.
// AC12 — JSON Schema validation suite covers good + bad entries.
//
// Maps research §H:
//   #17 knowledge_dir_has_required_files
//   #18 knowledge_entries_have_no_absolute_paths
//   #19 knowledge_entry_frontmatter_validates
//   #26 kb_schema_test_suite

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from './helpers/repoRoot.js';

const KB_DIR = join(REPO_ROOT, 'knowledge');
const ENTRIES_DIR = join(KB_DIR, 'entries');
const SCHEMA_PATH = join(KB_DIR, 'schema.json');

// Deny-list patterns. These compile to regex source that matches REAL paths
// on disk — a single backslash in the path is one `\\` in this JS literal,
// which is one `\` in the regex itself. The previous version used `\\\\`,
// which compiles to `\\` (two literal backslashes) — that matches
// source-code strings like "C:\\Users" but NOT a real Windows path on disk,
// so the lint was silently a no-op for real entries. Self-tested below.
const DENY_PATH_FRAGMENTS = [
  /[A-Z]:\\/,        // Windows drive letter, e.g. C:\Users\foo
  /\/Users\//,       // macOS home prefix
  /\/home\//,        // Linux home prefix
  /\\\\\?\\/,        // \\?\ long-path prefix on Windows
];

function listEntryFiles() {
  if (!existsSync(ENTRIES_DIR)) return [];
  return readdirSync(ENTRIES_DIR).filter((n) => n.endsWith('.md'));
}

describe('AC8 — deny-list regex is correct (regression for Reviewer M1)', () => {
  it('deny_list_matches_real_paths', () => {
    const winPath = 'See C:\\Users\\foo for an example.';
    const longPath = 'Prefix \\\\?\\C:\\Users\\foo for long paths.';
    const macPath = 'Look at /Users/foo/bar.';
    const linuxPath = 'Look at /home/foo/bar.';
    const clean = 'Refer to the bundle’s session.json (no absolute path).';

    expect(DENY_PATH_FRAGMENTS.some((p) => p.test(winPath)),
      'win drive-letter path should be caught').toBe(true);
    expect(DENY_PATH_FRAGMENTS.some((p) => p.test(longPath)),
      '\\\\?\\ long-path prefix should be caught').toBe(true);
    expect(DENY_PATH_FRAGMENTS.some((p) => p.test(macPath)),
      '/Users/ prefix should be caught').toBe(true);
    expect(DENY_PATH_FRAGMENTS.some((p) => p.test(linuxPath)),
      '/home/ prefix should be caught').toBe(true);
    expect(DENY_PATH_FRAGMENTS.some((p) => p.test(clean)),
      'clean text must not match').toBe(false);
  });
});

describe('AC8 — knowledge/ structure', () => {
  it('knowledge_dir_has_required_files', () => {
    expect(existsSync(KB_DIR), 'knowledge/ must exist').toBe(true);
    expect(existsSync(join(KB_DIR, 'README.md')), 'knowledge/README.md must exist').toBe(true);
    expect(existsSync(join(KB_DIR, 'schema.md')), 'knowledge/schema.md must exist').toBe(true);
    expect(existsSync(SCHEMA_PATH), 'knowledge/schema.json must exist').toBe(true);
    expect(existsSync(ENTRIES_DIR), 'knowledge/entries/ must exist').toBe(true);
    const entries = listEntryFiles();
    expect(entries.length, 'expected >= 1 seed entry under knowledge/entries/').toBeGreaterThanOrEqual(1);
  });

  it('knowledge_entries_have_no_absolute_paths', () => {
    const entries = listEntryFiles();
    expect(entries.length, 'no entries to scan — knowledge/entries/ empty or missing').toBeGreaterThan(0);
    for (const name of entries) {
      const raw = readFileSync(join(ENTRIES_DIR, name), 'utf8');
      const { content } = matter(raw);
      for (const pattern of DENY_PATH_FRAGMENTS) {
        expect(content, `entry ${name} body must not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('knowledge_entry_frontmatter_validates', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const entries = listEntryFiles();
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      const raw = readFileSync(join(ENTRIES_DIR, name), 'utf8');
      const { data } = matter(raw);
      const ok = validate(data);
      expect(ok, `entry ${name} failed schema: ${JSON.stringify(validate.errors)}`).toBe(true);
      // id field must match filename slug.
      expect(data.id).toBe(name.replace(/\.md$/, ''));
    }
  });
});

describe('AC12 — KB schema validates good entries, rejects bad ones', () => {
  it('kb_schema_test_suite', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const fixturesDir = join(REPO_ROOT, 'tests', 'fixtures', 'kb-entries');

    const valid = matter(readFileSync(join(fixturesDir, 'valid.md'), 'utf8')).data;
    expect(validate(valid),
      'valid.md should pass: ' + JSON.stringify(validate.errors)).toBe(true);

    const missingId = matter(readFileSync(join(fixturesDir, 'missing-id.md'), 'utf8')).data;
    expect(validate(missingId), 'missing-id.md should be rejected').toBe(false);

    const invalidTags = matter(readFileSync(join(fixturesDir, 'invalid-tags.md'), 'utf8')).data;
    expect(validate(invalidTags), 'invalid-tags.md should be rejected').toBe(false);
  });
});
