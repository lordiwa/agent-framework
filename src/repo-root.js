// src/repo-root.js
// TASK-022 — Plugin chain P2: resolve the USER's project root for project I/O.
//
// When the framework ships as a plugin, its own code lives in an immutable
// cache dir, but all project reads/writes must target the user's project root,
// never the plugin's location. The bin/ CLI shells are the only surfaces that
// bind a root (src/ functions all take an explicit `repoRoot`), so they call
// this helper instead of bare `process.cwd()`.
//
// Resolution policy: prefer `CLAUDE_PROJECT_DIR` when present and non-empty,
// otherwise fall back to the process cwd.
//
// EMPIRICAL FINDING (TASK-022 comment 2026-05-28T23:00): on this machine/
// version `CLAUDE_PROJECT_DIR` is UNSET in a Bash-tool subprocess, while the
// subprocess cwd DOES equal the project root. So the cwd branch is the
// load-bearing one in practice; the env branch is the robustness path for
// hook/MCP-style subprocesses that the docs guarantee receive the var.
//
// The function is pure and takes env + cwd as arguments (rather than reading
// process.env / process.cwd internally) so both branches are unit-testable
// without mutating real process state. The shells supply the live values.

/**
 * Resolve the project root.
 *
 * @param {Record<string, string|undefined>} env  Environment object (e.g. process.env).
 * @param {string} cwd  Current working directory fallback (e.g. process.cwd()).
 * @returns {string} `env.CLAUDE_PROJECT_DIR` when set and non-empty after trim,
 *                   otherwise `cwd`.
 */
export function resolveRepoRoot(env, cwd) {
  const fromEnv = env && env.CLAUDE_PROJECT_DIR;
  // Treat empty / whitespace-only as absent — '' is not a usable root and `??`
  // alone would wrongly accept it.
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return cwd;
}
