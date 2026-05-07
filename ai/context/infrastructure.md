# Infrastructure

## Docker

### Image

- **Base**: `node:25-alpine` (multi-stage build)
- **Published**: `inebrio/routerly:latest`, `inebrio/routerly:vX.Y.Z`
- **Architectures**: `linux/amd64`, `linux/arm64`
- **Port**: `3000`
- **User**: `routerly:routerly` (non-root)
- **Volume**: `/data` (maps to `ROUTERLY_HOME=/data`)

### Build stages in `Dockerfile`

```
Stage 1 — builder (node:25-alpine)
  COPY monorepo root
  RUN npm ci
  RUN npm run build   # shared → service → cli → dashboard

Stage 2 — runner (node:25-alpine)
  COPY --from=builder /app/packages/service/dist
  COPY --from=builder /app/packages/dashboard/dist → served at /dashboard/
  COPY --from=builder /app/packages/cli/dist
  COPY --from=builder /app/node_modules
  RUN addgroup routerly && adduser -D -G routerly routerly
  USER routerly
  EXPOSE 3000
  CMD ["node", "packages/service/dist/index.js"]
```

### `docker-compose.yml`

```yaml
services:
  routerly:
    image: inebrio/routerly:latest
    ports:
      - "3000:3000"
    volumes:
      - routerly_data:/data
    environment:
      - ROUTERLY_HOME=/data
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  routerly_data:
```

---

## GitHub Actions

### `ci.yml` — triggered on push/PR to `main` and `develop`

Steps:
1. `npm ci`
2. `npm audit --audit-level=high` (security check)
3. `npm run build`
4. `npm run typecheck`
5. `npm test`

### `release.yml` — triggered on push to `main`

Steps:
1. Run CI checks
2. **Changesets action** — if there are pending changesets, creates a "Version Packages" PR; if merged, proceeds to release
3. `npm run build`
4. **Docker build + push** to Docker Hub (`inebrio/routerly`) — multi-arch `amd64` + `arm64` using `docker buildx`
5. **GitHub Release** — creates a release with `vX.Y.Z` tag and a tarball of built packages

Required secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `NPM_TOKEN` (for potential npm publish).

---

## Firebase Hosting (docs only)

`firebase.json` configures Firebase Hosting for the Docusaurus documentation site only.

- **Source**: `website/build/`
- **URL**: not part of the main Routerly service
- **Deploy**: manual (`firebase deploy`) or via CI — not part of `release.yml`
- The application service itself is **never** deployed to Firebase

---

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `ROUTERLY_HOME` | `~/.routerly/` | base directory for all data files |
| `NODE_ENV` | — | set to `production` to disable pino-pretty log output |
| `PORT` | `3000` | overrides the port in `settings.json` if set |

No `.env.example` file exists. Configuration is managed via JSON files through the CLI.
