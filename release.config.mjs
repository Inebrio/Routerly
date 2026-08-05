export default {
  branches: ['main', { name: 'develop', channel: 'next' }],
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', {
      preset: 'conventionalcommits',
      presetConfig: {
        types: [
          { type: 'feat',     section: 'Features' },
          { type: 'fix',      section: 'Bug Fixes' },
          { type: 'perf',     section: 'Performance' },
          { type: 'docs',     section: 'Documentation' },
          { type: 'refactor', section: 'Refactor' },
          { type: 'chore',    hidden: true },
          { type: 'ci',       hidden: true },
          { type: 'build',    hidden: true },
          { type: 'test',     hidden: true },
          { type: 'style',    hidden: true },
          { type: 'revert',   hidden: true },
        ],
      },
    }],
    ['@semantic-release/exec', {
      prepareCmd:
        'npm version ${nextRelease.version} --workspaces --include-workspace-root --no-git-tag-version --ignore-scripts' +
        ' && node scripts/sync-module-versions.mjs' +
        ' && node scripts/sync-module-versions.mjs --check',
      publishCmd:
        'git add package.json package-lock.json packages/*/package.json packages/service/src' +
        ' && git archive --format=tar.gz --prefix=routerly-${nextRelease.version}/' +
        ' --output=routerly-${nextRelease.version}.tar.gz $(git write-tree)',
    }],
    ['@semantic-release/github', {
      assets: [
        { path: 'routerly-*.tar.gz' },
        { path: 'scripts/install.sh' },
        { path: 'scripts/install.ps1' },
        { path: 'scripts/install.mjs' },
      ],
    }],
    ['@semantic-release/exec', {
      addChannelCmd: 'gh release edit ${nextRelease.gitTag} --latest',
    }],
    // RC-2: single source of the branch → channel → docker-tag mapping the
    // release-pipeline.yml workflow's downstream jobs key off of. That hook
    // — and nothing else — is what distinguishes a build from a re-tag.
    ['@semantic-release/exec', {
      publishCmd:
        'node scripts/ci-release-output.mjs publish ${nextRelease.version} ${nextRelease.gitTag} ${branch.name}',
      addChannelCmd:
        'node scripts/ci-release-output.mjs addChannel ${nextRelease.version} ${nextRelease.gitTag} ${branch.name}',
    }],
  ],
};
