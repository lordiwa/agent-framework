// src/backlog-seeder.js
// TASK-014 — generate a small starter backlog from intake answers.
//
// Called by bin/init.js after generateProjectContext succeeds in the
// created / forced / resumed branches (NOT already_initialized). Reads
// `answers.primary_use_cases` (string or array) and mints:
//   - every template in COMMON_TEMPLATES (independent of use cases), and
//   - every template in USE_CASE_TEMPLATES[uc] for each selected use case.
//
// Idempotency: if any existing ticket already carries the literal `seed`
// label, seedBacklog returns {created: []} without writing. This is one-shot
// per project: re-seeding after the user has started work would either
// duplicate identical-title tickets or clobber in-progress status. `--force`
// re-runs of bin/init.js therefore do NOT re-seed.
//
// Every minted ticket:
//   - labels: ['seed', ...template.labels ?? []]
//   - opening comment from author 'backlog-seeder' whose body names either
//     the triggering use case (substring match) or the literal string 'common'.
//
// Hard constraint: the comment body for COMMON_TEMPLATES tickets must NOT
// incidentally contain a use-case slug (the test partitions tickets by
// substring match — overlap would mis-attribute commons to a use case).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTask, appendComment } from './task-store.js';

/**
 * Module-top template catalogs. Frozen at the leaf level so a stray mutation
 * in user code surfaces immediately rather than corrupting later seed runs.
 */

export const COMMON_TEMPLATES = Object.freeze([
  Object.freeze({
    title: 'Set up project CI',
    description:
      'Wire up a basic continuous-integration pipeline that runs the test ' +
      'suite and the linter on every push and pull request. This is the ' +
      'first piece of automation every fresh project needs.',
    acceptance_criteria: Object.freeze([
      'CI pipeline runs the full test suite on every push to the default branch.',
      'CI pipeline runs the linter and fails the build on any lint error.',
      'CI status is visible from the repository host (badge or required check).',
    ]),
    priority: 'high',
    labels: Object.freeze(['ci']),
  }),
]);

export const USE_CASE_TEMPLATES = Object.freeze({
  'data-entry': Object.freeze([
    Object.freeze({
      title: 'Define data input schema',
      description:
        'Document the structure and constraints of every input form / API ' +
        'payload the application accepts. Drives validation layer design.',
      acceptance_criteria: Object.freeze([
        'Each input surface has a named schema (e.g. JSON Schema or equivalent).',
        'Required vs optional fields are explicit for every field.',
      ]),
      priority: 'high',
      labels: Object.freeze(['schema']),
    }),
    Object.freeze({
      title: 'Add input validation layer',
      description:
        'Implement a centralized validation step so every user-supplied ' +
        'payload is rejected with a clear error before reaching business logic.',
      acceptance_criteria: Object.freeze([
        'Invalid payloads return a structured 4xx error naming the failed field.',
        'Validation runs before any database write.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['validation']),
    }),
  ]),
  'reporting': Object.freeze([
    Object.freeze({
      title: 'Define report data sources',
      description:
        'Inventory the tables, APIs, and event streams that feed reports. ' +
        'Without this catalog, report endpoints accumulate ad-hoc joins.',
      acceptance_criteria: Object.freeze([
        'Each report has a documented data source list.',
        'Source freshness expectations (real-time vs daily) are recorded.',
      ]),
      priority: 'high',
      labels: Object.freeze(['data-model']),
    }),
    Object.freeze({
      title: 'Build first report endpoint',
      description:
        'Ship one end-to-end report so the rest of the reporting stack has ' +
        'a working reference implementation to follow.',
      acceptance_criteria: Object.freeze([
        'Endpoint returns a documented JSON or CSV payload.',
        'Endpoint is covered by at least one integration test.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['endpoint']),
    }),
  ]),
  'integration': Object.freeze([
    Object.freeze({
      title: 'Document upstream APIs',
      description:
        'For every external system this project talks to, capture base URL, ' +
        'auth, rate limits, and failure modes in one place.',
      acceptance_criteria: Object.freeze([
        'Each upstream has a documented base URL and auth scheme.',
        'Known rate limits and retry policies are recorded.',
      ]),
      priority: 'high',
      labels: Object.freeze(['docs']),
    }),
    Object.freeze({
      title: 'Add integration test harness',
      description:
        'Set up a harness that exercises real (or recorded) upstream calls ' +
        'so contract drift surfaces in CI rather than in production.',
      acceptance_criteria: Object.freeze([
        'At least one integration test exists and runs in CI.',
        'Harness supports either live calls or recorded fixtures behind a flag.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['testing']),
    }),
  ]),
  'automation': Object.freeze([
    Object.freeze({
      title: 'Identify trigger source',
      description:
        'Pin down what fires the automation: cron, webhook, queue message, ' +
        'or manual. Trigger choice constrains the whole runtime shape.',
      acceptance_criteria: Object.freeze([
        'Trigger mechanism is documented (cron expression, event topic, etc.).',
        'Expected invocation frequency is recorded.',
      ]),
      priority: 'high',
      labels: Object.freeze(['design']),
    }),
    Object.freeze({
      title: 'Add idempotency guard',
      description:
        'Automations re-run. Add the de-duplication mechanism (job id, ' +
        'natural key, etc.) so duplicate firings are no-ops.',
      acceptance_criteria: Object.freeze([
        'Re-running the automation with the same input produces no side effects.',
        'Idempotency key strategy is documented.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['reliability']),
    }),
  ]),
  'collaboration': Object.freeze([
    Object.freeze({
      title: 'Define user roles and permissions',
      description:
        'Enumerate the roles (admin, editor, viewer, etc.) and the actions ' +
        'each one may take. Drives the authorization layer.',
      acceptance_criteria: Object.freeze([
        'Role list is documented with at least one capability per role.',
        'A permission matrix maps roles to allowed actions.',
      ]),
      priority: 'high',
      labels: Object.freeze(['authz']),
    }),
    Object.freeze({
      title: 'Add audit log',
      description:
        'Persist a tamper-resistant log of who did what when. Required for ' +
        'any multi-user product handling non-trivial data.',
      acceptance_criteria: Object.freeze([
        'Every state-changing action writes an audit entry with actor + timestamp.',
        'Audit log is queryable by actor and by target resource.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['audit']),
    }),
  ]),
  'other': Object.freeze([
    Object.freeze({
      title: 'Define initial milestone',
      description:
        'The project type is open-ended. Pick the first measurable milestone ' +
        'and write down what shipping it means.',
      acceptance_criteria: Object.freeze([
        'Milestone has a one-sentence definition of done.',
        'Milestone has at least one verifiable success criterion.',
      ]),
      priority: 'high',
      labels: Object.freeze(['planning']),
    }),
  ]),
});

/**
 * Local mirror of src/task-store.js#readAllTasks (synchronous variant).
 * Duplicated intentionally — the orchestrator forbade widening task-store's
 * public API just for this one read. Skips schema.json / index.json / any
 * non-TASK file.
 */
function readAllTasksSync(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter(
    (n) =>
      n.endsWith('.json') &&
      n !== 'index.json' &&
      n !== 'schema.json',
  );
  const out = [];
  for (const name of names) {
    try {
      const raw = readFileSync(join(dir, name), 'utf8');
      out.push(JSON.parse(raw));
    } catch {
      // Malformed task file — skip rather than crash the seeder. A separate
      // ticket (TASK-015 polish) can surface these as warnings.
    }
  }
  return out;
}

/**
 * Normalize answers.primary_use_cases to an array of strings. Accepts:
 *   - undefined / null / ''     -> []
 *   - 'data-entry'              -> ['data-entry']
 *   - ['data-entry','reporting']-> ['data-entry', 'reporting']
 *
 * Anything else (number, object, etc.) -> [] (defensive — empty case
 * still yields the common starter, so the user is never left empty-handed).
 */
function normalizeUseCases(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && v.length > 0);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return [raw];
  }
  return [];
}

/**
 * Mint a single seeded ticket from a template + a triggering tag ('common' or
 * a use-case slug). Returns the new ticket key.
 *
 * The opening comment body MUST contain the literal `tag` substring (the
 * test's commentNamesUseCase helper does String.includes(tag) to partition
 * minted tickets by trigger). Phrasing is deliberately anodyne for the
 * 'common' case so no incidental use-case slug appears in the body.
 */
async function mintTicket({ repoRoot, template, tag, now }) {
  const labels = Array.from(
    new Set(['seed', ...(Array.isArray(template.labels) ? template.labels : [])]),
  );
  const { key } = await createTask({
    repoRoot,
    title: template.title,
    description: template.description,
    acceptance_criteria: [...template.acceptance_criteria],
    priority: template.priority,
    labels,
    now,
  });
  // Body is lowercase-prefixed so the test's case-sensitive String.includes
  // matcher (substring contract) lights up. Common bodies must NOT contain
  // any use-case slug — keep the phrasing anodyne.
  const body =
    tag === 'common'
      ? 'common starter ticket — applies to every fresh project'
      : `Triggered by primary_use_case: ${tag}`;
  await appendComment({
    repoRoot,
    key,
    author: 'backlog-seeder',
    body,
    now,
  });
  return key;
}

/**
 * Public entrypoint. See file header for full contract.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} opts.answers
 * @param {() => string} [opts.now]
 * @returns {Promise<{created: string[]}>}
 */
export async function seedBacklog({
  repoRoot,
  answers,
  now = () => new Date().toISOString(),
}) {
  // ---- Step 1: idempotency guard ----
  const existing = readAllTasksSync(repoRoot);
  for (const t of existing) {
    if (Array.isArray(t.labels) && t.labels.includes('seed')) {
      return { created: [] };
    }
  }

  // ---- Step 2: normalize ----
  const useCases = normalizeUseCases(answers && answers.primary_use_cases);

  // tasks/ is self-bootstrapped by createTask (TASK-009 AC7) — no mkdir here.

  const created = [];

  // ---- Step 3: common starter(s) ----
  for (const tpl of COMMON_TEMPLATES) {
    const key = await mintTicket({ repoRoot, template: tpl, tag: 'common', now });
    created.push(key);
  }

  // ---- Step 4: per-use-case ----
  for (const uc of useCases) {
    const templates = USE_CASE_TEMPLATES[uc];
    if (!templates) continue; // Unknown use case slug — silently ignore.
    for (const tpl of templates) {
      const key = await mintTicket({ repoRoot, template: tpl, tag: uc, now });
      created.push(key);
    }
  }

  return { created };
}
