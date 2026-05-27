// src/project-md.js
// TASK-011 — persist the intake answers as a human-readable PROJECT.md with a
// machine-readable YAML frontmatter. Writer and reader share a single id-to-
// section table so round-trip is lossless without duplicated maps drifting
// out of sync.
//
// File layout:
//   ---
//   name: <project_name>
//   type: <project_type>
//   created_at: <ISO timestamp>
//   schema_version: 1
//   ---
//
//   # <project_name>
//
//   ## Description
//   <project_description>
//
//   ## Target users
//   <target_users>
//
//   ## Primary use cases
//   - <use case 1>
//   - <use case 2>
//
//   ## Success criteria
//   <success_criteria>
//
//   ## Stack
//   - <key>: <value>
//   - ...
//
// Frontmatter parser is a deliberately tiny subset (see parseFrontmatter): it
// accepts ONLY scalar `key: value` lines and inline `[a, b, c]` arrays. Any
// nested-object form (a line ending in `:` followed by an indented line)
// raises an error rather than silently coercing — this keeps the schema
// closed so future contributors can't sneak in unstructured config.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from './atomic-write.js';

const PROJECT_MD = 'PROJECT.md';
const SCHEMA_VERSION = 1;

// Single source of truth for body-section <-> answer-id mapping. Used by both
// writer and reader so the round-trip cannot drift. Keys are ordered: that
// order is the order sections appear in the file. `bullets: true` means the
// section value is rendered as a markdown bullet list and parsed back as an
// array; otherwise the section is a single prose block.
const BODY_SECTIONS = [
  { id: 'project_description', heading: 'Description', bullets: false },
  { id: 'target_users', heading: 'Target users', bullets: false },
  { id: 'primary_use_cases', heading: 'Primary use cases', bullets: true },
  { id: 'success_criteria', heading: 'Success criteria', bullets: false },
];

// Frontmatter answer ids are written into YAML rather than the body. Everything
// not in BODY_SECTIONS and not in this set lands in the `## Stack` section.
const FRONTMATTER_IDS = new Set(['project_name', 'project_type']);

/**
 * Write PROJECT.md at <repoRoot>/PROJECT.md via atomicWriteFile.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the project root
 * @param {object} opts.answers - intake answers (must include project_name,
 *   project_type at minimum)
 * @param {() => string} [opts.now] - injectable clock for created_at
 * @returns {Promise<{path: string}>}
 */
export async function writeProjectMd({ repoRoot, answers, now = () => new Date().toISOString() }) {
  const target = join(repoRoot, PROJECT_MD);
  const createdAt = now();
  const body = renderProjectMd(answers, createdAt);
  await atomicWriteFile(target, body);
  return { path: target };
}

/**
 * Read PROJECT.md from <repoRoot>/PROJECT.md and return `{answers, frontmatter}`.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @returns {Promise<{answers: object, frontmatter: object}>}
 */
export async function readProjectMd({ repoRoot }) {
  const target = join(repoRoot, PROJECT_MD);
  if (!existsSync(target)) {
    throw new Error(`PROJECT.md not found at ${target}`);
  }
  const text = await readFile(target, 'utf8');
  return parseProjectMd(text);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderProjectMd(answers, createdAt) {
  const name = answers.project_name ?? '';
  const type = answers.project_type ?? '';

  // Frontmatter — scalar lines only, no quoting (values may not contain ':').
  const fmLines = [
    '---',
    `name: ${name}`,
    `type: ${type}`,
    `created_at: ${createdAt}`,
    `schema_version: ${SCHEMA_VERSION}`,
    '---',
    '',
  ];

  // Body — title + the four well-known sections in BODY_SECTIONS order, then
  // a Stack section listing everything else.
  const out = [...fmLines, `# ${name}`, ''];

  for (const sec of BODY_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(answers, sec.id)) continue;
    const value = answers[sec.id];
    out.push(`## ${sec.heading}`);
    if (sec.bullets) {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        out.push(`- ${item}`);
      }
    } else {
      out.push(String(value));
    }
    out.push('');
  }

  // Stack: every answer key not consumed above.
  const consumed = new Set([
    ...FRONTMATTER_IDS,
    ...BODY_SECTIONS.map((s) => s.id),
  ]);
  const stackKeys = Object.keys(answers).filter((k) => !consumed.has(k));
  if (stackKeys.length > 0) {
    out.push('## Stack');
    for (const key of stackKeys) {
      out.push(`- ${key}: ${formatStackValue(answers[key])}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function formatStackValue(value) {
  if (Array.isArray(value)) {
    return `[${value.join(', ')}]`;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseProjectMd(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    throw new Error('PROJECT.md is missing the opening "---" frontmatter delimiter');
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error('PROJECT.md frontmatter has no closing "---" delimiter');
  }

  const fmLines = lines.slice(1, closeIdx);
  const frontmatter = parseFrontmatter(fmLines);

  const bodyLines = lines.slice(closeIdx + 1);
  const sections = parseBodySections(bodyLines);

  // Reconstruct the answers map. Frontmatter contributes name/type plus the
  // writer-added created_at and schema_version (kept under their original
  // frontmatter keys so the schema validator can run against `frontmatter`
  // alone, while round-trip callers see everything in `answers`).
  const answers = {};
  if (frontmatter.name !== undefined) answers.project_name = frontmatter.name;
  if (frontmatter.type !== undefined) answers.project_type = frontmatter.type;
  if (frontmatter.created_at !== undefined) answers.created_at = frontmatter.created_at;
  if (frontmatter.schema_version !== undefined) answers.schema_version = frontmatter.schema_version;

  for (const sec of BODY_SECTIONS) {
    const block = sections.get(sec.heading);
    if (block === undefined) continue;
    if (sec.bullets) {
      answers[sec.id] = parseBullets(block);
    } else {
      const joined = block.join('\n').trim();
      if (joined.length > 0) {
        answers[sec.id] = joined;
      }
    }
  }

  // Stack: each bullet is `- key: value`. The key is taken verbatim (snake_case
  // preserved); values are coerced back from `[a, b, c]` to arrays when the
  // writer used the inline-array form.
  const stack = sections.get('Stack');
  if (stack !== undefined) {
    for (const line of stack) {
      const m = line.match(/^-\s+([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const rawValue = m[2].trim();
      answers[key] = parseStackValue(rawValue);
    }
  }

  return { answers, frontmatter };
}

/**
 * In-house YAML subset parser. Accepts ONLY:
 *   - blank lines (ignored)
 *   - `key: value` scalar lines (value taken verbatim, trimmed)
 *   - `key: [a, b, c]` inline arrays (split on ',' and trimmed)
 * Numeric-looking values are coerced to Number; integers stay integers.
 * Anything else — notably a `key:` line followed by an indented continuation
 * (nested object) — raises an error rather than guessing.
 */
function parseFrontmatter(fmLines) {
  const out = {};
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (line.trim().length === 0) continue;

    // Reject indented continuations — these indicate an unsupported nested
    // structure regardless of what the parent line looked like.
    if (/^\s+\S/.test(line)) {
      throw new Error(
        'PROJECT.md frontmatter contains an indented (nested) line; ' +
        'nested objects are unsupported by the in-house yaml subset',
      );
    }

    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) {
      throw new Error(
        `PROJECT.md frontmatter line is not a recognized scalar/array entry: ${JSON.stringify(line)}`,
      );
    }
    const key = m[1];
    const rawValue = m[2];

    // Bare `key:` with no value AND a subsequent indented line is a nested
    // object — explicitly reject. (A bare `key:` with no indented follow-up
    // would be an empty string, but we treat it as unsupported here to keep
    // the surface area tight.)
    if (rawValue.length === 0) {
      const next = fmLines[i + 1];
      if (next !== undefined && /^\s+\S/.test(next)) {
        throw new Error(
          `PROJECT.md frontmatter key "${key}" appears to introduce a nested object; ` +
          'nested yaml is unsupported by the in-house parser',
        );
      }
      out[key] = '';
      continue;
    }

    out[key] = coerceFrontmatterScalar(rawValue);
  }
  return out;
}

function coerceFrontmatterScalar(raw) {
  // Inline array: [a, b, c]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((s) => s.trim());
  }
  // Integer
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function parseBodySections(bodyLines) {
  const sections = new Map();
  let current = null;
  let buffer = [];
  for (const line of bodyLines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current !== null) sections.set(current, trimEdges(buffer));
      current = h[1];
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  if (current !== null) sections.set(current, trimEdges(buffer));
  return sections;
}

function trimEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) start++;
  while (end > start && lines[end - 1].trim().length === 0) end--;
  return lines.slice(start, end);
}

function parseBullets(blockLines) {
  const out = [];
  for (const line of blockLines) {
    const m = line.match(/^-\s+(.*)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function parseStackValue(raw) {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((s) => s.trim());
  }
  return raw;
}
