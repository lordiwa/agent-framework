# MCP tool contract + task-store.js signatures (TASK-026)

Authoritative tool surface is `tasks/TASK-020.research.md` §E.1, reproduced here
with the verified `src/task-store.js` export names and call signatures.

## The six tools (§E.1, quoted)

| MCP tool | Args | Returns | Wraps |
|----------|------|---------|-------|
| `list_todos` | `{}` | `Task[]` (status==todo, numeric-key order) | `listTodos({repoRoot})` |
| `list_ready` | `{}` | `Task[]` (todo with all deps done) | `listReady({repoRoot})` |
| `get_task` | `{ key: string }` | `Task \| null` | read `tasks/<key>.json` |
| `create_task` | `{ title, description, acceptance_criteria: string[], priority, labels?: string[], depends_on?: string[] }` | `{ key, path }` | `createTask({repoRoot, …})` |
| `transition_status` | `{ key: string, status: "todo"\|"in_progress"\|"in_review"\|"blocked"\|"done" }` | `{ ok: true }` | `transitionStatus({repoRoot, key, status})` |
| `append_comment` | `{ key: string, author: string, body: string }` | `{ ok: true }` | `appendComment({repoRoot, key, author, body})` |

These map 1:1 onto the Jira-compatible field names in `tasks/schema.json`, so the
surface survives the eventual Atlassian-MCP migration (backend swaps from local
JSON to Jira; the tool names stay).

## Verified `src/task-store.js` exports (single object-arg, all async)

- `listTodos({ repoRoot })` → `Promise<Task[]>` (status==='todo', numeric-key
  order). Side effects: sweeps orphan tmp files + repairs `index.json`.
- `listReady({ repoRoot })` → `Promise<Task[]>` (todo whose every `depends_on`
  points at an on-disk `done` task; unknown dep ⇒ excluded).
- `createTask({ repoRoot, title, description, acceptance_criteria, priority,
  labels = [], depends_on = [], now? })` → `Promise<{ key, path }>`.
  - Throws if `acceptance_criteria` is empty/not-array, if `priority` not in
    `low|medium|high|critical`, or on schema-validation failure (message
    contains `task payload failed schema validation`).
- `transitionStatus({ repoRoot, key, status, now? })` → `Promise<void>`.
  - Throws `invalid status "<s>" — must be one of ...` for a bad status.
  - Throws `unknown task key: <key>` if no such task.
  - Returns nothing → the `transition_status` wrapper synthesizes `{ ok: true }`.
- `appendComment({ repoRoot, key, author, body, now? })` → `Promise<void>`.
  - Throws `unknown task key: <key>` if absent. Wrapper synthesizes `{ ok: true }`.

### `get_task` has NO task-store function — implement it inline

There is no `getTask`/`readTask` export. Implement the `get_task` tool by reading
the file directly under `repoRoot`:

```js
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readTask(repoRoot, key) {
  try {
    const raw = await readFile(join(repoRoot, 'tasks', `${key}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null; // §E.1: Task | null
    throw err;
  }
}
```

Validate `key` against the schema's key shape (`/^TASK-\d{3,}$/`) before the read
to avoid path-injection via a crafted `key` (e.g. `../../etc/passwd`). Reject
anything that does not match.

## Result shaping (every tool)

Wrap the returned value in the MCP content envelope and stringify:

```js
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
```

- `list_todos` / `list_ready` → `ok(await listTodos({ repoRoot }))`
- `get_task` → `ok(await readTask(repoRoot, key))` (may be `null`)
- `create_task` → `ok(await createTask({ repoRoot, ... }))` → `{ key, path }`
- `transition_status` → `await transitionStatus(...); return ok({ ok: true });`
- `append_comment` → `await appendComment(...); return ok({ ok: true });`

Errors: let the wrapped function throw; the SDK converts a thrown error to
`{ isError: true, content: [{ type:'text', text: <message> }] }`. That is the
desired behavior for unknown-key / invalid-status / validation failures — no
manual try/catch needed unless you want to reshape the message.

## zod inputSchema shapes (raw shape objects, not z.object)

```js
const PRIORITY = z.enum(['low', 'medium', 'high', 'critical']);
const STATUS = z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done']);

// list_todos / list_ready
inputSchema: {}

// get_task
inputSchema: { key: z.string().regex(/^TASK-\d{3,}$/) }

// create_task
inputSchema: {
  title: z.string(),
  description: z.string(),
  acceptance_criteria: z.array(z.string()).min(1),
  priority: PRIORITY,
  labels: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
}

// transition_status
inputSchema: { key: z.string(), status: STATUS }

// append_comment
inputSchema: { key: z.string(), author: z.string(), body: z.string() }
```

## WILL / WON'T docstring (AC4) — put this at the top of src/mcp-server.js

A non-Claude-Code MCP client (claude.ai, Claude Desktop, any MCP host) **WILL**
get the six task-store tools: read the backlog, read/create tickets, transition
status, append comments — full CRUD on the ticket store. It **WON'T** get the
orchestrator → developer/reviewer/researcher subagent loop, the RESUME-FIRST
session-state orchestration, or the TDD-enforced dev loop — those are Claude
Code-exclusive file-based constructs that MCP cannot install or drive. In one
line: the MCP seam turns the framework's *ticket store* into a cross-client API,
but the *orchestration* stays Claude Code-only.
