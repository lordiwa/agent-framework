// tests/plugin-deps.spec.js
// TASK-023 — Plugin chain P3: runtime dependency packaging.
//
// Authoritative design: tasks/TASK-020.research.md §B.4 and the TASK-023
// "APPROACH LOCKED" comment (2026-05-29T01:10). The locked mechanism: ship the
// runtime deps (ajv / ajv-formats / gray-matter) via the documented
// ${CLAUDE_PLUGIN_DATA} first-run-install pattern, driven by a SessionStart
// hook. ONE hook does two jobs: (a) diff the bundled package.json against a
// stored copy in ${CLAUDE_PLUGIN_DATA} and `npm install` there on first run /
// change; (b) write env exports (NODE_PATH + the folded-in CLAUDE_PROJECT_DIR)
// to $CLAUDE_ENV_FILE for all subsequent Bash-tool / MCP / bin subprocesses.
//
// TESTS-FIRST: none of the impl exists yet. package.json still lists the three
// deps under devDependencies; hooks/hooks.json and hooks/setup-deps.mjs do not
// exist. So each spec below MUST fail for the RIGHT reason (deps in the wrong
// section / file absent / module-not-found), never on a typo in this file.
//
// We do NOT run a real `npm install` (slow / networked / flaky). The hook's
// install DECISION and its env-line OUTPUT are tested as pure functions; the
// resolution proof (AC3) uses a controlled `node` spawn against an isolated
// copy of the importing module with NO node_modules up-tree, so the ONLY way
// the deps can resolve is the mechanism under test.
//
// ── CRITICAL IMPL FINDING surfaced by AC3 below (see the long comment there) ──
// ESM `import` of bare specifiers DOES NOT honor NODE_PATH (NODE_PATH is a
// CommonJS-only resolution hint). src/task-store.js and src/knowledge.js use
// ESM `import Ajv from 'ajv/...'`, so a bare `NODE_PATH=<dataDir>/node_modules`
// export — the literal wording of the locked approach — will NOT make those
// imports resolve. The mechanism that DOES work for ESM is a `node_modules`
// directory reachable UP-TREE from the importing file (i.e. install/symlink the
// data-dir node_modules so it sits at the plugin root, adjacent to src/). AC3
// pins THAT working contract and additionally documents the NODE_PATH-ESM
// limitation as an executable expectation, so impl cannot ship the broken
// NODE_PATH-only variant and believe it works. The env-line AC (AC2) still
// asserts NODE_PATH is exported (it is harmless and helps any CJS consumer /
// the MCP server if it is CJS), but it is NOT sufficient on its own for ESM.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from './helpers/repoRoot.js';

const PKG_JSON = join(REPO_ROOT, 'package.json');
const HOOKS_JSON = join(REPO_ROOT, 'hooks', 'hooks.json');
const SETUP_DEPS = join(REPO_ROOT, 'hooks', 'setup-deps.mjs');
const SETUP_DEPS_URL = pathToFileURL(SETUP_DEPS).href;

const RUNTIME_DEPS = ['ajv', 'ajv-formats', 'gray-matter'];

// Tmp dirs created by AC3's isolation harness; reaped after the suite.
const __tmpDirs = [];
function makeTmp(label) {
  const p = mkdtempSync(join(tmpdir(), `${label}-`));
  __tmpDirs.push(p);
  return p;
}
afterAll(() => {
  for (const p of __tmpDirs) {
    try { rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* AV/EBUSY on win */ }
  }
});

function readJson(path) {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8')); // malformed JSON throws here — a "right" failure.
}

// ===========================================================================
// AC1 — the three runtime deps live under "dependencies", not "devDependencies".
// They are imported at MODULE LOAD by src/task-store.js (ajv, ajv-formats) and
// src/knowledge.js (gray-matter, ajv, ajv-formats), and that code runs on the
// USER's machine at init time — so they are runtime deps, full stop.
// FAILS NOW: package.json lists all three under devDependencies.
// ===========================================================================
describe('AC1 — runtime deps are in dependencies, not devDependencies', () => {
  it('package_json_has_a_dependencies_object', () => {
    const pkg = readJson(PKG_JSON);
    expect(
      pkg.dependencies && typeof pkg.dependencies === 'object',
      'package.json must declare a "dependencies" object',
    ).toBe(true);
  });

  for (const dep of RUNTIME_DEPS) {
    it(`${dep}_is_listed_under_dependencies`, () => {
      const pkg = readJson(PKG_JSON);
      const deps = pkg.dependencies || {};
      expect(
        Object.prototype.hasOwnProperty.call(deps, dep),
        `${dep} must be in package.json "dependencies" (runtime import)`,
      ).toBe(true);
      expect(typeof deps[dep]).toBe('string');
      expect(deps[dep].length).toBeGreaterThan(0);
    });

    it(`${dep}_is_NOT_left_in_devDependencies`, () => {
      const pkg = readJson(PKG_JSON);
      const dev = pkg.devDependencies || {};
      expect(
        Object.prototype.hasOwnProperty.call(dev, dep),
        `${dep} must be REMOVED from devDependencies once promoted to dependencies`,
      ).toBe(false);
    });
  }

  it('vitest_stays_a_devDependency', () => {
    // Guard: the promotion must move ONLY the three runtime deps. vitest is a
    // test-only tool and must remain under devDependencies.
    const pkg = readJson(PKG_JSON);
    const dev = pkg.devDependencies || {};
    expect(
      Object.prototype.hasOwnProperty.call(dev, 'vitest'),
      'vitest must remain a devDependency',
    ).toBe(true);
  });
});

// ===========================================================================
// AC2 (hook registration) — hooks/hooks.json registers a SessionStart hook that
// points at the bundled hook script via ${CLAUDE_PLUGIN_ROOT}.
//
// Shape (mirrors the Claude Code hooks.json format): a top-level object whose
// `hooks.SessionStart` is an array of matcher groups, each with a `hooks` array
// of { type: "command", command: "..." } entries. The command must invoke
// `node` against ${CLAUDE_PLUGIN_ROOT}/hooks/setup-deps.mjs so the hook script
// runs cross-platform (Windows users exist — a bash script would not).
// FAILS NOW: hooks/hooks.json does not exist.
// ===========================================================================
describe('AC2 — hooks/hooks.json registers a SessionStart hook', () => {
  it('hooks_json_exists_and_is_valid_json', () => {
    const h = readJson(HOOKS_JSON);
    expect(typeof h).toBe('object');
    expect(h).not.toBeNull();
  });

  it('declares_a_SessionStart_array', () => {
    const h = readJson(HOOKS_JSON);
    const root = h.hooks && typeof h.hooks === 'object' ? h.hooks : h;
    expect(Array.isArray(root.SessionStart), 'hooks.SessionStart must be an array').toBe(true);
    expect(root.SessionStart.length).toBeGreaterThan(0);
  });

  it('SessionStart_runs_a_command_hook_pointing_at_the_bundled_setup_script', () => {
    const h = readJson(HOOKS_JSON);
    const root = h.hooks && typeof h.hooks === 'object' ? h.hooks : h;
    // Collect every command string across the matcher groups.
    const commands = [];
    for (const group of root.SessionStart) {
      const entries = Array.isArray(group.hooks) ? group.hooks
        : (group.type ? [group] : []);
      for (const e of entries) {
        if (e && e.type === 'command' && typeof e.command === 'string') commands.push(e.command);
      }
    }
    expect(commands.length, 'SessionStart must declare at least one command hook').toBeGreaterThan(0);
    // The command references the plugin-root-relative hook script.
    const refsScript = commands.some(
      (c) => c.includes('${CLAUDE_PLUGIN_ROOT}') && c.includes('hooks/setup-deps.mjs'),
    );
    expect(
      refsScript,
      'a SessionStart command must run ${CLAUDE_PLUGIN_ROOT}/hooks/setup-deps.mjs',
    ).toBe(true);
    // Cross-platform: it must invoke the script through `node`, not a shell.
    const usesNode = commands.some((c) => /(^|\W)node(\W|$)/.test(c) && c.includes('setup-deps.mjs'));
    expect(usesNode, 'the hook command must run the .mjs via `node` (cross-platform)').toBe(true);
  });
});

// ===========================================================================
// AC3-behavior (ticket AC2 + folded-in CLAUDE_PROJECT_DIR) — the hook's core is
// a pure, unit-testable function. Representation pinned here:
//
//   planSetup({ pluginRoot, pluginData, projectDir, storedPkgExists, pkgChanged })
//     => { shouldInstall: boolean, envLines: string[] }
//
//   shouldInstall === true  ⟺  first run (!storedPkgExists) OR pkgChanged.
//   envLines ALWAYS include, regardless of shouldInstall:
//     `export NODE_PATH=<pluginData>/node_modules`
//     `export CLAUDE_PROJECT_DIR=<projectDir>`
//
// FAILS NOW: hooks/setup-deps.mjs does not exist (dynamic import rejects).
// ===========================================================================
describe('AC2-behavior — planSetup decides install + emits env lines', () => {
  async function loadPlanSetup() {
    const mod = await import(SETUP_DEPS_URL);
    expect(typeof mod.planSetup, 'hooks/setup-deps.mjs must export planSetup()').toBe('function');
    return mod.planSetup;
  }

  const base = {
    pluginRoot: '/cache/plugins/agentic-framework',
    pluginData: '/data/agentic-framework',
    projectDir: '/home/user/my-project',
  };

  it('first_run_no_stored_pkg_triggers_install', async () => {
    const planSetup = await loadPlanSetup();
    const plan = planSetup({ ...base, storedPkgExists: false, pkgChanged: false });
    expect(plan.shouldInstall).toBe(true);
  });

  it('changed_package_json_triggers_install', async () => {
    const planSetup = await loadPlanSetup();
    const plan = planSetup({ ...base, storedPkgExists: true, pkgChanged: true });
    expect(plan.shouldInstall).toBe(true);
  });

  it('unchanged_package_json_skips_install', async () => {
    const planSetup = await loadPlanSetup();
    const plan = planSetup({ ...base, storedPkgExists: true, pkgChanged: false });
    expect(plan.shouldInstall).toBe(false);
  });

  it('env_lines_always_export_NODE_PATH_at_the_data_dir_node_modules', async () => {
    const planSetup = await loadPlanSetup();
    for (const opts of [
      { storedPkgExists: false, pkgChanged: false },
      { storedPkgExists: true, pkgChanged: false },
    ]) {
      const plan = planSetup({ ...base, ...opts });
      expect(Array.isArray(plan.envLines)).toBe(true);
      const hasNodePath = plan.envLines.some(
        (l) => /^export\s+NODE_PATH=/.test(l) && l.includes(`${base.pluginData}/node_modules`),
      );
      expect(
        hasNodePath,
        'envLines must always export NODE_PATH=<pluginData>/node_modules',
      ).toBe(true);
    }
  });

  it('env_lines_always_export_CLAUDE_PROJECT_DIR_folded_in_from_P2', async () => {
    const planSetup = await loadPlanSetup();
    const plan = planSetup({ ...base, storedPkgExists: true, pkgChanged: false });
    const hasProjDir = plan.envLines.some(
      (l) => /^export\s+CLAUDE_PROJECT_DIR=/.test(l) && l.includes(base.projectDir),
    );
    expect(
      hasProjDir,
      'envLines must always export CLAUDE_PROJECT_DIR=<projectDir> (folded-in P2 backstop)',
    ).toBe(true);
  });

  it('env_lines_are_plain_export_VAR_value_strings', async () => {
    // $CLAUDE_ENV_FILE consumes literal `export VAR=value` lines. Each emitted
    // line must match that grammar so the file the hook writes is well-formed.
    const planSetup = await loadPlanSetup();
    const plan = planSetup({ ...base, storedPkgExists: false, pkgChanged: false });
    for (const line of plan.envLines) {
      expect(/^export\s+[A-Z_][A-Z0-9_]*=.+$/.test(line), `bad env line: ${line}`).toBe(true);
    }
  });
});

// ===========================================================================
// AC3 (ticket AC3) — RESOLUTION PROOF. Prove src/task-store.js (imports ajv +
// ajv-formats at module load) imports successfully when its deps are reachable
// ONLY via the data-dir node_modules, with NO node_modules adjacent to / above
// the importing src/ in the shipped tree.
//
// Method: build an ISOLATED copy under the OS tmp dir (verified to have NO
// node_modules anywhere up-tree on this machine), containing exactly
//   <iso>/src/task-store.js     (copy of the real module)
//   <iso>/src/atomic-write.js   (its only intra-repo import; node-builtins only)
//   <iso>/tasks/schema.json     (the ../tasks/schema.json asset it reads at init)
// then spawn `node --input-type=module -e 'import(<iso>/src/task-store.js)'` and
// vary how the deps are made reachable. This isolates dep resolution to exactly
// the mechanism under test.
//
// FINDING ENCODED HERE (impl-blocking — see file header): ESM ignores NODE_PATH.
//   • control_a: NODE_PATH=<repo>/node_modules, NO adjacent node_modules
//       → MUST FAIL (ERR_MODULE_NOT_FOUND). Documents that the literal
//         "NODE_PATH wiring" of the locked approach is INSUFFICIENT for ESM.
//   • working: a node_modules reachable up-tree from src/ (symlink/junction at
//       the iso root, the way a real plugin-root install would sit)
//       → MUST SUCCEED (IMPORT_OK). This is the contract impl must satisfy.
//
// These spawns require the repo's real node_modules to exist (it does — dev
// install). control_a FAILS NOW only in the sense that it asserts a documented
// truth; the load-bearing tests-first failures are AC1/AC2/AC2-behavior above.
// `working` is a guard that the mechanism impl must wire up is physically sound.
// ===========================================================================
describe('AC3 — task-store.js resolves via data-dir node_modules, none adjacent', () => {
  const REPO_NM = join(REPO_ROOT, 'node_modules');

  // Skip the whole block (rather than error) if the dev install is missing, so
  // the suite stays honest on a node_modules-less checkout.
  const haveDevInstall = existsSync(join(REPO_NM, 'ajv')) && existsSync(join(REPO_NM, 'ajv-formats'));

  function buildIsolatedCopy() {
    const root = makeTmp('af-deps-iso');
    const srcDir = join(root, 'src');
    const tasksDir = join(root, 'tasks');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'src', 'task-store.js'), join(srcDir, 'task-store.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'atomic-write.js'), join(srcDir, 'atomic-write.js'));
    copyFileSync(join(REPO_ROOT, 'tasks', 'schema.json'), join(tasksDir, 'schema.json'));
    return { root, srcDir };
  }

  function spawnImport(srcDir, env) {
    const url = pathToFileURL(join(srcDir, 'task-store.js')).href;
    const code = `import(${JSON.stringify(url)})`
      + `.then((m) => { process.stdout.write(typeof m.createTask === 'function' ? 'IMPORT_OK' : 'NO_EXPORT'); })`
      + `.catch((e) => { process.stderr.write('ERR:' + (e && e.code || 'UNKNOWN')); process.exit(3); });`;
    const cleanEnv = { ...process.env };
    delete cleanEnv.NODE_PATH;
    return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: srcDir, env: { ...cleanEnv, ...env }, encoding: 'utf8',
    });
  }

  it.skipIf(!haveDevInstall)(
    'working_adjacent_node_modules_resolves_ESM_imports',
    () => {
      const { root, srcDir } = buildIsolatedCopy();
      // The real working mechanism: a node_modules reachable up-tree from src/.
      // (A plugin-root install, or a junction from ${CLAUDE_PLUGIN_DATA}.)
      const linked = join(root, 'node_modules');
      try {
        symlinkSync(REPO_NM, linked, 'junction');
      } catch (e) {
        // Junctions need no admin on Windows; if it still fails, fail loudly so
        // we don't silently pass a meaningless test.
        throw new Error(`could not create node_modules junction for the proof: ${e.code || e.message}`);
      }
      const r = spawnImport(srcDir, {});
      expect(
        r.stdout.trim(),
        `expected IMPORT_OK; got stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
      ).toBe('IMPORT_OK');
      expect(r.status).toBe(0);
    },
  );

  it.skipIf(!haveDevInstall)(
    'control_NODE_PATH_alone_does_NOT_resolve_ESM_imports',
    () => {
      // Documents the impl-blocking truth: ESM `import` ignores NODE_PATH. With
      // the data-dir's node_modules reachable ONLY via NODE_PATH (none adjacent
      // up-tree), the import MUST fail. If this ever starts passing, Node has
      // changed ESM resolution to honor NODE_PATH and the impl/AC can simplify.
      const { srcDir } = buildIsolatedCopy();
      const r = spawnImport(srcDir, { NODE_PATH: REPO_NM });
      expect(
        r.status,
        `NODE_PATH-only should fail for ESM; stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
      ).not.toBe(0);
      expect(r.stderr).toContain('ERR:ERR_MODULE_NOT_FOUND');
    },
  );

  it('in_repo_resolution_still_works', async () => {
    // Guard: importing the real module in-repo (node_modules adjacent up-tree)
    // resolves ajv/ajv-formats fine — the baseline the impl must not regress.
    const { PROD } = await import('./helpers/fixtures.js');
    const mod = await import(PROD.taskStore);
    expect(typeof mod.createTask).toBe('function');
  });
});
