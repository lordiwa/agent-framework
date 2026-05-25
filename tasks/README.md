# Local Task Store

This directory is the **interim ticket source** for the agentic team. It exists so we can run the full Orchestrator → Researcher → Developer → Reviewer workflow locally before the Atlassian MCP server is wired up. Every task here is designed to be lifted into Jira later with a one-to-one field mapping.

## Layout

```
tasks/
├── README.md           ← this file
├── schema.json         ← JSON Schema for a single task (Jira-compatible field names)
├── index.json          ← lightweight index: key → status, for fast scans
└── TASK-001.json       ← one file per task
```

## Conventions

- **One JSON file per task**, named `<key>.json` (e.g., `TASK-001.json`). Easy diffs, easy migration.
- **Keys are sequential**, zero-padded to three digits, prefix `TASK-`. Bump the highest existing key when creating a new one.
- **Times are ISO-8601 UTC** (`2026-05-23T14:30:00Z`).
- **`index.json` is regenerable** — derive it from the per-task files; never let it drift.

## Lifecycle

```
todo → in_progress → in_review → done
                ↘ blocked ↗
```

The Orchestrator transitions status; the Developer and Reviewer append comments and link commits/PRs.

## Migrating to Jira

When the Atlassian MCP server is configured:

1. For each task with `jira_key: null`, create a Jira issue using the matching fields.
2. Write the returned Jira issue key back to the JSON file's `jira_key` field.
3. From then on, the Orchestrator treats Jira as the source of truth and these files become a local audit log.
