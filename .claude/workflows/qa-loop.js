export const meta = {
  name: 'qa-loop',
  description: 'QA phase after human approval: full tests + role/permission tests → docs → review → merge instructions',
  phases: [
    { title: 'Full verification' },
    { title: 'Docs' },
    { title: 'Review' },
    { title: 'Merge' },
  ]
};

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['PASS', 'FAIL'] },
    test_output: { type: 'string' },
    test_count: { type: 'number' },
    coverage_pct: { type: 'number' },
    curl_outputs: { type: 'array', items: { type: 'string' } },
    browser_observation: { type: 'string' },
    cli_output: { type: 'string' },
    // Permission test results — separate from functional failures
    // Bugs here are tracked in state.md, do NOT block PASS status
    permission_bugs: {
      type: 'array',
      items: { type: 'string' },
      description: 'Permission/role test failures. Tracked as bugs, do not affect status.'
    },
    failures: { type: 'array', items: { type: 'string' } }
  },
  required: ['status', 'test_output', 'test_count', 'coverage_pct', 'curl_outputs', 'browser_observation', 'cli_output', 'permission_bugs', 'failures']
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    blocking: { type: 'array', items: { type: 'string' } },
    major: { type: 'array', items: { type: 'string' } },
    minor: { type: 'array', items: { type: 'string' } }
  },
  required: ['blocking', 'major', 'minor']
};

const { goal, worktreeSlug, startingBranch, tasks } = args;
const worktreePath = `.worktrees/${worktreeSlug}`;
const taskSummary = tasks ? tasks.map(t => `${t.id}. ${t.description}`).join('\n') : 'See state.md';
const MAX_LOOPS = 3;

let loops = 0;
let testResult = null;

while (loops < MAX_LOOPS) {
  loops++;

  if (loops > 1) {
    await agent(
      `Read .ai/state.md. Worktree: ${worktreePath}
Fix failures: ${testResult?.failures?.join('; ')}.
Task: "${goal}".`,
      { label: `developer-fix:${loops}`, agentType: 'developer', phase: 'Full verification' }
    );
  }

  phase('Full verification');
  testResult = await agent(
    `Read .ai/state.md. Worktree: ${worktreePath}

Full verification of ALL implemented tasks:
${taskSummary}

Verify every surface. No output = FAIL. Untouched surfaces = "N/A".

1. BUILD: cd ${worktreePath} && npm run build 2>&1. All packages. Stop if build fails.

2. TESTS: npm test for all touched packages. Coverage >=98% required. Paste full output. Extract test_count and coverage_pct.

3. SERVICE — functional: curl -s http://localhost:3000/api/setup/status (must be 200).
   Then test the feature endpoints: happy path + 401 (no token) + 400 (bad input) + 403 (wrong role).
   Use $ROUTERLY_SMOKE_EMAIL / $ROUTERLY_SMOKE_PASSWORD. Paste each in curl_outputs.

4. PERMISSION/ROLE TESTS — always run if any route is protected:
   a. Create a test role with NO permissions via curl (use admin token).
   b. Create a test user with that role via curl.
   c. Get a token for the test user.
   d. Call the feature endpoint with the restricted token → expect 403. Paste result.
   e. In the browser: log in as the test user, navigate to the feature → restricted user must see 403 page or hidden/disabled UI. Paste observation.
   f. Via CLI: run the command with the restricted token → expect graceful error. Paste output.
   g. Repeat with an authorized role → expect full access.
   h. Delete test users/roles after.
   If any permission test is wrong → add to permission_bugs array. Do NOT set status=FAIL for this alone — bugs are tracked separately.

5. BROWSER UAT (if dashboard touched): resize 1920x1080, full session — loads, CRUD, validation, empty state, dark+light theme. Paste per-step observation in browser_observation.

6. CLI (if CLI touched): run command, paste output in cli_output.

status=PASS only if: build OK, tests pass, coverage>=98%, functional curl correct, browser UAT OK, CLI OK.
Permission bugs go in permission_bugs but do NOT block PASS.`,
    { label: `tester:${loops}`, agentType: 'tester', schema: TEST_SCHEMA }
  );

  if (testResult && testResult.status === 'PASS') {
    log(`Full verification PASS: ${testResult.test_count} tests, ${testResult.coverage_pct}% coverage.`);
    break;
  }
  log(`Full verification FAIL (loop ${loops}): ${testResult?.failures?.join(', ') ?? 'unknown'}`);
}

// Track permission bugs in state.md
const permBugs = testResult?.permission_bugs ?? [];
if (permBugs.length > 0) {
  log(`${permBugs.length} permission bug(s) found — tracking in state.md.`);
  await agent(
    `Update .ai/state.md open issues table. Add each of these as a bug entry with priority "High":
${permBugs.map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
    { label: 'track-permission-bugs', phase: 'Full verification' }
  );
}

phase('Docs');
await agent(
  `Read .ai/state.md. Worktree: ${worktreePath}
Update docs for all touched surfaces (service + CLI + dashboard — all three if service touched).
Screenshots 1920x1080 light mode, saved next to the doc file.
Include verbatim terminal output for documented commands.
Verify: npm run build --workspace=website 2>&1 — paste output.`,
  { label: 'docs', agentType: 'docs' }
);

phase('Review');
const review = await agent(
  `Read .ai/state.md. Worktree: ${worktreePath}
Review git diff main...HEAD: security, wire-format, correctness, permission chain, imports, writeConfig usage, docs gaps.
Return structured findings.`,
  { label: 'reviewer', agentType: 'reviewer', schema: REVIEW_SCHEMA }
);

if (review && review.blocking.length > 0) {
  log(`Reviewer: ${review.blocking.length} BLOCKING findings.`);
  await agent(
    `Read .ai/state.md. Worktree: ${worktreePath}
Fix BLOCKING findings: ${review.blocking.join('; ')}.`,
    { label: 'developer-review-fix', agentType: 'developer', phase: 'Review' }
  );
}

await agent(
  `Update .ai/state.md: phase="Awaiting final approval", test_status="${testResult?.status ?? 'FAIL'}", coverage="${testResult?.coverage_pct ?? 0}%", blocking_findings=${review?.blocking?.length ?? 0}, permission_bugs=${permBugs.length}.`,
  { label: 'state-update', phase: 'Merge' }
);

return {
  testStatus: testResult?.status ?? 'FAIL',
  testCount: testResult?.test_count ?? 0,
  coveragePct: testResult?.coverage_pct ?? 0,
  permissionBugs: permBugs,
  review,
  mergeInstructions: `cd ${worktreePath} && git checkout . && cd - && git checkout ${startingBranch} && git merge ${worktreeSlug} && git worktree remove ${worktreePath} && git branch -d ${worktreeSlug}`
};
