#!/usr/bin/env node
// PreToolUse guard: restricts what an agent may write, by path.
//
// Usage (subagent frontmatter):
//   hooks:
//     PreToolUse:
//       - matcher: "Edit|Write|NotebookEdit"
//         hooks:
//           - type: command
//             command: "${CLAUDE_PROJECT_DIR}/.claude/scripts/guard-write.mjs"
//             args: ["artifacts"]        # or "tests"
//
// Reads the hook payload on stdin, exits 2 to block. Path matching is done on
// path segments, so it holds whether the agent writes through the worktree
// symlink or the resolved location.

import { resolve } from 'node:path';

const MODE = process.argv[2] ?? 'artifacts';

// Always writable: spec artifacts, agent memory, scratch space.
const ARTIFACTS = [
  '/.claude/specs/',
  '/.claude/agent-memory/',
  '/.claude/agent-memory-local/',
  '/tmp/',
  '/private/tmp/',
  '/var/folders/', // macOS temp
];

// Additionally writable in "tests" mode.
const TESTS = [
  '/tests/',
  '/test/',
  '/__tests__/',
  '/e2e/',
  '/fixtures/',
  '/__fixtures__/',
];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const read = async (stream) => {
  let data = '';
  for await (const chunk of stream) data += chunk;
  return data;
};

const payload = JSON.parse((await read(process.stdin)) || '{}');
const input = payload.tool_input ?? {};
const target = input.file_path ?? input.notebook_path ?? input.path;

// Nothing to check: let the normal permission flow decide.
if (!target) process.exit(0);

const path = resolve(target);
const allowed = MODE === 'tests' ? [...ARTIFACTS, ...TESTS] : ARTIFACTS;

const ok =
  allowed.some((dir) => path.includes(dir)) ||
  (MODE === 'tests' && TEST_FILE.test(path));

if (ok) process.exit(0);

const agent = payload.agent_type ?? 'this agent';
const permitted =
  MODE === 'tests'
    ? 'test files, plus spec artifacts and its own memory'
    : 'spec artifacts and its own memory';

process.stderr.write(
  `Blocked: ${agent} may only write ${permitted}. ` +
    `Refused ${payload.tool_name ?? 'write'} to ${path}.\n` +
    `This is a role boundary, not a permission prompt: do not retry, do not ` +
    `route the change through another tool, and do not ask another agent to ` +
    `apply it. Report it as a finding instead.\n`,
);
process.exit(2);
