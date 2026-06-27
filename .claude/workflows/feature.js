export const meta = {
  name: 'feature',
  description: 'Routerly feature-delivery loop: plan, implement (backend/frontend), verify, design+pattern review, docs. Loops on findings.',
  whenToUse: 'Run with a feature description as args. Encodes .claude/rules/workflow.md as an executable subagent pipeline.',
  phases: [
    { title: 'Plan', detail: 'break the feature into surfaces + acceptance + boundary cases' },
    { title: 'Implement', detail: 'backend-developer then frontend-developer (parity handoff)' },
    { title: 'Verify', detail: 'qa-manager: tests, coverage >=98%, curl/CLI/browser boundary cases' },
    { title: 'Review', detail: 'ui-design-reviewer (if UI) + pattern-reviewer, in parallel' },
    { title: 'Docs', detail: 'docs agent updates every touched surface' },
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

const feature =
  typeof args === 'string' ? args : args && args.description ? args.description : ''

if (!hasWork(feature)) {
  log('No feature description in args. Invoke as: /feature "<what to build>".')
}

const MAX_ROUNDS = 5

// ---- 0. PLAN -------------------------------------------------------------

phase('Plan')
const plan = await agent(
  `You are planning a Routerly feature. Read CLAUDE.md and .claude/rules/workflow.md for the delivery loop and constraints.

Feature request:
${feature || '(none provided — infer nothing; report that the request is empty)'}

Produce the implementation brief: which surfaces it touches (service/cli/dashboard/docs), the concrete backend work (service/cli/shared) and frontend work (dashboard) — "none" if a side is untouched, the acceptance criteria, and the boundary cases that must be proven (empty data, 401, 400, 403 low-privilege, expired token). Do not write code.`,
  { agentType: 'Plan', schema: PLAN_SCHEMA, phase: 'Plan', label: 'plan' },
)

const touchesBackend =
  plan.surfaces.includes('service') || plan.surfaces.includes('cli') || hasWork(plan.backendWork)
const touchesDashboard = plan.surfaces.includes('dashboard') || hasWork(plan.frontendWork)

log(`Plan: ${plan.summary} | backend=${touchesBackend} dashboard=${touchesDashboard}`)

// ---- remediation loop: IMPLEMENT -> VERIFY -> REVIEW ---------------------

let outstanding = []
let verify = null
let review = null
let design = { findings: [] }
let backendSummary = '(no backend changes)'
let frontendSummary = '(no dashboard changes)'
let round = 0

while (round < MAX_ROUNDS) {
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
      { agentType: 'backend-developer', phase: 'Implement', label: `backend r${round}` },
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
      { agentType: 'frontend-developer', phase: 'Implement', label: `frontend r${round}` },
    )
  }

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
    { agentType: 'qa-manager', schema: VERIFY_SCHEMA, phase: 'Verify', label: `verify r${round}` },
  )

  // REVIEW (design only if UI touched) + pattern review, in parallel
  phase('Review')
  const reviews = await parallel(
    [
      touchesDashboard
        ? () =>
            agent(
              `Review the dashboard changes for this feature in a real browser (read-only). Theme (dark+light), consistency, component reuse, layout, states (loading/empty/error), responsive/collapsed sidebar, accessibility basics. Feature: ${feature}. Changes: ${frontendSummary}`,
              { agentType: 'ui-design-reviewer', schema: DESIGN_SCHEMA, phase: 'Review', label: `design r${round}` },
            )
        : null,
      () =>
        agent(
          `Read-only pre-merge audit of the current diff for this feature: security, project constraints, correctness, conventions, reuse/over-engineering, coverage, docs parity (CLAUDE.md + .claude/rules). Feature: ${feature}. Backend: ${backendSummary}. Dashboard: ${frontendSummary}.`,
          { agentType: 'pattern-reviewer', schema: REVIEW_SCHEMA, phase: 'Review', label: `review r${round}` },
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

  // Converged?
  const verifyOk = verify.status === 'VERIFIED DONE'
  const reviewOk = review.verdict === 'PASS' && blockers(review.findings).length === 0
  const designOk = blockers(design.findings).length === 0
  if (verifyOk && reviewOk && designOk) {
    log(`Converged in round ${round}.`)
    break
  }

  outstanding = [
    ...verify.failures,
    ...blockers(review.findings).map((f) => `${f.location || 'code'}: ${f.problem} -> ${f.fix}`),
    ...blockers(design.findings).map((f) => `UI: ${f.note}`),
  ]
  log(`Round ${round}: ${outstanding.length} blocker(s) -> remediating.`)
  if (round >= MAX_ROUNDS) log(`Hit MAX_ROUNDS (${MAX_ROUNDS}); stopping with findings open.`)
}

// ---- DOCS (every touched surface) ---------------------------------------

phase('Docs')
const docs = await agent(
  `Update docs/ for this Routerly feature on EVERY surface it touches (API/service + CLI + dashboard). Dashboard docs get a current screenshot via Chrome MCP. No stale images, no docs for removed features.

Feature: ${feature}
Surfaces: ${plan.surfaces.join(', ') || '(none)'}
Backend changes: ${backendSummary}
Dashboard changes: ${frontendSummary}`,
  { agentType: 'docs', phase: 'Docs', label: 'docs' },
)

// ---- synthesis -----------------------------------------------------------

const converged =
  verify && verify.status === 'VERIFIED DONE' && review && review.verdict === 'PASS'

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
  note: converged
    ? 'All gates green. Final sign-off still needs the user to see the evidence (VERIFIED DONE requires explicit user sign-off).'
    : `Did not fully converge in ${round} round(s). See openFindings.`,
}
