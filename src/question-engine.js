// src/question-engine.js
// TASK-010 — driver for an injectable questionnaire used by the new-task CLI
// and (later) the project-init wizard. Exports runQuestionnaire({questions,
// prompter, persistTo, now}) -> Promise<{answers, completedAt}>.
//
// Design notes:
//   * The engine owns iteration, validation, re-prompting, branching, and
//     atomic persistence. The caller owns I/O — a `prompter(ctx)` async
//     function returning the raw string answer.
//   * Persistence is single-file (atomicWriteFile). Each accepted answer
//     triggers a write of `{answers, lastAnsweredId}` so a Ctrl+C between
//     answers leaves a resumable state file behind.
//   * Resume reads `persistTo` once at entry; questions whose id is already
//     present in the loaded `answers` map are skipped.

import { existsSync, readFileSync } from 'node:fs';

import { atomicWriteFile } from './atomic-write.js';

const VALID_TYPES = new Set(['string', 'number', 'enum', 'multi']);

/**
 * Run a questionnaire to completion.
 *
 * @param {object} opts
 * @param {Array<object>} opts.questions
 * @param {(ctx: {prompt: string, type: string, enum?: string[], error?: string}) => Promise<string>} opts.prompter
 * @param {string|null} opts.persistTo - absolute path to resume/save file, or null
 * @param {() => string} [opts.now]
 * @returns {Promise<{answers: object, completedAt: string}>}
 */
export async function runQuestionnaire({
  questions,
  prompter,
  persistTo,
  now = () => new Date().toISOString(),
}) {
  // ---- config-time validation (synchronous before any prompter call) ----
  if (!Array.isArray(questions)) {
    throw new Error('runQuestionnaire: `questions` must be an array');
  }
  const seenIds = new Set();
  for (const q of questions) {
    if (!q || typeof q.id !== 'string') {
      throw new Error('runQuestionnaire: every question requires a string `id`');
    }
    if (!VALID_TYPES.has(q.type)) {
      throw new Error(
        `runQuestionnaire: question "${q.id}" has unknown type "${q.type}" ` +
        `(expected one of: ${[...VALID_TYPES].join(', ')})`,
      );
    }
    if (seenIds.has(q.id)) {
      throw new Error(
        `runQuestionnaire: duplicate question id "${q.id}" — ids must be unique`,
      );
    }
    seenIds.add(q.id);
  }

  // ---- resume (if persistTo points at a parseable partial state file) ----
  let answers = {};
  if (persistTo && existsSync(persistTo)) {
    try {
      const raw = JSON.parse(readFileSync(persistTo, 'utf8'));
      if (raw && typeof raw === 'object' && raw.answers && typeof raw.answers === 'object') {
        answers = { ...raw.answers };
      }
    } catch {
      // Corrupt resume file — treat as no-resume rather than block the user.
      answers = {};
    }
  }

  // ---- iterate ----
  for (const q of questions) {
    if (Object.prototype.hasOwnProperty.call(answers, q.id)) {
      continue; // resumed from a prior run
    }
    if (typeof q.when === 'function' && q.when(answers) === false) {
      continue;
    }

    const required = q.required !== false; // default true
    let lastError;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ctx = { prompt: q.prompt, type: q.type };
      if (q.enum !== undefined) ctx.enum = q.enum;
      if (lastError !== undefined) ctx.error = lastError;

      const raw = await prompter(ctx);
      const validated = validateAndCoerce(q, raw, required, answers);
      if (validated.error) {
        lastError = validated.error;
        continue;
      }
      answers[q.id] = validated.value;
      if (persistTo) {
        const payload = JSON.stringify(
          { answers, lastAnsweredId: q.id },
          null,
          2,
        ) + '\n';
        await atomicWriteFile(persistTo, payload);
      }
      break;
    }
  }

  return { answers, completedAt: now() };
}

/**
 * Validate + coerce one raw prompter response against a question definition.
 * Returns `{value}` on success or `{error}` on validation failure.
 */
function validateAndCoerce(q, raw, required, answers) {
  const rawStr = typeof raw === 'string' ? raw : String(raw ?? '');
  const trimmed = rawStr.trim();

  // required-check first
  if (trimmed.length === 0) {
    if (!required) {
      return { value: null };
    }
    return { error: `field "${q.id}" is required` };
  }

  // type checks
  let value;
  switch (q.type) {
    case 'string': {
      value = rawStr;
      break;
    }
    case 'number': {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        return { error: `field "${q.id}" must be a number (got "${rawStr}")` };
      }
      value = n;
      break;
    }
    case 'enum': {
      const choices = Array.isArray(q.enum) ? q.enum : [];
      if (!choices.includes(trimmed)) {
        return {
          error:
            `field "${q.id}" must be one of enum [${choices.join(', ')}] ` +
            `(got "${trimmed}")`,
        };
      }
      value = trimmed;
      break;
    }
    case 'multi': {
      const choices = Array.isArray(q.enum) ? q.enum : [];
      const tokens = [...new Set(
        rawStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
      )];
      const unknown = tokens.filter((t) => !choices.includes(t));
      if (unknown.length > 0) {
        return {
          error:
            `field "${q.id}" has unknown value(s) [${unknown.join(', ')}]; ` +
            `valid values are [${choices.join(', ')}]`,
        };
      }
      value = tokens;
      break;
    }
    default:
      // Unreachable — config validation rejects unknown types at entry.
      return { error: `field "${q.id}" has unsupported type "${q.type}"` };
  }

  // custom validate(value, answers) hook — runs after type coercion
  if (typeof q.validate === 'function') {
    const verdict = q.validate(value, answers);
    if (verdict) {
      return { error: String(verdict) };
    }
  }

  return { value };
}
