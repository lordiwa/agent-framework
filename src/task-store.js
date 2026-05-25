// src/task-store.js
// Local task store adapter (TASK-001). Per-task JSON files under tasks/<key>.json
// are the source of truth; tasks/index.json is a regenerable summary written
// after every mutation. All writes flow through src/atomic-write.js so a crash
// mid-write leaves the on-disk file intact.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteFiles } from './atomic-write.js';

// Mirror of tasks/schema.json#/properties/status/enum. Hard-coded to avoid file
// I/O on every call; keep in sync with tasks/schema.json (the source of truth).
const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

// TASK-NNN.json — at least 3 digits, matches the schema's key pattern.
const TASK_FILENAME_RE = /^TASK-(\d{3,})\.json$/;

function tasksDir(repoRoot) {
  return join(repoRoot, 'tasks');
}

function taskFilePath(repoRoot, key) {
  return join(tasksDir(repoRoot), `${key}.json`);
}

function indexFilePath(repoRoot) {
  return join(tasksDir(repoRoot), 'index.json');
}

/**
 * Read every per-task file under tasks/, skipping schema.json and index.json.
 * Returns objects in undefined order — callers sort as needed.
 */
async function readAllTasks(repoRoot) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const taskFiles = entries.filter(
    (name) =>
      name.endsWith('.json') &&
      name !== 'index.json' &&
      name !== 'schema.json',
  );
  const out = [];
  for (const name of taskFiles) {
    const raw = await readFile(join(dir, name), 'utf8');
    out.push(JSON.parse(raw));
  }
  return out;
}

/**
 * Build the tasks/index.json payload from a list of task objects.
 * Shape: { generated_at, tasks: [{key, title, status, priority}] } sorted by key.
 * Returned as a string ready for atomic write.
 */
function buildIndexBytes(tasks, generatedAt) {
  const summary = tasks
    .map((t) => ({
      key: t.key,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify({ generated_at: generatedAt, tasks: summary }, null, 2) + '\n';
}

/**
 * AC1 — return all tasks with status=='todo', sorted by key ascending.
 * Sourced from the per-task files; index.json is intentionally ignored so a
 * stale or missing index never poisons planning.
 */
export async function listTodos({ repoRoot }) {
  const tasks = await readAllTasks(repoRoot);
  return tasks
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * AC2 — set a task's status, bump updated_at, regenerate the index.
 * Validates the status enum before touching disk; throws on unknown key with
 * the key string in the message.
 */
export async function transitionStatus({
  repoRoot,
  key,
  status,
  now = () => new Date().toISOString(),
}) {
  if (!STATUSES.includes(status)) {
    throw new Error(
      `invalid status "${status}" — must be one of ${STATUSES.join(', ')}`,
    );
  }
  const allTasks = await readAllTasks(repoRoot);
  const task = allTasks.find((t) => t.key === key);
  if (!task) throw new Error(`unknown task key: ${key}`);

  const stamp = now();
  task.status = status;
  task.updated_at = stamp;

  await atomicWriteFiles([
    { target: taskFilePath(repoRoot, key), bytes: JSON.stringify(task, null, 2) + '\n' },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);
}

/**
 * AC3 — append a {author, at, body} comment to a task, bump updated_at,
 * regenerate the index. Existing comments are preserved verbatim and in order;
 * the new comment is pushed at the end.
 */
export async function appendComment({
  repoRoot,
  key,
  author,
  body,
  now = () => new Date().toISOString(),
}) {
  const allTasks = await readAllTasks(repoRoot);
  const task = allTasks.find((t) => t.key === key);
  if (!task) throw new Error(`unknown task key: ${key}`);

  const stamp = now();
  const comment = { author, at: stamp, body };
  task.comments = Array.isArray(task.comments) ? [...task.comments, comment] : [comment];
  task.updated_at = stamp;

  await atomicWriteFiles([
    { target: taskFilePath(repoRoot, key), bytes: JSON.stringify(task, null, 2) + '\n' },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);
}

/**
 * Derive the next task key by scanning tasks/ for TASK-NNN.json filenames,
 * finding the max numeric suffix, and incrementing by 1. Non-matching files
 * (schema.json, index.json, README.md, .tmp files, etc.) are ignored entirely.
 * Padding width is max(3, digits(next)) so 999 -> "TASK-1000".
 */
async function deriveNextKey(repoRoot) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') entries = [];
    else throw err;
  }
  let maxN = 0;
  for (const name of entries) {
    const m = TASK_FILENAME_RE.exec(name);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  const next = maxN + 1;
  const width = Math.max(3, String(next).length);
  return `TASK-${String(next).padStart(width, '0')}`;
}

/**
 * Create a new task: derive next key, validate inputs, write the task file
 * and regenerate index.json — both writes flow through a single
 * atomicWriteFiles() call so the two-phase invariant holds (all fsyncs before
 * any rename). Validation happens BEFORE any disk write so a bad call leaves
 * the store untouched.
 */
export async function createTask({
  repoRoot,
  title,
  description,
  acceptance_criteria,
  priority,
  labels = [],
  depends_on = [],
  now = () => new Date().toISOString(),
}) {
  // Validate enums + required-array shape before touching disk.
  if (!Array.isArray(acceptance_criteria) || acceptance_criteria.length === 0) {
    throw new Error(
      'acceptance_criteria must be a non-empty array (schema minItems: 1)',
    );
  }
  if (!PRIORITIES.includes(priority)) {
    throw new Error(
      `invalid priority "${priority}" — must be one of ${PRIORITIES.join(', ')}`,
    );
  }

  const key = await deriveNextKey(repoRoot);
  const stamp = now(); // Single call so created_at === updated_at byte-for-byte.

  const task = {
    key,
    title,
    description,
    acceptance_criteria,
    status: 'todo',
    priority,
    labels,
    assignee: null,
    depends_on,
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: stamp,
    updated_at: stamp,
    jira_key: null,
  };

  // Read existing tasks AFTER validation so we don't pay the I/O on bad input.
  const existing = await readAllTasks(repoRoot);
  const allTasks = [...existing, task];

  const target = taskFilePath(repoRoot, key);
  await atomicWriteFiles([
    { target, bytes: JSON.stringify(task, null, 2) + '\n' },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) },
  ]);

  return { key, path: target };
}
