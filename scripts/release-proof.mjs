#!/usr/bin/env node
// Release gate: record and check the real-test proof that must exist before a
// published release is re-published or overwritten.
//
//   node scripts/release-proof.mjs record <X.Y.Z> --commit <sha> --evidence "<text>" [--env "<where>"] [--push]
//   node scripts/release-proof.mjs check  <X.Y.Z> [--commit <sha>] [--max-age-days 7]
//
// A proof is an annotated git tag `proof/vX.Y.Z/<sha12>`: it is bound to one
// version and one commit, so any other commit is refused. It is not under
// `v*`, so semantic-release ignores it.
import { execFileSync } from 'node:child_process'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fail = (m) => { console.error(`release-proof: ${m}`); process.exit(1) }

const [cmd, version, ...rest] = process.argv.slice(2)
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i < 0 ? d : rest[i + 1] }
if (!['record', 'check'].includes(cmd) || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  fail('usage: record|check <X.Y.Z> [--commit sha] [--evidence text] [--env where] [--push] [--max-age-days N]')
}
let commit
try { commit = git('rev-parse', `${opt('commit', 'HEAD')}^{commit}`) } catch { fail(`unknown commit ${opt('commit', 'HEAD')}`) }
const prefix = `proof/v${version}/`
const tag = `${prefix}${commit.slice(0, 12)}`

if (cmd === 'record') {
  const evidence = opt('evidence')
  if (!evidence || evidence.length < 10) fail('--evidence is required (what was tested, on which package/image, where)')
  const msg = JSON.stringify({ version, commit, env: opt('env', ''), evidence, recorded_at: new Date().toISOString() })
  git('tag', '-a', '-m', msg, tag, commit)
  if (rest.includes('--push')) git('push', 'origin', `refs/tags/${tag}`)
  console.log(`recorded ${tag}`)
} else {
  const maxDays = Number(opt('max-age-days', '7'))
  const info = git('tag', '-l', `${prefix}*`).split('\n').filter(Boolean).map((t) => {
    try { return { t, ...JSON.parse(git('tag', '-l', '--format=%(contents)', t)) } } catch { return { t } }
  })
  const mine = info.find((p) => p.commit === commit)
  if (!mine) {
    fail(`no real-test proof recorded for ${version} @ ${commit.slice(0, 12)}. ` +
      (info.length ? `Existing proofs are for other commits: ${info.map((p) => p.t.slice(prefix.length)).join(', ')}. ` : '') +
      `Test the published package/image in an isolated environment, then run: node scripts/release-proof.mjs record ${version} --commit ${commit} --evidence "..." --push`)
  }
  const age = (Date.now() - Date.parse(mine.recorded_at)) / 86_400_000
  if (!(age <= maxDays)) fail(`proof ${mine.t} is expired (recorded ${mine.recorded_at}, max age ${maxDays} days): repeat the real test and record it again`)
  console.log(`proof ok: ${mine.t} (${mine.recorded_at})`)
}
