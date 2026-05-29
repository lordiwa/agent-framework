// tests/mcp-scope-docstring.spec.js
// TASK-026 — Plugin chain P6: MCP server scope boundary (AC4).
//
// AC4: "The server's docstring/README states the explicit WILL/WON'T for a
// non-Claude-Code client (gets ticket CRUD; does NOT get the orchestrator/
// subagent loop or RESUME-FIRST orchestration)."
//
// This is the "broaden-to-non-Code" seam (tasks/TASK-020.research.md §E.2): an
// MCP client (claude.ai / Claude Desktop / any MCP host) WILL get the six
// task-store tools (full ticket CRUD), but WON'T get the orchestrator →
// developer/reviewer/researcher subagent loop or the RESUME-FIRST session-state
// orchestration — those are Claude Code-exclusive, file-based constructs MCP
// cannot install or drive.
//
// We assert on the SOURCE TEXT of src/mcp-server.js (read as a file, NOT
// imported), so this spec does NOT depend on the @modelcontextprotocol/sdk being
// installed — it is a pure docstring-presence check, distinct from the
// import-based round-trip in tests/mcp-server.spec.js.
//
// TESTS-FIRST: src/mcp-server.js does not exist yet, so the existence assertion
// FAILS for the RIGHT reason (file absent); the content assertions then never
// run on a phantom file.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const MCP_SERVER_SRC = join(REPO_ROOT, 'src', 'mcp-server.js');

describe('AC4 — src/mcp-server.js documents the WILL/WON\'T scope boundary', () => {
  it('mcp_server_source_exists', () => {
    expect(
      existsSync(MCP_SERVER_SRC),
      'src/mcp-server.js must exist',
    ).toBe(true);
  });

  it('docstring_states_what_a_non_Claude_Code_client_WILL_get', () => {
    const text = readFileSync(MCP_SERVER_SRC, 'utf8');
    // The WILL clause: ticket CRUD on the task store for any MCP client.
    expect(/WILL/.test(text), 'must carry an explicit WILL statement').toBe(true);
    expect(
      /CRUD|create.*read.*transition|ticket store|task[- ]store/i.test(text),
      'WILL clause must describe ticket/task CRUD on the store',
    ).toBe(true);
    // It must name a non-Claude-Code client surface.
    expect(
      /non[- ]Claude[- ]Code|claude\.ai|Claude Desktop|MCP (host|client)/i.test(text),
      'must reference the non-Claude-Code client surface',
    ).toBe(true);
  });

  it('docstring_states_what_such_a_client_WONT_get', () => {
    const text = readFileSync(MCP_SERVER_SRC, 'utf8');
    // The WON'T clause: NOT the orchestrator/subagent loop, NOT RESUME-FIRST.
    expect(
      /WON'?T|WONT|does NOT get|does not get/i.test(text),
      "must carry an explicit WON'T statement",
    ).toBe(true);
    expect(
      /orchestrat|subagent/i.test(text),
      "WON'T clause must exclude the orchestrator/subagent loop",
    ).toBe(true);
    expect(
      /RESUME[- ]FIRST/i.test(text),
      "WON'T clause must exclude RESUME-FIRST orchestration",
    ).toBe(true);
  });
});
