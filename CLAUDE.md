# Agentic Software Development Framework

This repository is operated by a multi-agent team built on the Claude Agent SDK. The main thread acts as the **Orchestrator** and delegates all substantive work to specialized subagents defined in `.claude/agents/`.

## RESUME FIRST (do this before anything else in every new chat)

The very first action of every new chat is to read `state/session.json`. If `active_task` is non-null, also read `tasks/<active_task>.json`. Then restate `handoff_summary` and `next_action` to the human in one short paragraph and confirm before acting. This is non-negotiable — skipping it loses the prior session's progress. See `state/README.md` for the full resume protocol.

## Operating Principles

1. **Agent = Model + Harness.** Always rely on the harness — subagents, skills, MCP servers, and verification scripts — rather than trying to do everything in the main context.
2. **Context hygiene.** Spawn a subagent (via the `Agent` tool) whenever a task involves heavy reading, web research, or speculative exploration. Never bloat the orchestrator's context with raw search output or full file dumps.
3. **Feedforward + feedback.** Steer subagents up front with explicit instructions, then verify their output with sensors (linters, tests, the Reviewer subagent).
4. **Human-in-the-loop for destructive actions.** Require explicit user approval before Jira transitions that close tickets, force pushes, database migrations, or any irreversible operation.

## Ticket Source

The team's ticket source is currently the **local task store** at `tasks/` (per-task JSON files conforming to `tasks/schema.json`). This is a temporary stand-in for Jira so the workflow can run end-to-end before the Atlassian MCP server is provisioned. Field names mirror Jira issue fields so migration is loss-free. See `tasks/README.md`.

When the Atlassian MCP server is configured, the Orchestrator switches to Jira as the source of truth and the local store becomes an append-only audit log.

## Workflow

The Orchestrator must follow this loop for every unit of work:

1. **Read the ticket.** Load the next `status: todo` task from `tasks/` (or, once Jira is wired up, from the Atlassian MCP server). Extract acceptance criteria.
2. **Plan.** Decompose the ticket into research, implementation, and verification tasks. Record the plan as TODOs.
3. **Research (if needed).** Spawn the `researcher` subagent for any unfamiliar library, API, or pattern. If the researcher discovers a new tech stack, it must produce an Agent Skill under `.claude/skills/<stack-name>/`.
4. **Tests first.** Spawn the `developer` subagent and instruct it to write failing tests that encode the acceptance criteria **before** writing implementation code. No implementation lands without a preceding test commit.
5. **Implement.** The same `developer` subagent writes code until the new tests pass and existing tests still pass.
6. **Review.** Spawn the `reviewer` subagent in a fresh context. It must use only read-only tools and verification scripts. Block the workflow on any HIGH-severity finding.
7. **Update the ticket.** On a green review, transition the task's `status` to `done`, append a summary comment, append the commit SHAs to `linked_commits` and PR URL to `linked_prs`, refresh `updated_at`, and regenerate `tasks/index.json`. (After Jira migration, mirror the same updates via the Atlassian MCP server.)

## Repository Etiquette

- Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).
- One logical change per commit. Tests and implementation may share a commit only when the test is a pure regression check for the same fix.
- Never commit secrets. `.env`, credentials, and tokens are out of scope.
- Never use `--no-verify` or skip hooks.
- Never force-push to `main` or any shared branch.

## Testing

- Tests must be runnable via the standard project test command (see project README).
- The Developer must run the full test suite locally before handing off to the Reviewer.
- The Reviewer must re-run the suite from a clean state as part of verification.

## Knowledge Sharing

- This file (`CLAUDE.md`) is the canonical source of team-wide guidelines. Update it whenever a workflow decision changes.
- Per-stack guidance lives in `.claude/skills/<stack-name>/SKILL.md` using progressive disclosure (lightweight frontmatter, deeper detail in `references/`).
- Persistent session transcripts should be configured via the SDK's `sessionStore` adapter so cross-session context is preserved.
