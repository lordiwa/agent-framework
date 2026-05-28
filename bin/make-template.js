#!/usr/bin/env node
// bin/make-template.js
// TASK-019 — upstream template-prep step. Brings a distribution copy of the
// dev repo to PRISTINE clone-ready state BEFORE it is published/cloned, so
// init's created branch runs with nothing to archive.
//
// Relationship to src/framework-history.js: archiveFrameworkHistory is the
// RUNTIME safety net invoked by bin/init.js — it only MOVES TASK-NNN.json into
// .framework-history/ at init time, and notably leaves TASK-* .md sidecars and
// the dev session bundle behind. make-template is the CLEAN-SLATE mechanism: it
// REMOVES the tickets and their sidecars outright, wipes the session bundle,
// resets the pointer, and drops the per-project PROJECT.md / project-context.md
// — while preserving the framework assets (base agents, knowledge/, src/, bin/,
// tests/). It does NOT create .framework-history/ (it is the alternative to
// archiving, not a second archive).
//
// Design notes:
//   * makeTemplate is testable in isolation — repoRoot, now, and apply are all
//     injected. No implicit process.cwd() / Date.now() in the exported function;
//     the CLI shell is the only place those defaults are bound.
//   * SAFE BY DEFAULT. apply defaults to false (dry-run): a careless run must
//     not nuke a live dev repo's git-tracked history. Mutation requires the
//     explicit --yes flag (apply:true). A dry-run performs ZERO filesystem
//     mutation and returns the plan it WOULD execute.
//   * parseArgs mirrors bin/init.js / bin/new-task.js strictness: every token
//     must be a recognized long flag; unknown flags AND stray positionals throw
//     with the offending token named in the message so typos surface fast.

import {
  existsSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { atomicWriteFile } from '../src/atomic-write.js';

// TASK-NNN.json tickets AND any TASK-* sidecar (e.g. TASK-004.research.md,
// TASK-004.test-runtime-proposal.md). The runtime archiver only matches the
// stricter `^TASK-\d{3,}\.json$`; make-template deliberately sweeps the whole
// TASK-* family so no sidecar survives into the distribution.
const TASK_RESIDUE_RE = /^TASK-/;

const KNOWN_FLAGS = new Set(['--yes', '--help']);

/**
 * Parse argv. Every token must be a recognized long flag; positional tokens
 * (anything not in KNOWN_FLAGS) throw with the offending token in the message,
 * matching bin/init.js / bin/new-task.js strictness. `--yes` maps to apply:true;
 * the default is a dry-run (apply:false).
 *
 * @param {string[]} argv
 * @returns {{ apply: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const out = { apply: false, help: false };
  for (const tok of argv) {
    if (!KNOWN_FLAGS.has(tok)) {
      throw new Error(`unknown argument: ${tok}`);
    }
    if (tok === '--yes') out.apply = true;
    if (tok === '--help') out.help = true;
  }
  return out;
}

/**
 * Compute the set of template-prep targets for <repoRoot>. Pure inspection —
 * no mutation. Returns relative paths (POSIX-style separators) partitioned by
 * action so both the dry-run plan and the apply path share one source of truth.
 *
 * The plan is scoped to TARGET basenames/paths only — it deliberately does NOT
 * enumerate asset files (base agents, knowledge/ entries) so a serialized plan
 * never names something it would not touch.
 *
 * @param {string} repoRoot
 * @returns {{ removeFiles: string[], removeDirs: string[], rewriteFiles: string[] }}
 */
function computeTargets(repoRoot) {
  const removeFiles = [];
  const removeDirs = [];
  const rewriteFiles = [];

  // --- tasks/ : remove every TASK-* file, rewrite index.json to empty store ---
  const tasksDir = join(repoRoot, 'tasks');
  if (existsSync(tasksDir)) {
    for (const name of readdirSync(tasksDir).sort()) {
      if (TASK_RESIDUE_RE.test(name)) {
        removeFiles.push(`tasks/${name}`);
      }
    }
    // index.json is always rewritten (to the empty store) when tasks/ exists,
    // whether or not a stale one is present.
    rewriteFiles.push('tasks/index.json');
  }

  // --- state/ : reset pointer, empty state/sessions/ of bundle dirs ---
  const stateDir = join(repoRoot, 'state');
  if (existsSync(join(stateDir, 'session.json'))) {
    rewriteFiles.push('state/session.json');
  }
  const sessionsDir = join(stateDir, 'sessions');
  if (existsSync(sessionsDir)) {
    for (const name of readdirSync(sessionsDir).sort()) {
      const full = join(sessionsDir, name);
      if (statSync(full).isDirectory()) {
        removeDirs.push(`state/sessions/${name}`);
      } else {
        // Stray non-directory entry under sessions/ — sweep it too.
        removeFiles.push(`state/sessions/${name}`);
      }
    }
  }

  // --- per-project files removed if present ---
  if (existsSync(join(repoRoot, 'PROJECT.md'))) {
    removeFiles.push('PROJECT.md');
  }
  if (existsSync(join(repoRoot, '.claude', 'agents', 'project-context.md'))) {
    removeFiles.push('.claude/agents/project-context.md');
  }

  return { removeFiles, removeDirs, rewriteFiles };
}

/**
 * Bring <repoRoot> to pristine template state.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the distribution copy root
 * @param {() => string} [opts.now] - injected clock for the rewritten JSON
 * @param {boolean} [opts.apply=false] - false = dry-run (zero mutation); true = mutate
 * @returns {Promise<{
 *   apply: boolean,
 *   removeFiles: string[],
 *   removeDirs: string[],
 *   rewriteFiles: string[],
 * }>} the plan that was (or would be) executed
 */
export async function makeTemplate({
  repoRoot,
  now = () => new Date().toISOString(),
  apply = false,
}) {
  const { removeFiles, removeDirs, rewriteFiles } = computeTargets(repoRoot);

  const plan = { apply, removeFiles, removeDirs, rewriteFiles };

  // Dry-run: report the plan, mutate nothing.
  if (!apply) {
    return plan;
  }

  // ---- apply: execute the plan ----

  // 1. Remove every TASK-* file and per-project file.
  for (const rel of removeFiles) {
    rmSync(join(repoRoot, ...rel.split('/')), { force: true });
  }

  // 2. Remove every session bundle directory.
  for (const rel of removeDirs) {
    rmSync(join(repoRoot, ...rel.split('/')), { recursive: true, force: true });
  }

  // 3. Rewrite tasks/index.json to the empty store (if tasks/ exists).
  if (rewriteFiles.includes('tasks/index.json')) {
    const indexPayload = JSON.stringify(
      { generated_at: now(), tasks: [] },
      null,
      2,
    ) + '\n';
    await atomicWriteFile(join(repoRoot, 'tasks', 'index.json'), indexPayload);
  }

  // 4. Reset state/session.json to the idle pointer (if a pointer exists).
  if (rewriteFiles.includes('state/session.json')) {
    const pointerPayload = JSON.stringify(
      { schema_version: 2, active_session_id: null, updated_at: now() },
      null,
      2,
    ) + '\n';
    await atomicWriteFile(join(repoRoot, 'state', 'session.json'), pointerPayload);
  }

  return plan;
}

/* -------------------------------------------------------------------------- */
/*                                CLI shell                                   */
/* -------------------------------------------------------------------------- */

const HELP_TEXT = `Usage: node bin/make-template.js [--yes]

Bring this repository to pristine, clone-ready template state.

Without --yes this is a DRY RUN: it prints the plan (files/dirs it would
remove or rewrite) and changes nothing on disk. Pass --yes to apply.

What --yes does:
  * removes every tasks/TASK-*.json ticket and TASK-* sidecar
  * rewrites tasks/index.json to an empty store
  * resets state/session.json and empties state/sessions/
  * removes PROJECT.md and .claude/agents/project-context.md
Base agents, knowledge/, src/, bin/, and tests/ are left untouched.`;

function printPlan(plan) {
  const mode = plan.apply ? 'APPLIED' : 'DRY RUN (no changes made; pass --yes to apply)';
  // eslint-disable-next-line no-console
  console.log(`make-template: ${mode}`);
  const section = (label, items) => {
    if (items.length === 0) return;
    // eslint-disable-next-line no-console
    console.log(`\n${label}:`);
    for (const it of items) {
      // eslint-disable-next-line no-console
      console.log(`  - ${it}`);
    }
  };
  section('remove (files)', plan.removeFiles);
  section('remove (dirs)', plan.removeDirs);
  section('rewrite', plan.rewriteFiles);
}

function printError(err) {
  // eslint-disable-next-line no-console
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

// Only fire the runner when invoked as the entry script (not on import from
// tests). pathToFileURL normalizes the OS-specific argv[1] to a file:// URL
// comparable with import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      // eslint-disable-next-line no-console
      console.log(HELP_TEXT);
      process.exit(0);
    }
    makeTemplate({ repoRoot: process.cwd(), apply: parsed.apply })
      .then(printPlan)
      .catch(printError);
  } catch (err) {
    printError(err);
  }
}
