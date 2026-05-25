// src/knowledge.js
// Three responsibilities:
//   (1) validateEntry(entryPath)         — schema-validate a single entry file
//   (2) lookupKnowledge({ repoRoot, question })
//                                        — deterministic three-pass lookup per research §F
//   (3) recordKbReuse({ repoRoot, entryId, at })
//                                        — atomic update of last_seen_at, body preserved

import {
  readFileSync, readdirSync, existsSync, statSync,
} from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { atomicWriteFile } from './atomic-write.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or',
  'is', 'are', 'be', 'as', 'at', 'by', 'it', 'this', 'that', 'these',
  'those', 'do', 'does', 'how', 'what', 'when', 'where', 'why', 'can',
  'should', 'would', 'could', 'i', 'you', 'we', 'they',
]);

/* -------------------------------------------------------------------------- */
/*                                validateEntry                               */
/* -------------------------------------------------------------------------- */

/**
 * Schema-validate a single knowledge entry file's frontmatter.
 *
 * @param {{ repoRoot: string, entryPath: string }} args
 * @returns {{ valid: boolean, errors: any[]|null, data: object }}
 */
export function validateEntry({ repoRoot, entryPath }) {
  const schemaPath = join(repoRoot, 'knowledge', 'schema.json');
  if (!existsSync(schemaPath)) {
    throw makeErr('E_KB_SCHEMA_MISSING', `knowledge/schema.json not found at ${schemaPath}`);
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const compiled = ajv.compile(schema);

  const raw = readFileSync(entryPath, 'utf8');
  const { data } = matter(raw);
  const ok = compiled(data);
  return { valid: ok, errors: ok ? null : compiled.errors, data };
}

/* -------------------------------------------------------------------------- */
/*                              lookupKnowledge                               */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic KB lookup per research §F.
 *   1. Tokenize the question (lowercase, drop stopwords, keep tokens ≥ 3 chars).
 *   2. Three-pass scan over knowledge/entries/*.md:
 *        - tag matches      → weight 3
 *        - symptom matches  → weight 2
 *        - problem/body     → weight 1
 *   3. Rank by score; tie-break by recent last_seen_at.
 *   4. Return the top-3 candidate hits as { id, score, used: false }.
 *      (The Researcher decides `used` on the way back; the Orchestrator
 *       then calls recordKbReuse on the entry that answered the question.)
 *
 * @param {{ repoRoot: string, question: string }} args
 * @returns {Promise<{ kb_hits: Array<{ id: string, score: number, used: boolean }> }>}
 */
export async function lookupKnowledge({ repoRoot, question }) {
  if (!repoRoot) throw makeErr('E_KB_ARGS', 'lookupKnowledge: repoRoot is required');
  if (typeof question !== 'string') {
    throw makeErr('E_KB_ARGS', 'lookupKnowledge: question must be a string');
  }
  const entriesDir = join(repoRoot, 'knowledge', 'entries');
  if (!existsSync(entriesDir)) {
    return { kb_hits: [] };
  }

  const tokens = tokenize(question);
  if (tokens.length === 0) {
    return { kb_hits: [] };
  }

  const candidates = [];
  for (const filename of readdirSync(entriesDir)) {
    if (!filename.endsWith('.md')) continue;
    const path = join(entriesDir, filename);
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    const data = parsed.data || {};
    const id = data.id || filename.replace(/\.md$/, '');

    const tagTokens = new Set(
      (data.tags || [])
        .flatMap((t) => tokenize(String(t)))
    );
    const symptomTokens = new Set(
      (data.symptoms || [])
        .flatMap((s) => tokenize(String(s)))
    );
    const bodyTokens = new Set([
      ...tokenize(String(data.problem || '')),
      ...tokenize(parsed.content || ''),
    ]);

    let score = 0;
    let tagHits = 0;
    let symptomHits = 0;
    let bodyHits = 0;
    for (const t of tokens) {
      if (tagTokens.has(t)) tagHits++;
      if (symptomTokens.has(t)) symptomHits++;
      if (bodyTokens.has(t)) bodyHits++;
    }
    score = tagHits * 3 + symptomHits * 2 + bodyHits * 1;

    if (score > 0) {
      candidates.push({
        id,
        score,
        last_seen_at: String(data.last_seen_at || ''),
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break by most recent last_seen_at.
    return (b.last_seen_at || '').localeCompare(a.last_seen_at || '');
  });

  return {
    kb_hits: candidates.slice(0, 3).map((c) => ({
      id: c.id,
      score: c.score,
      used: false,
    })),
  };
}

/**
 * Lowercase, split on whitespace and punctuation, drop English stopwords,
 * keep tokens of length >= 3. Deterministic given a fixed STOPWORDS set.
 */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/* -------------------------------------------------------------------------- */
/*                                recordKbReuse                               */
/* -------------------------------------------------------------------------- */

/**
 * Update the `last_seen_at` field of a knowledge entry, preserving the body
 * byte-for-byte. Uses the atomic temp+rename helper so a concurrent reader
 * never observes a partial write.
 *
 * @param {{ repoRoot: string, entryId: string, at?: string }} args
 */
export async function recordKbReuse({ repoRoot, entryId, at }) {
  if (!repoRoot) throw makeErr('E_KB_ARGS', 'recordKbReuse: repoRoot is required');
  if (!entryId) throw makeErr('E_KB_ARGS', 'recordKbReuse: entryId is required');

  const entryPath = join(repoRoot, 'knowledge', 'entries', `${entryId}.md`);
  if (!existsSync(entryPath)) {
    throw makeErr('E_KB_NOT_FOUND', `recordKbReuse: entry not found at ${entryPath}`);
  }

  const raw = readFileSync(entryPath, 'utf8');
  const parsed = matter(raw);
  const newData = { ...parsed.data, last_seen_at: at || new Date().toISOString() };
  const rebuilt = matter.stringify(parsed.content, newData);
  await atomicWriteFile(entryPath, rebuilt);
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
