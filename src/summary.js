// src/summary.js
// Generate summary.md for an ended session bundle per research §D.
//
// Sections:
//   - Dates (with active/paused durations from lifecycle.log)
//   - Active task
//   - Tasks touched
//   - Commits referenced (sourced from tasks/<KEY>.json#linked_commits)
//   - Lifecycle timeline
//   - Subagent invocations
//   - Decisions
//   - Open threads
//   - Unresolved blockers
//   - Pending human confirmation
//
// generateSummary is pure: it reads files and returns a string. The caller
// (lifecycle.endSession) does the atomic write.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build the summary.md content for a session bundle.
 *
 * @param {{ repoRoot: string, sessionId: string }} args
 * @returns {string} the summary.md content (with trailing newline)
 */
export function generateSummary({ repoRoot, sessionId }) {
  const bundleDir = join(repoRoot, 'state', 'sessions', sessionId);

  const session = safeReadJson(join(bundleDir, 'session.json')) || {};
  const lifecycle = readLifecycleLog(join(bundleDir, 'lifecycle.log'));
  const manifest = safeReadJson(join(bundleDir, 'manifest.json')) || {};

  const startedAt = manifest.created_at || (lifecycle[0]?.at) || '(unknown)';
  const endedAt = session.updated_at || (lifecycle[lifecycle.length - 1]?.at) || '(unknown)';
  const { activeMs, pausedMs } = computeDurations(lifecycle, endedAt);

  const tasksTouched = collectTasksTouched(lifecycle, session);
  const commitsReferenced = collectCommits(repoRoot, tasksTouched);

  const lines = [];
  lines.push(`# Session ${sessionId}`);
  lines.push('');

  // Dates
  lines.push('## Dates');
  lines.push(`- Started: ${startedAt}`);
  lines.push(`- Ended:   ${endedAt}`);
  lines.push(`- Active duration: ${formatDuration(activeMs)}`);
  lines.push(`- Paused duration: ${formatDuration(pausedMs)}`);
  lines.push('');

  // Active task
  lines.push('## Active task');
  if (session.active_task) {
    const title = readTaskTitle(repoRoot, session.active_task);
    lines.push(`- ${session.active_task}${title ? `: ${title}` : ''}`);
  } else {
    lines.push('- (none)');
  }
  lines.push(`- Final workflow_step: ${session.workflow_step || '(unknown)'}`);
  lines.push('');

  // Tasks touched
  lines.push('## Tasks touched');
  if (tasksTouched.size === 0) {
    lines.push('- (none)');
  } else {
    for (const key of [...tasksTouched].sort()) {
      const title = readTaskTitle(repoRoot, key);
      lines.push(`- ${key}${title ? `: ${title}` : ''}`);
    }
  }
  lines.push('');

  // Commits referenced
  lines.push('## Commits referenced');
  if (commitsReferenced.length === 0) {
    if (tasksTouched.size === 0) {
      lines.push('- (no tasks touched)');
    } else {
      for (const key of [...tasksTouched].sort()) {
        lines.push(`- ${key}: (no commits)`);
      }
    }
  } else {
    for (const { sha, taskKey } of commitsReferenced) {
      lines.push(`- ${sha} — ${taskKey}`);
    }
  }
  lines.push('');

  // Lifecycle timeline
  lines.push('## Lifecycle timeline');
  if (lifecycle.length === 0) {
    lines.push('| at | op | from → to | noop? |');
    lines.push('| --- | --- | --- | --- |');
    lines.push('| (empty) | | | |');
  } else {
    lines.push('| at | op | from → to | noop? |');
    lines.push('| --- | --- | --- | --- |');
    for (const ev of lifecycle) {
      const fromTo = `${ev.from_step ?? '(start)'} → ${ev.to_step ?? '?'}`;
      lines.push(`| ${ev.at} | ${ev.op} | ${fromTo} | ${ev.idempotent_noop ? 'yes' : 'no'} |`);
    }
  }
  lines.push('');

  // Subagent invocations
  lines.push('## Subagent invocations');
  const subs = Array.isArray(session.subagent_results) ? session.subagent_results : [];
  if (subs.length === 0) {
    lines.push('- (none)');
  } else {
    for (const s of subs) {
      lines.push(`- ${s.agent} @ ${s.at} — ${s.summary || ''}`);
    }
  }
  lines.push('');

  // Decisions
  lines.push('## Decisions');
  const decisions = Array.isArray(session.decisions) ? session.decisions : [];
  if (decisions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const d of decisions) {
      lines.push(`- ${d.at}: ${d.decision} — ${d.rationale}`);
    }
  }
  lines.push('');

  // Open threads
  lines.push('## Open threads');
  const openQs = Array.isArray(session.open_questions) ? session.open_questions : [];
  if (openQs.length === 0) {
    lines.push('- (none)');
  } else {
    for (const q of openQs) lines.push(`- ${q}`);
  }
  lines.push('');

  // Unresolved blockers
  lines.push('## Unresolved blockers');
  const blockers = Array.isArray(session.blockers) ? session.blockers : [];
  if (blockers.length === 0) {
    lines.push('- (none)');
  } else {
    for (const b of blockers) lines.push(`- ${b}`);
  }
  lines.push('');

  // Pending human confirmation
  lines.push('## Pending human confirmation');
  lines.push(`- ${session.pending_human_confirmation || 'none'}`);
  lines.push('');

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

function safeReadJson(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readLifecycleLog(p) {
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/**
 * Sum up active vs paused durations by walking the lifecycle log.
 * State machine: starts at "active" on first `start` event; transitions on
 * pause/resume/end. Final transition uses endedAt as the implicit boundary.
 */
function computeDurations(lifecycle, endedAt) {
  let state = null;
  let lastAt = null;
  let activeMs = 0;
  let pausedMs = 0;

  function addToBucket(toTimestamp) {
    if (!state || !lastAt) return;
    const delta = msBetween(lastAt, toTimestamp);
    if (delta < 0) return;
    if (state === 'active') activeMs += delta;
    else if (state === 'paused') pausedMs += delta;
  }

  for (const ev of lifecycle) {
    if (ev.idempotent_noop) continue;
    if (!ev.at) continue;

    if (ev.op === 'start' || ev.op === 'migrate_v1') {
      state = 'active';
      lastAt = ev.at;
    } else if (ev.op === 'pause') {
      addToBucket(ev.at);
      state = 'paused';
      lastAt = ev.at;
    } else if (ev.op === 'resume') {
      addToBucket(ev.at);
      state = 'active';
      lastAt = ev.at;
    } else if (ev.op === 'end') {
      addToBucket(ev.at);
      state = 'ended';
      lastAt = ev.at;
    }
  }

  if (state === 'active' || state === 'paused') {
    addToBucket(endedAt);
  }

  return { activeMs, pausedMs };
}

function msBetween(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return tb - ta;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function pad2(n) {
  return n.toString().padStart(2, '0');
}

function collectTasksTouched(lifecycle, session) {
  const out = new Set();
  if (session && session.active_task) out.add(session.active_task);
  for (const ev of lifecycle) {
    if (ev && typeof ev.active_task === 'string') out.add(ev.active_task);
  }
  if (Array.isArray(session?.subagent_results)) {
    for (const s of session.subagent_results) {
      if (Array.isArray(s.artifacts)) {
        for (const a of s.artifacts) {
          const m = /\b(TASK-\d{3,})\b/.exec(String(a));
          if (m) out.add(m[1]);
        }
      }
    }
  }
  return out;
}

function collectCommits(repoRoot, tasksTouched) {
  const out = [];
  for (const key of [...tasksTouched].sort()) {
    const task = safeReadJson(join(repoRoot, 'tasks', `${key}.json`));
    if (!task) continue;
    const commits = Array.isArray(task.linked_commits) ? task.linked_commits : [];
    for (const sha of commits) {
      out.push({ sha, taskKey: key });
    }
  }
  return out;
}

function readTaskTitle(repoRoot, key) {
  const task = safeReadJson(join(repoRoot, 'tasks', `${key}.json`));
  return task?.title || null;
}
