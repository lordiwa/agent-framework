# Session State

This directory is how the Orchestrator survives a chat restart. Without it, a new conversation starts cold — with it, the Orchestrator picks up exactly where the previous session paused.

## Layout

```
state/
├── README.md
├── session.json            ← the current active session (single source of truth on resume)
└── sessions/
    └── YYYY-MM-DDTHH-MM-SSZ.json   ← archived snapshots of prior sessions
```

## `session.json` contract

`session.json` is the **resume pointer**. It MUST be small (under ~5 KB) and self-contained: a new chat reading only this file plus `CLAUDE.md` and the referenced task JSON should be able to continue without re-asking the human.

Required fields are enforced by `state/session.schema.json`. The important ones:

- `active_task` — the task key currently in flight, or `null` when idle.
- `workflow_step` — which step of the Orchestrator workflow we're in (`fetch | research | test | impl | review | update | idle`).
- `next_action` — one sentence describing the **single next thing** to do on resume.
- `handoff_summary` — a short paragraph giving the new chat the context it needs.
- `open_questions` — anything blocked on human input.
- `blockers` — anything blocked on external systems.
- `subagent_results` — chronological log of subagent invocations and their summaries (NOT their raw output — keep this skinny).
- `decisions` — non-obvious choices the previous session made, so the new one doesn't relitigate them.

## Write protocol

The Orchestrator writes `session.json` at every meaningful transition:

1. After fetching a task.
2. After each subagent returns.
3. Before any human-confirmation pause.
4. On explicit "save state" requests from the human.

Writes are atomic: serialize to a temp file in the same directory, then rename over `session.json`.

## Archive protocol

When a task transitions to `done`, the Orchestrator copies the final `session.json` to `sessions/<updated_at>.json` and resets `session.json` to the idle template (active_task: null, workflow_step: idle).

## Resume protocol

The very first thing a new chat does, before any other tool call, is:

1. `Read state/session.json`.
2. If `active_task` is non-null, `Read tasks/<active_task>.json`.
3. Restate `handoff_summary` and `next_action` back to the human in one short paragraph and confirm before acting.
