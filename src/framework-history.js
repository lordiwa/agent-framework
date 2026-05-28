// src/framework-history.js
// TASK-015 — archiveFrameworkHistory({repoRoot, now}) moves the framework's
// own pre-existing TASK-NNN.json tickets out of <repoRoot>/tasks/ and into
// <repoRoot>/.framework-history/tasks/ so a freshly cloned project starts with
// an empty task store. The wizard (bin/init.js) owns the interactive Y/n
// prompt; this module is the disk-side primitive.
//
// Contract:
//   - Returns {archived: <string[]>} listing the moved ticket keys.
//   - Returns {archived: []} (no filesystem mutation) when:
//       * <repoRoot>/tasks/ does not exist, OR
//       * tasks/ exists but contains no TASK-NNN.json files, OR
//       * ANY existing TASK-NNN.json carries the literal `seed` label
//         (meaning this project has already been seeded — moving its tickets
//         to .framework-history/ would destroy real work).
//   - Otherwise mkdir -p .framework-history/tasks/, renameSync each
//     TASK-NNN.json file there, then atomically regenerate tasks/index.json
//     to an empty `{generated_at, tasks: []}` store.
//   - Non-TASK files in tasks/ (schema.json, README.md, ...) are left in place.

import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from './atomic-write.js';

const TASK_FILE_RE = /^TASK-\d{3,}\.json$/;

/**
 * Archive the framework's pre-existing history tickets out of <repoRoot>/tasks/.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute path to the project root
 * @param {() => string} [opts.now] - injected clock for index.json's generated_at
 * @returns {Promise<{archived: string[]}>}
 */
export async function archiveFrameworkHistory({
  repoRoot,
  now = () => new Date().toISOString(),
}) {
  const tasksDir = join(repoRoot, 'tasks');
  if (!existsSync(tasksDir)) {
    return { archived: [] };
  }

  const taskFiles = readdirSync(tasksDir)
    .filter((n) => TASK_FILE_RE.test(n))
    .sort();

  if (taskFiles.length === 0) {
    return { archived: [] };
  }

  // Parse each ticket to inspect its labels. If ANY ticket carries `seed`,
  // short-circuit — this project is past the framework-history phase.
  const parsed = [];
  for (const name of taskFiles) {
    const fullPath = join(tasksDir, name);
    let ticket;
    try {
      ticket = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch {
      // Corrupt ticket file — treat as framework history and let the move
      // happen; we don't want corrupt bytes to look like a "seed" guard.
      ticket = { labels: [] };
    }
    if (Array.isArray(ticket.labels) && ticket.labels.includes('seed')) {
      return { archived: [] };
    }
    parsed.push({ name, fullPath, ticket });
  }

  // Commit: mkdir -p destination, move each file, regenerate index.json.
  const archiveDir = join(repoRoot, '.framework-history', 'tasks');
  mkdirSync(archiveDir, { recursive: true });

  const archived = [];
  for (const { name, fullPath, ticket } of parsed) {
    const dest = join(archiveDir, name);
    renameSync(fullPath, dest);
    // Prefer the ticket's `key` field when present; fall back to the filename
    // stem so a malformed ticket still surfaces in the returned list.
    const key = typeof ticket.key === 'string' && ticket.key.length > 0
      ? ticket.key
      : name.replace(/\.json$/, '');
    archived.push(key);
  }

  archived.sort();

  // Regenerate tasks/index.json as an empty store. atomicWriteFile uses the
  // same tmp+rename recipe the rest of the framework uses.
  const indexPath = join(tasksDir, 'index.json');
  const payload = JSON.stringify(
    { generated_at: now(), tasks: [] },
    null,
    2,
  ) + '\n';
  await atomicWriteFile(indexPath, payload);

  return { archived };
}
