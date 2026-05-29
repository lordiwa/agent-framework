---
description: Bootstrap the Agentic Software Development Framework in the current project — gather intake answers conversationally and materialize PROJECT.md, the project-context agent briefing, a seeded backlog, and a session bundle.
---

# /agentic-framework:init-project

You are bootstrapping the Agentic Software Development Framework into the user's
project. This command runs through the **Bash tool**, which has **no interactive
TTY** — so you (Claude) must gather the intake answers in conversation, write
them to a JSON file, and run the framework's bundled, self-contained init entry
in NON-INTERACTIVE mode. Never try to drive the framework's readline wizard; it
cannot read stdin from a Bash-tool invocation.

## Step 1 — Gather the intake answers conversationally

Ask the user for each field below (one short batch of questions is fine). Map
their answers into a **flat JSON object** of `{questionId: value}` — the exact
shape the interactive wizard would otherwise collect.

Always required (these become PROJECT.md frontmatter + body):

- `project_name` — short, kebab-case preferred (e.g. `acme-billing`).
- `project_description` — one sentence describing the project.
- `project_type` — one of: `web-saas`, `cli-tool`, `library`, `other`.
- `target_users` — who the project is for.
- `primary_use_cases` — a comma-separated string OR a JSON array of slugs
  (e.g. `"automation, reporting"` or `["automation","reporting"]`). These drive
  the seeded backlog, so prefer the known slugs: `data-entry`, `reporting`,
  `integration`, `automation`, `collaboration`, `other`.
- `success_criteria` — how the user will know the project succeeded.

Type-specific keys (include the set matching the chosen `project_type`):

- `web-saas`: `frontend_framework`, `backend_framework`, `database`,
  `web_deployment_target`.
- `cli-tool`: `cli_language`, `distribution_channel`, `command_structure`.
- `library`: `library_language`, `audience`, `package_manager`.
- `other`: no extra keys required.

## Step 2 — Write the answers to a temp JSON file

Write the flat object to a temporary file, for example:

```json
{
  "project_name": "acme-billing",
  "project_description": "subscription billing for small SaaS teams",
  "project_type": "web-saas",
  "target_users": "finance teams at early-stage startups",
  "primary_use_cases": "automation, reporting",
  "success_criteria": "first paying customer can self-serve an invoice",
  "frontend_framework": "react",
  "backend_framework": "node-express",
  "database": "postgres",
  "web_deployment_target": "fly-io"
}
```

Save it somewhere outside the plugin cache (a system temp dir is ideal).

## Step 3 — Run the bundled init entry against the user's project

Run the SHIPPED, self-contained bundle (NOT the raw source) via the Bash tool,
passing the answers file with `--answers-file`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs --answers-file <path-to-the-tmp-json>
```

- `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's own installed code, so
  `dist/init.cjs` carries every dependency inlined (no `node_modules` to find).
- The bundle resolves the **target project directory** from
  `CLAUDE_PROJECT_DIR` (falling back to the current working directory), so all
  artifacts land in the **user's project**, never in the plugin cache.

## Step 4 — Confirm the artifacts and explain next steps

On success the bundle writes, in the user's project directory:

- `PROJECT.md` — the project's identity + stack, with machine-readable frontmatter.
- `.claude/agents/project-context.md` — the per-project agent briefing the
  subagents read before working.
- A seeded starter backlog under `tasks/` (TASK-NNN.json files derived from the
  primary use cases, all carrying the `seed` label).
- A session bundle under `state/sessions/<id>/` plus the `state/session.json`
  pointer.

Re-running is **idempotent**: if `PROJECT.md` already exists the bundle prints a
one-line summary and exits without re-prompting, without overwriting
`PROJECT.md`, and without duplicating the seeded backlog. Tell the user they can
now start a chat with the orchestrator and ask it to plan the first phase.
