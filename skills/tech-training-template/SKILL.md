---
name: tech-training-template
description: Template for the Researcher to use when training the team on a new tech stack. Copy this folder to .claude/skills/<stack-name>/ and replace the placeholders. The frontmatter description must clearly state WHEN to load this skill so Claude can decide relevance via progressive disclosure.
---

# <Stack Name> — Team Training Skill

> **How to use this template.** Duplicate the `tech-training-template/` folder under a new name in `.claude/skills/`, then rewrite each section below. Keep `SKILL.md` itself under ~300 lines; push long reference material into `references/`.

## When to Use This Skill

One short paragraph. Be specific about file types, library imports, or task descriptions that should trigger this skill. Example: *"Use when editing `.vue` files, when `package.json` includes `vue`, or when the user mentions Pinia, Vue Router, or Vite-with-Vue."*

## Core Workflows

Numbered, opinionated recipes for the most common tasks in this stack. Each workflow should be runnable end-to-end without consulting external docs.

1. **<Task A>** — steps, with the exact commands and code shapes.
2. **<Task B>** — ...
3. **<Task C>** — ...

## Best Practices

A bulleted list of the team's preferred patterns and the anti-patterns to avoid. Pair each rule with a one-line rationale.

- **Do** <pattern> — *because* <reason>.
- **Don't** <anti-pattern> — *because* <reason>.

## Common Pitfalls

Things that look right but aren't, version-specific gotchas, platform quirks. Include the symptom the developer will see and the fix.

## Verification

How the Developer should confirm a change in this stack actually works: which test command, which linter, which type checker, which manual smoke test.

## References

Heavy material goes in the `references/` subdirectory and is **not** loaded by default — Claude will read these only when a workflow above points to them.

- [`references/api-cheatsheet.md`](references/api-cheatsheet.md) — full API surface, loaded on demand.
- [`references/migration-notes.md`](references/migration-notes.md) — version-to-version upgrade notes.
- [`references/official-docs-snapshot.md`](references/official-docs-snapshot.md) — pinned excerpts from the official docs, with source URLs and fetch date.

## Provenance

- **Authored by:** Researcher subagent on behalf of ticket `<TICKET-KEY>`.
- **Primary sources:** list URLs.
- **Last verified:** YYYY-MM-DD.
