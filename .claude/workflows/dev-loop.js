export const meta = {
  name: 'dev-loop',
  description: 'Task-driven development loop: processes each task through analysis → developer → checker → smoker until all tasks pass',
  phases: [
    { title: 'Setup' },
    { title: 'Analysis' },
    { title: 'Development' },
    { title: 'Soft check' },
    { title: 'Smoke' },
  ]
};

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['PASS', 'FAIL'] },
    typecheck_output: { type: 'string' },
    test_output: { type: 'string' },
    test_count: { type: 'number' },
    coverage_pct: { type: 'number' },
    failures: { type: 'array', items: { type: 'string' } }
  },
  required: ['status', 'typecheck_output', 'test_output', 'test_count', 'coverage_pct', 'failures']
};

const SMOKE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['PASS', 'FAIL'] },
    build_output: { type: 'string' },
    http_responses: { type: 'array', items: { type: 'string' } },
    browser_observation: { type: 'string' },
    cli_output: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } }
  },
  required: ['status', 'build_output', 'http_responses', 'browser_observation', 'cli_output', 'failures']
};

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'] },
          blocker: { type: 'string' }
        },
        required: ['id', 'description', 'status']
      }
    }
  },
  required: ['tasks']
};

const { goal, worktreeSlug, tasks: initialTasks } = typeof args === 'string' ? JSON.parse(args) : args;
const worktreePath = `.worktrees/${worktreeSlug}`;
const MAX_LOOPS_PER_TASK = 6;

// Setup worktree
phase('Setup');
await agent(
  `Run: git worktree add ${worktreePath} -b ${worktreeSlug}
Update .ai/state.md:
- task: "${goal}"
- phase: "Setup"
- branch: "${worktreeSlug}"
- worktree_path: "${worktreePath}"
- tasks:
${initialTasks.map(t => `  [${t.id}] TODO — ${t.description}`).join('\n')}`,
  { label: 'setup' }
);

// Analysis — deep code reading, produces implementation notes per task
phase('Analysis');
const analysis = await agent(
  `Read .ai/state.md. Worktree: ${worktreePath}

Goal: "${goal}"

Tasks to implement:
${initialTasks.map(t => `${t.id}. ${t.description}`).join('\n')}

For each task:
1. Find the relevant existing files (grep, read similar routes/components/commands)
2. Read at least one similar existing feature to understand patterns
3. Note: exact files to modify, components/patterns to reuse, precise behavior

Output a concrete per-task implementation guide. Include file paths, component names, method signatures.`,
  { label: 'analysis' }
);

// Task-driven loop
let currentTasks = initialTasks.map(t => ({ ...t, status: 'TODO', blocker: '' }));
let allDone = false;
let criticalBlock = null;

for (let taskIdx = 0; taskIdx < currentTasks.length; taskIdx++) {
  const task = currentTasks[taskIdx];
  log(`Task ${task.id}/${currentTasks.length}: ${task.description}`);

  // Mark task in progress
  currentTasks[taskIdx].status = 'IN_PROGRESS';
  await agent(
    `Update .ai/state.md: task ${task.id} → IN_PROGRESS`,
    { label: `state:task-${task.id}-start` }
  );

  let loops = 0;
  let taskPassed = false;
  let lastSmoke = null;

  while (loops < MAX_LOOPS_PER_TASK && !taskPassed) {
    loops++;
    log(`  Task ${task.id} — iteration ${loops}/${MAX_LOOPS_PER_TASK}`);

    phase('Development');
    await agent(
      `Read .ai/state.md. Worktree: ${worktreePath}

Current task (${task.id}/${currentTasks.length}): ${task.description}

Full goal for context: "${goal}"
Analysis notes: ${analysis}

Implement this task only. Read the files you will modify first. Match existing patterns exactly.
Write tests alongside the implementation.
Update .ai/state.md: phase="Development", current_task="${task.description}", iteration=${loops}`,
      { label: `developer:task${task.id}:${loops}`, agentType: 'developer' }
    );

    phase('Soft check');
    const checkResult = await agent(
      `Read .ai/state.md. Worktree: ${worktreePath}

Run in the worktree for every touched package:
  npm run typecheck 2>&1
  npm test 2>&1

Paste verbatim output. Extract test_count and coverage_pct.
PASS only if typecheck clean and all tests pass. No output = FAIL.`,
      { label: `checker:task${task.id}:${loops}`, agentType: 'checker', schema: CHECK_SCHEMA }
    );

    if (!checkResult || checkResult.status === 'FAIL') {
      log(`  Soft check FAIL: ${checkResult?.failures?.join(', ') ?? 'unknown'}`);
      continue;
    }

    log(`  Soft check PASS: ${checkResult.test_count} tests, ${checkResult.coverage_pct}%`);

    phase('Smoke');
    lastSmoke = await agent(
      `Read .ai/state.md. Worktree: ${worktreePath}

Mini-UAT for task: "${task.description}"
Full goal context: "${goal}"

1. BUILD: cd ${worktreePath} && npm run build 2>&1. Stop on failure.
2. SERVICE HEALTH: curl -s http://localhost:3000/api/setup/status — must return 200.
3. SERVICE FEATURE (if service touched): use $ROUTERLY_SMOKE_EMAIL / $ROUTERLY_SMOKE_PASSWORD. Exercise feature endpoints in natural user order. Paste status + body.
4. BROWSER (if dashboard touched): resize 1920x1080. Navigate, USE the feature — click, fill, submit. Verify result. Check alignment, spacing, dark mode. Check console errors. Describe each action + result.
5. CLI (if CLI touched): run command, paste output.

PASS only if this specific task's functionality works end-to-end AND visual quality is correct.`,
      { label: `smoker:task${task.id}:${loops}`, agentType: 'smoker', schema: SMOKE_SCHEMA }
    );

    if (lastSmoke && lastSmoke.status === 'PASS') {
      taskPassed = true;
      log(`  Task ${task.id} PASS.`);
    } else {
      log(`  Smoke FAIL: ${lastSmoke?.failures?.join(', ') ?? 'unknown'}`);
    }
  }

  if (taskPassed) {
    currentTasks[taskIdx].status = 'DONE';
    await agent(
      `Update .ai/state.md: task ${task.id} → DONE. Progress: ${taskIdx + 1}/${currentTasks.length} tasks complete.`,
      { label: `state:task-${task.id}-done` }
    );
  } else {
    // Task failed after max loops — critical block
    currentTasks[taskIdx].status = 'BLOCKED';
    currentTasks[taskIdx].blocker = lastSmoke?.failures?.join('; ') ?? 'unknown after max iterations';
    criticalBlock = {
      task,
      failures: lastSmoke?.failures ?? [],
      loops
    };
    await agent(
      `Update .ai/state.md: task ${task.id} → BLOCKED. Reason: ${criticalBlock.blocker}. Phase: "BLOCKED — awaiting orchestrator decision".`,
      { label: `state:task-${task.id}-blocked` }
    );
    log(`Task ${task.id} BLOCKED after ${loops} loops. Stopping.`);
    break;
  }
}

const doneTasks = currentTasks.filter(t => t.status === 'DONE');
const allTasksDone = doneTasks.length === currentTasks.length;

if (allTasksDone) {
  await agent(
    `Update .ai/state.md: phase="Awaiting human review", all_tasks_done=true, tasks_completed=${doneTasks.length}/${currentTasks.length}.`,
    { label: 'state-final' }
  );
}

return {
  status: allTasksDone ? 'ALL_DONE' : 'BLOCKED',
  tasks: currentTasks,
  criticalBlock,
  goal,
  worktreeSlug,
  worktreePath
};
