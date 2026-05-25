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
