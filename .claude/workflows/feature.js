export const meta = {
  name: 'feature',
  description: 'Routerly feature-delivery loop: plan, implement (backend/frontend), verify, design+pattern review, docs. Loops on findings.',
  whenToUse: 'args: a feature string, or { description, maxRounds? }. maxRounds caps remediation rounds (default: stall/budget-governed with a 50-round anti-runaway backstop). A non-converged run returns its stopReason so the orchestrator decides resume-vs-halt. Encodes .claude/rules/workflow.md as an executable subagent pipeline.',
  phases: [
    { title: 'Plan', detail: 'break the feature into surfaces + acceptance + boundary cases' },
    { title: 'Implement', detail: 'backend-developer then frontend-developer (parity handoff)' },
    { title: 'Verify', detail: 'qa-manager: tests, coverage >=98%, curl/CLI/browser boundary cases' },
    { title: 'Review', detail: 'ui-design-reviewer (if UI) + pattern-reviewer, in parallel' },
    { title: 'Docs', detail: 'docs agent updates every touched surface' },
    { title: 'Handoff', detail: 'append run state to handoff.md after each phase' },
  ],
}

// ---- schemas -------------------------------------------------------------

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    surfaces: { type: 'array', items: { type: 'string', enum: ['service', 'cli', 'dashboard', 'docs'] } },
    backendWork: { type: 'string', description: 'service/cli/shared work, or "none"' },
    frontendWork: { type: 'string', description: 'dashboard work, or "none"' },
    acceptance: { type: 'array', items: { type: 'string' } },
    boundaryCases: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'surfaces', 'backendWork', 'frontendWork', 'acceptance', 'boundaryCases'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['VERIFIED DONE', 'VERIFIED PARTIAL', 'VERIFIED BROKEN', 'NOT VERIFIED'] },
    failures: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'HTTP codes/bodies, command output, coverage number, screenshots taken' },
  },
  required: ['status', 'failures', 'evidence'],
}

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['BLOCKING', 'MAJOR', 'MINOR', 'NIT'] },
          note: { type: 'string' },
        },
        required: ['severity', 'note'],
      },
    },
  },
  required: ['findings'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'CHANGES_REQUESTED'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['BLOCKING', 'MAJOR', 'MINOR', 'SUGGESTION'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'problem', 'fix'],
      },
    },
  },
  required: ['verdict', 'findings'],
}

// ---- helpers -------------------------------------------------------------

const hasWork = (s) => !!s && s.trim() !== '' && s.trim().toLowerCase() !== 'none'
const blockers = (findings) => findings.filter((f) => f.severity === 'BLOCKING' || f.severity === 'MAJOR')
const bullets = (arr) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- (none)')
const brief = (s) => (typeof s === 'string' ? s.slice(0, 280) : String(s ?? ''))

// Append (or, on the first call, (re)create) the run-state file handoff.md.
// The script has no filesystem access, so a cheap haiku scribe writes the file.
async function record(step, status, summary, next, fresh) {
  const head = fresh
    ? `Create or overwrite \`handoff.md\` at the repo root. Start with this header line, then the entry below:\n\n# Handoff — ${feature || 'feature run'}\n\n`
    : `Append to \`handoff.md\` at the repo root — it already exists, append only, never rewrite earlier entries:\n\n`
  await agent(
    `${head}## ${step} — ${status}\n${summary}\nNext: ${next}\n\nWrite exactly that block. Touch no other file, add no commentary.`,
    { label: `SA - handoff - ${step}`, phase: 'Handoff', model: 'haiku', effort: 'low' },
  )
}

const feature =
  typeof args === 'string' ? args : args && args.description ? args.description : ''

if (!hasWork(feature)) {
  log('No feature description in args. Invoke as: /feature "<what to build>".')
}

// Termination is the orchestrator's decision, surfaced with a reason — never a blind constant.
// The loop ends only on a named condition the main thread can act on: converged | stalled | budget | cap.
// The operational bound is what the PM passes per run (args.maxRounds, or a token budget); HARD_CAP is an
// anti-runaway backstop only. A non-converged stop returns its reason so the PM decides resume vs halt.
const HARD_CAP = Math.max(1, (args && Number(args.maxRounds)) || 50)
const STALL_LIMIT = 2 // consecutive rounds without fewer blockers => stop and hand back to the PM

// ---- 0. PLAN -------------------------------------------------------------

phase('Plan')
const plan = await agent(
  `You are planning a Routerly feature. Read CLAUDE.md and .claude/rules/workflow.md for the delivery loop and constraints.

Feature request:
${feature || '(none provided — infer nothing; report that the request is empty)'}

Produce the implementation brief: which surfaces it touches (service/cli/dashboard/docs), the concrete backend work (service/cli/shared) and frontend work (dashboard) — "none" if a side is untouched, the acceptance criteria, and the boundary cases that must be proven (empty data, 401, 400, 403 low-privilege, expired token). Do not write code.`,
  { agentType: 'Plan', schema: PLAN_SCHEMA, phase: 'Plan', label: 'SA - Plan - brief' },
)

const touchesBackend =
  plan.surfaces.includes('service') || plan.surfaces.includes('cli') || hasWork(plan.backendWork)
const touchesDashboard = plan.surfaces.includes('dashboard') || hasWork(plan.frontendWork)

log(`Plan: ${plan.summary} | backend=${touchesBackend} dashboard=${touchesDashboard}`)
await record(
  'Plan',
  'done',
  `${plan.summary} (surfaces: ${plan.surfaces.join(', ') || 'none'})`,
  touchesBackend || touchesDashboard ? 'implement' : 'docs',
  true,
)

// ---- remediation loop: IMPLEMENT -> VERIFY -> REVIEW ---------------------

let outstanding = []
let verify = null
let review = null
let design = { findings: [] }
let backendSummary = '(no backend changes)'
let frontendSummary = '(no dashboard changes)'
let round = 0
let stopReason = null
let prevBlockers = Infinity
let stallStreak = 0

while (true) {
  round += 1
  const remediation = outstanding.length
    ? `\n\nThis is remediation round ${round}. Fix these findings from the previous round:\n${bullets(outstanding)}`
    : ''

  phase('Implement')

  // Backend first so the frontend gets the endpoint contract (cross-surface parity).
  if (touchesBackend) {
    backendSummary = await agent(
      `Implement the backend/CLI side of this Routerly feature. Follow CLAUDE.md (wire-format transparency, permissions chain) and .claude/rules/{service,cli}.md. Write *.test.ts alongside. Self-check with typecheck + curl/CLI before reporting.

Feature: ${feature}
Backend work: ${plan.backendWork}
Acceptance: ${bullets(plan.acceptance)}
Boundary cases: ${bullets(plan.boundaryCases)}${remediation}

Return: a concise change summary AND, for any new/changed endpoint, the exact contract (method, path, request body, response body, permission) the dashboard must call.`,
      { agentType: 'backend-developer', phase: 'Implement', label: `SA - backend-developer - implement r${round}` },
    )
  }

  if (touchesDashboard) {
    frontendSummary = await agent(
      `Implement the dashboard side of this Routerly feature. Follow .claude/rules/dashboard.md — reuse existing components, ThemeContext for colors, all calls through api.ts, shared types. Self-verify in the browser (screenshot per variant) before reporting.

Feature: ${feature}
Frontend work: ${plan.frontendWork}
Backend contract to consume:
${backendSummary}${remediation}

Return a concise change summary.`,
      { agentType: 'frontend-developer', phase: 'Implement', label: `SA - frontend-developer - implement r${round}` },
    )
  }

  await record(
    `Implement (round ${round})`,
    'done',
    `backend: ${brief(backendSummary)} | dashboard: ${brief(frontendSummary)}`,
    'verify',
  )

  // VERIFY
  phase('Verify')
  verify = await agent(
    `Verify this Routerly feature with executed evidence (.claude/rules/feature-verification.md). Write/extend *.test.ts, then run: npm run typecheck, npm test, coverage (>=98%). Run the boundary cases against localhost:3000 (curl: happy, 401, 400, 403 low-privilege) and the CLI command if touched. Browser UAT per variant if the dashboard changed. Do NOT edit production code — report failures back.

Feature: ${feature}
Backend changes: ${backendSummary}
Dashboard changes: ${frontendSummary}
Acceptance: ${bullets(plan.acceptance)}
Boundary cases: ${bullets(plan.boundaryCases)}

Return the status with the actual evidence and a list of concrete failures.`,
    { agentType: 'qa-manager', schema: VERIFY_SCHEMA, phase: 'Verify', label: `SA - qa-manager - verify r${round}` },
  )

  await record(
    `Verify (round ${round})`,
    verify.status,
    `${brief(verify.evidence)}${verify.failures.length ? ` | failures: ${verify.failures.length}` : ''}`,
    verify.status === 'VERIFIED DONE' ? 'review' : 'remediate',
  )

  // REVIEW (design only if UI touched) + pattern review, in parallel
  phase('Review')
  const reviews = await parallel(
    [
      touchesDashboard
        ? () =>
            agent(
              `Review the dashboard changes for this feature in a real browser (read-only). Theme (dark+light), consistency, component reuse, layout, states (loading/empty/error), responsive/collapsed sidebar, accessibility basics. Feature: ${feature}. Changes: ${frontendSummary}`,
              { agentType: 'ui-design-reviewer', schema: DESIGN_SCHEMA, phase: 'Review', label: `SA - ui-design-reviewer - review r${round}` },
            )
        : null,
      () =>
        agent(
          `Read-only pre-merge audit of the current diff for this feature: security, project constraints, correctness, conventions, reuse/over-engineering, coverage, docs parity (CLAUDE.md + .claude/rules). Feature: ${feature}. Backend: ${backendSummary}. Dashboard: ${frontendSummary}.`,
          { agentType: 'pattern-reviewer', schema: REVIEW_SCHEMA, phase: 'Review', label: `SA - pattern-reviewer - review r${round}` },
        ),
    ].filter(Boolean),
  )

  if (touchesDashboard) {
    design = reviews[0] || { findings: [] }
    review = reviews[1] || { verdict: 'CHANGES_REQUESTED', findings: [] }
  } else {
    design = { findings: [] }
    review = reviews[0] || { verdict: 'CHANGES_REQUESTED', findings: [] }
  }

  await record(
    `Review (round ${round})`,
    review.verdict,
    `design blockers: ${blockers(design.findings).length} | pattern blockers: ${blockers(review.findings).length}`,
    review.verdict === 'PASS' && blockers(review.findings).length === 0 && blockers(design.findings).length === 0
      ? 'docs'
      : 'remediate',
  )

  // Converged?
  const verifyOk = verify.status === 'VERIFIED DONE'
  const reviewOk = review.verdict === 'PASS' && blockers(review.findings).length === 0
  const designOk = blockers(design.findings).length === 0
  if (verifyOk && reviewOk && designOk) {
    stopReason = 'converged'
    log(`Converged in round ${round}.`)
    break
  }

  outstanding = [
    ...verify.failures,
    ...blockers(review.findings).map((f) => `${f.location || 'code'}: ${f.problem} -> ${f.fix}`),
    ...blockers(design.findings).map((f) => `UI: ${f.note}`),
  ]

  // Stop only on a named, actionable reason — never a silent constant. Each break hands the run
  // back to the main thread (with the reason + open findings) to decide resume vs halt.
  if (outstanding.length >= prevBlockers) stallStreak += 1
  else stallStreak = 0
  prevBlockers = outstanding.length

  if (stallStreak >= STALL_LIMIT) {
    stopReason = 'stalled'
    log(`No progress for ${STALL_LIMIT} rounds (${outstanding.length} blocker(s) stuck); stopping for the orchestrator to decide.`)
    break
  }
  if (budget.total && budget.remaining() < 60000) {
    stopReason = 'budget'
    log(`Token budget nearly spent (${Math.round(budget.remaining() / 1000)}k left); stopping with ${outstanding.length} open.`)
    break
  }
  if (round >= HARD_CAP) {
    stopReason = 'cap'
    log(`Hit anti-runaway cap (${HARD_CAP} rounds) with ${outstanding.length} open; raise args.maxRounds or resume to continue.`)
    break
  }
  log(`Round ${round}: ${outstanding.length} blocker(s) -> remediating.`)
}

// ---- DOCS (every touched surface) ---------------------------------------

phase('Docs')
const docs = await agent(
  `Update docs/ for this Routerly feature on EVERY surface it touches (API/service + CLI + dashboard). Dashboard docs get a current screenshot via Chrome MCP. No stale images, no docs for removed features.

Feature: ${feature}
Surfaces: ${plan.surfaces.join(', ') || '(none)'}
Backend changes: ${backendSummary}
Dashboard changes: ${frontendSummary}`,
  { agentType: 'docs', phase: 'Docs', label: 'SA - docs - update' },
)

await record('Docs', 'done', brief(docs), 'sign-off')

// ---- synthesis -----------------------------------------------------------

const converged = stopReason === 'converged'

await record(
  'Sign-off',
  converged ? 'ready' : 'open',
  converged
    ? 'All gates green after ' + round + ' round(s).'
    : `Stopped (${stopReason || 'incomplete'}) after ${round} round(s); ${outstanding.length} finding(s) open.`,
  converged
    ? 'await user sign-off (VERIFIED DONE needs the user to see evidence)'
    : `orchestrator decides: resume (more rounds) or halt — reason: ${stopReason || 'incomplete'}`,
)

return {
  feature,
  converged,
  rounds: round,
  status: verify ? verify.status : 'NOT VERIFIED',
  plan: plan.summary,
  surfaces: plan.surfaces,
  backendSummary,
  frontendSummary,
  evidence: verify ? verify.evidence : '',
  openFindings: outstanding,
  designFindings: design.findings,
  reviewVerdict: review ? review.verdict : 'n/a',
  docs,
  stopReason: stopReason || 'incomplete',
  note: converged
    ? 'All gates green. Final sign-off still needs the user to see the evidence (VERIFIED DONE requires explicit user sign-off).'
    : `Stopped after ${round} round(s), reason: ${stopReason || 'incomplete'}. The orchestrator decides resume vs halt — see openFindings. Resume preserves completed work via resumeFromRunId.`,
}
