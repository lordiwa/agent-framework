#!/usr/bin/env node
// bin/new-task.js
// CLI wrapper around createTask() for human-driven task scaffolding.
// Flags fully satisfy the non-interactive path; missing required fields fall
// through to the injected prompter. Prompter is injectable so tests run
// without a TTY — see tests/new-task-cli.spec.js for the contract.

import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createTask } from '../src/task-store.js';

const REPEATABLE = new Set(['--ac', '--label', '--depends']);
const SINGLE = new Set(['--title', '--description', '--priority']);

/**
 * Parse argv into { title, description, ac[], priority, labels[], dependsOn[] }.
 * Unknown flags throw with the flag name in the message so typos surface fast.
 */
function parseArgs(argv) {
  const out = {
    title: undefined,
    description: undefined,
    ac: [],
    priority: undefined,
    labels: [],
    dependsOn: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!SINGLE.has(flag) && !REPEATABLE.has(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    const value = argv[++i];
    if (value === undefined) {
      throw new Error(`flag ${flag} requires a value`);
    }
    switch (flag) {
      case '--title': out.title = value; break;
      case '--description': out.description = value; break;
      case '--priority': out.priority = value; break;
      case '--ac': out.ac.push(value); break;
      case '--label': out.labels.push(value); break;
      case '--depends': out.dependsOn.push(value); break;
    }
  }
  return out;
}

/**
 * Drive the CLI: parse flags, prompt for whatever is missing, then call
 * createTask(). Prompt order when nothing is supplied: title, description,
 * AC count, AC1..ACn, priority. Title re-prompts on empty input.
 */
export async function runCli({ argv, prompter, repoRoot, now }) {
  const parsed = parseArgs(argv);

  let title = parsed.title;
  while (!title || title.length === 0) {
    title = await prompter('Title: ');
  }

  let description = parsed.description;
  if (description === undefined) {
    description = await prompter('Description: ');
  }

  let acceptance_criteria = parsed.ac;
  if (acceptance_criteria.length === 0) {
    const countStr = await prompter('How many acceptance criteria? ');
    const count = Math.max(1, parseInt(countStr, 10) || 1);
    acceptance_criteria = [];
    for (let i = 0; i < count; i++) {
      const ac = await prompter(`Acceptance criterion ${i + 1}: `);
      acceptance_criteria.push(ac);
    }
  }

  let priority = parsed.priority;
  if (priority === undefined) {
    priority = await prompter('Priority (low|medium|high|critical): ');
  }

  return createTask({
    repoRoot,
    title,
    description,
    acceptance_criteria,
    priority,
    labels: parsed.labels,
    depends_on: parsed.dependsOn,
    now,
  });
}

/**
 * Real readline prompter — used only when the file is executed directly.
 * Returns a function (text) => Promise<string> that closes the interface on
 * each call so the process exits cleanly after the last prompt.
 */
function realReadlinePrompter() {
  const rl = createInterface({ input, output });
  return async (text) => {
    const answer = await rl.question(text);
    return answer;
  };
}

// Only fire the top-level runner when invoked as the entry script (not on
// import from tests). pathToFileURL normalizes the OS-specific argv[1] path
// to a file:// URL comparable with import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompter = realReadlinePrompter();
  runCli({
    argv: process.argv.slice(2),
    prompter,
    repoRoot: process.cwd(),
    now: () => new Date().toISOString(),
  })
    .then(({ key, path }) => {
      // eslint-disable-next-line no-console
      console.log(`${key} written to ${path}`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    });
}
