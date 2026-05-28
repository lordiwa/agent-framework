# Agentic Software Development Framework

A multi-agent software development team that lives inside your repository. You
clone it, answer a short intake, and from then on you describe what you want
in plain language while specialized AI assistants research, write tests, ship
code, and review their own work.

This README is the five-minute onboarding for a non-technical operator. It
covers what you need installed, how to start a fresh project, what the wizard
produces, and what to say to Claude Code for your very first chat.

---

## What this is

Imagine hiring a small, disciplined engineering team. They follow a strict
workflow: read the ticket, plan, write failing tests first, implement until
the tests pass, review each other's work, and only then close the ticket.
This repository is the harness that makes Claude Code behave that way.

Two ideas drive the whole thing:

1. **A real ticket queue.** Every piece of work — a feature, a bug fix, a
   refactor — lives as a JSON ticket under `tasks/`. Nothing happens off the
   books.
2. **Specialized helpers.** The main chat (the orchestrator) does not write
   code itself. It dispatches the work to focused helpers — a researcher,
   a developer, a reviewer — and supervises their handoffs.

You drive all of this from a single Claude Code chat, in plain English.

---

## Prerequisites

You need three things on your machine:

- **Node.js 20 or newer.** Check with `node --version`. If you do not have it,
  grab the LTS installer from <https://nodejs.org>.
- **git.** Check with `git --version`. macOS and most Linux distros ship it;
  on Windows install Git for Windows from <https://git-scm.com>.
- **Claude Code.** The CLI that hosts the chat that drives this framework.
  Install instructions live at <https://docs.claude.com/claude-code>.

No global npm packages, no Docker, no databases. The framework is plain
JavaScript files plus a small JSON state directory.

---

## First-time setup

In a terminal, from the directory where you keep your projects:

```bash
git clone <this-repo-url> my-new-project
cd my-new-project
node bin/init.js
```

That last command starts the intake wizard. It asks you a handful of
questions — project name, what kind of project it is (web app, CLI tool, or
library), who it is for, the top use cases, and the stack you want to build
on. The wizard takes maybe two minutes.

If you cloned this repository directly (rather than from a fresh template),
`node bin/init.js` will first notice the framework's own historical tickets
sitting under `tasks/` and offer to move them out of the way so your project
starts with an empty backlog. Press Enter to accept; that is the default and
the right answer for a brand-new project.

If you ever want to re-run the intake from scratch, pass `--force`:

```bash
node bin/init.js --force
```

If you want to skip the history archive question entirely (useful when you
are working on the framework itself rather than building a new project on top
of it), pass `--no-archive`:

```bash
node bin/init.js --no-archive
```

---

## What the wizard produces

When the wizard finishes you will see three new things in the repository:

1. **`PROJECT.md`** at the repo root. A short, human-readable summary of the
   project — its name, type, primary use cases, target users, and stack. The
   orchestrator reads this on every chat to know what you are building.
2. **`.claude/agents/project-context.md`**. A briefing the helpers read so
   they share the same picture of the project. You do not need to read this
   yourself.
3. **A small starter backlog** under `tasks/`. The wizard mints a handful of
   day-one tickets — things like "set up project CI" and use-case-specific
   starters — so you have something concrete to point Claude Code at on your
   very first chat.

You will also see a `state/` directory. That is where the framework remembers
what it was doing between chats. Leave it alone; it heals itself.

---

## Your first chat with Claude Code

From the project directory, start Claude Code:

```bash
claude
```

For the first message, copy and paste this:

> Read `PROJECT.md` and the `tasks/` directory. Tell me which seeded ticket
> you would like to start with and why. Wait for my confirmation before
> opening it.

Claude will read the project briefing, scan the starter backlog, and propose
which ticket to pick up first. Confirm, push back, or steer it to a different
ticket — you are in charge. Once you confirm, the orchestrator takes over and
runs the workflow end to end: research, failing tests, implementation, review,
then ticket close.

For every subsequent chat the same pattern holds — open Claude Code in the
project directory and tell it what you want. It will pick up where the last
chat left off automatically.

---

## Day-two operations

A few things you will want to know as you go:

- **See open tickets**: open `tasks/` in your editor or ask the chat to list
  them.
- **File a new ticket from the terminal**: `node bin/new-task.js` walks you
  through it interactively, or pass everything as flags
  (`--title`, `--description`, `--ac`, `--priority`).
- **Pause a session**: tell the chat "let's pause for the day." The framework
  will write a handoff note so the next chat resumes cleanly.
- **Read the long-form rules**: `CLAUDE.md` at the repo root captures the
  team-wide operating principles. The orchestrator reads it at the start of
  every chat; you can too if you are curious.

---

## Getting help

If `node bin/init.js` fails or any chat goes off the rails, the most useful
thing you can do is tell Claude Code what you tried and paste the exact error
message. The orchestrator is trained to triage its own framework and will
usually point you at the underlying problem in one or two turns.

Welcome aboard.
