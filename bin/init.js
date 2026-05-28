#!/usr/bin/env node
// bin/init.js
// TASK-012 — project-intake wizard entrypoint. Four-branch state machine:
//   1. already_initialized — PROJECT.md present, no --force: print summary, exit.
//   2. forced               — --force passed: fresh bundle, overwrite PROJECT.md.
//   3. resumed              — pointer + bundle + intake.json present: reuse the
//                             active session, runQuestionnaire resumes from the
//                             persisted answers via persistTo.
//   4. created              — fresh repo: startSession spins up a new bundle.
//
// Design notes:
//   * `runInit` is testable in isolation — argv, prompter, repoRoot, and `now`
//     are injected. Tests pass `hostname: 'test-host'` but the parameter is
//     intentionally ignored (extra keys are silently dropped). startSession()
//     owns host identification through its manifest; carrying a duplicate
//     hostname channel through runInit would invite drift.
//   * Branch order matters: --force is checked BEFORE the PROJECT.md guard so
//     "force re-init on an initialized repo" works. The PROJECT.md guard runs
//     BEFORE the resume guard so a completed init never re-prompts even if a
//     pointer happens to still be on disk. Resume runs BEFORE create so a
//     half-finished wizard does not get clobbered by a fresh bundle.
//   * The engine-shape prompter `({prompt, type, enum?, error?}) => string` is
//     forwarded directly (no adaptation) — runInit's contract IS the engine
//     contract, unlike bin/new-task.js which wraps a legacy (text)=>string.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { startSession } from '../src/lifecycle.js';
import { readPointer } from '../src/pointer.js';
import { runQuestionnaire } from '../src/question-engine.js';
import { buildIntakeQuestions } from '../src/question-library.js';
import { writeProjectMd, readProjectMd } from '../src/project-md.js';
import { generateProjectContext } from '../src/agent-generator.js';
import { seedBacklog } from '../src/backlog-seeder.js';
import { archiveFrameworkHistory } from '../src/framework-history.js';

const KNOWN_FLAGS = new Set(['--force', '--help', '--no-archive']);
const TASK_FILE_RE = /^TASK-\d{3,}\.json$/;

/**
 * Parse argv. Every token must be a recognized long flag; positional tokens
 * (anything not in KNOWN_FLAGS) throw with the offending token in the message,
 * matching bin/new-task.js's strictness so typos and stray args surface fast.
 */
function parseArgs(argv) {
  const out = { force: false, help: false, noArchive: false };
  for (const tok of argv) {
    if (!KNOWN_FLAGS.has(tok)) {
      throw new Error(`unknown argument: ${tok}`);
    }
    if (tok === '--force') out.force = true;
    if (tok === '--help') out.help = true;
    if (tok === '--no-archive') out.noArchive = true;
  }
  return out;
}

/**
 * Lightweight peek at <repoRoot>/tasks/ for the archive prompt. Returns the
 * count of TASK-NNN.json files that look like framework history (i.e. none
 * carry the `seed` label). Returns 0 when:
 *   - tasks/ is absent, OR
 *   - no TASK-NNN.json files exist, OR
 *   - any existing TASK-NNN.json carries the `seed` label.
 * Mirrors archiveFrameworkHistory's detection so the user is never prompted
 * for an archive that would no-op.
 */
function countFrameworkHistory(repoRoot) {
  const tasksDir = join(repoRoot, 'tasks');
  if (!existsSync(tasksDir)) return 0;
  const taskFiles = readdirSync(tasksDir).filter((n) => TASK_FILE_RE.test(n));
  if (taskFiles.length === 0) return 0;
  for (const name of taskFiles) {
    try {
      const t = JSON.parse(readFileSync(join(tasksDir, name), 'utf8'));
      if (Array.isArray(t.labels) && t.labels.includes('seed')) {
        return 0;
      }
    } catch {
      // Corrupt ticket: treat as framework history (consistent with archive).
    }
  }
  return taskFiles.length;
}

/**
 * Ask the user whether to archive pre-existing framework-history tickets, then
 * invoke archiveFrameworkHistory on consent. Skipped entirely when:
 *   - the caller passed --no-archive, OR
 *   - the peek finds nothing to archive.
 *
 * Decision rule: empty input OR a Y/y prefix → archive; anything else → skip.
 */
async function maybeArchiveFrameworkHistory({ repoRoot, prompter, noArchive, now }) {
  if (noArchive) return;
  const count = countFrameworkHistory(repoRoot);
  if (count === 0) return;
  const answer = await prompter({
    prompt:
      `Detected ${count} pre-existing tickets that look like framework history. ` +
      'Archive them so this project starts fresh? [Y/n]',
    type: 'string',
  });
  const trimmed = typeof answer === 'string' ? answer.trim() : '';
  const consent = trimmed === '' || /^y/i.test(trimmed);
  if (!consent) return;
  await archiveFrameworkHistory({ repoRoot, now });
}

/**
 * Path to the in-bundle intake persistence file.
 */
function intakePath(repoRoot, sessionId) {
  return join(repoRoot, 'state', 'sessions', sessionId, 'intake.json');
}

/**
 * Try to read `{answers, lastAnsweredId}` from an intake.json file. Returns
 * the parsed payload on success, or null if the file is missing or unparseable.
 */
function tryReadIntake(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && raw.answers && typeof raw.answers === 'object') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run the intake wizard with persistence into the bundle, then materialize
 * PROJECT.md from the collected answers.
 */
async function runWizardAndWriteProjectMd({ repoRoot, sessionId, prompter, now }) {
  const persistTo = intakePath(repoRoot, sessionId);
  const { answers } = await runQuestionnaire({
    questions: buildIntakeQuestions(),
    prompter,
    persistTo,
    now,
  });
  await writeProjectMd({ repoRoot, answers, now });
  // TASK-013 — emit the per-project agent briefing alongside PROJECT.md.
  // The in-memory `answers` are passed through so the generator doesn't have
  // to read back from disk; this keeps init's "write once, read never"
  // semantics intact during the wizard run.
  await generateProjectContext({ repoRoot, answers, now });
  // TASK-014 — mint the day-one starter backlog from the intake's
  // primary_use_cases. seedBacklog is idempotent via the `seed` label: a
  // --force re-run will not duplicate tickets the user has already touched.
  //
  // TASK-017 AC5 — wrap in try/catch that surfaces a user-visible warning
  // BEFORE re-throwing. PROJECT.md and project-context.md are already on disk
  // by this point; the user must learn about a half-minted backlog
  // immediately, because a partial seed corrupts the idempotency guard for
  // any future --force re-run. Silent-continue is NOT acceptable.
  try {
    await seedBacklog({ repoRoot, answers, now });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `backlog seeder failed mid-mint: ${err && err.message ? err.message : err}`,
    );
    throw err;
  }
  return { projectMdPath: join(repoRoot, 'PROJECT.md') };
}

/**
 * Main entrypoint. See file header for branch semantics.
 *
 * @param {object} opts
 * @param {string[]} opts.argv
 * @param {(ctx: {prompt: string, type: string, enum?: string[], error?: string}) => Promise<string>} opts.prompter
 * @param {string} opts.repoRoot
 * @param {() => string} [opts.now]
 * @returns {Promise<{state: 'already_initialized'|'forced'|'resumed'|'created', projectMdPath: string, sessionId: string|null}>}
 */
export async function runInit({
  argv,
  prompter,
  repoRoot,
  now = () => new Date().toISOString(),
}) {
  const parsed = parseArgs(argv);

  const projectMdPath = join(repoRoot, 'PROJECT.md');
  const projectMdExists = existsSync(projectMdPath);

  // ---- Branch 2: forced (takes precedence over already_initialized) ----
  if (parsed.force) {
    const { sessionId } = await startSession({ repoRoot });
    await runWizardAndWriteProjectMd({ repoRoot, sessionId, prompter, now });
    return { state: 'forced', projectMdPath, sessionId };
  }

  // ---- Branch 1: already_initialized ----
  if (projectMdExists) {
    const { frontmatter } = await readProjectMd({ repoRoot });
    // One-line summary to stdout. Non-emoji marker — see header.
    // eslint-disable-next-line no-console
    console.log(
      `Project already initialized: ${frontmatter.name} ` +
      `(${frontmatter.type}, created ${frontmatter.created_at})`,
    );
    const pointer = readPointer(repoRoot);
    const sessionId = pointer && pointer.active_session_id ? pointer.active_session_id : null;
    return { state: 'already_initialized', projectMdPath, sessionId };
  }

  // ---- Branch 3: resumed ----
  const pointer = readPointer(repoRoot);
  if (pointer && pointer.active_session_id) {
    const candidatePath = intakePath(repoRoot, pointer.active_session_id);
    const partial = tryReadIntake(candidatePath);
    if (partial) {
      const sessionId = pointer.active_session_id;
      await runWizardAndWriteProjectMd({ repoRoot, sessionId, prompter, now });
      return { state: 'resumed', projectMdPath, sessionId };
    }
  }

  // ---- Branch 4: created ----
  // The archive prompt is strictly a created-branch concern. forced and
  // already_initialized both imply the project has past-the-archive state on
  // disk; resumed already has a half-answered wizard and replaying the
  // archive prompt mid-resume would be jarring.
  await maybeArchiveFrameworkHistory({
    repoRoot,
    prompter,
    noArchive: parsed.noArchive,
    now,
  });
  const { sessionId } = await startSession({ repoRoot });
  await runWizardAndWriteProjectMd({ repoRoot, sessionId, prompter, now });
  return { state: 'created', projectMdPath, sessionId };
}

/* -------------------------------------------------------------------------- */
/*                                CLI shell                                   */
/* -------------------------------------------------------------------------- */

/**
 * Engine-shape readline prompter for terminal use. Renders the prompt with an
 * `(error)` prefix when the engine signals a validation retry, and appends the
 * enum/multi hint so the user sees the valid choices inline.
 */
function realReadlinePrompter() {
  const rl = createInterface({ input, output });
  return async (ctx) => {
    let text = ctx.prompt;
    if (ctx.type === 'enum' && Array.isArray(ctx.enum)) {
      text += ` (${ctx.enum.join(' | ')})`;
    } else if (ctx.type === 'multi' && Array.isArray(ctx.enum)) {
      text += ` (comma-separated from: ${ctx.enum.join(', ')})`;
    }
    if (ctx.error) {
      text = `(${ctx.error}) ${text}`;
    }
    return rl.question(`${text} `);
  };
}

function printFriendlyOutcome({ state, projectMdPath, sessionId }) {
  if (state === 'already_initialized') {
    // Summary already printed inside runInit's detection branch.
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`* PROJECT.md written to ${projectMdPath}`);
  // eslint-disable-next-line no-console
  console.log(`* Session bundle: state/sessions/${sessionId}/`);
  // eslint-disable-next-line no-console
  console.log('Next step: start a chat with the orchestrator and ask it to plan the first phase.');
}

function printFriendlyError(err) {
  // eslint-disable-next-line no-console
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

// Only fire the top-level runner when invoked as the entry script (not on
// import from tests). pathToFileURL normalizes the OS-specific argv[1] path
// to a file:// URL comparable with import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInit({
    argv: process.argv.slice(2),
    prompter: realReadlinePrompter(),
    repoRoot: process.cwd(),
  })
    .then(printFriendlyOutcome)
    .catch(printFriendlyError);
}
