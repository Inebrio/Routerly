# Security Policy

## Supported Versions

| Version | Supported |
|---------|:---------:|
| Latest  | ✅        |

Only the latest release receives security fixes. We recommend always running the most recent version.

---

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Use [GitHub Security Advisories](https://github.com/Inebrio/Routerly/security/advisories/new) to report a vulnerability privately.
You can also email **carlo.satta@routerly.ai** with subject line `[SECURITY]`.

We aim to acknowledge reports within **48 hours** and provide a resolution timeline within **7 days**.

---

## Supply Chain Security

### Routerly does not depend on `litellm`

Routerly is a **pure TypeScript / Node.js** project. It has no Python dependencies and **does not use the `litellm` PyPI package** in any form — not as a direct dependency, not as a transitive one, and not at runtime.

`litellm` appears only in README and documentation tables as a competitor comparison. Users running Routerly alongside other Python-based tools (e.g., a `litellm` proxy on the same machine) should audit those tools independently.

For reference, the incident that prompted this note: the `litellm` PyPI package version 1.59.8 contained a backdoor that exfiltrated LLM API keys via environment variables. Routerly was not affected.

### npm dependency integrity

Routerly's Docker image is built using `npm ci`, which requires a `package-lock.json` and exits if it is out of sync with `package.json`. This ensures all installed packages match the exact versions and checksums recorded in the lockfile — no unexpected package upgrades during CI or image builds.

To verify your local install:
```bash
npm audit
```

---

## Security Practices

| Control | Details |
|---------|---------|
| **API key storage** | Provider API keys are stored in `~/.routerly/config/models.json` (filesystem-local, no external service). Access to that file equals access to the keys — secure your host filesystem accordingly. |
| **Password hashing** | Dashboard user passwords are hashed before storage. |
| **Per-project token isolation** | Each project has a unique Bearer token; compromise of one does not affect others |
| **Non-root container** | The Docker image runs as a dedicated `routerly` user with no root privileges |
| **No external infrastructure** | Routerly stores config locally in JSON files — no database, no Redis, no external service to compromise |
| **Webhook SSRF protection** | Notification webhook URLs are validated to block private/loopback addresses (RFC-1918, 127.x, fe80:, cloud metadata services) |

---

## Scope

The following are **in scope** for security reports:

- Authentication or authorisation bypass in the management API or dashboard
- Injection vulnerabilities (prompt injection leading to key exfiltration, SSRF, etc.)
- Exposure of encrypted secrets through the API or file system
- Dependency vulnerabilities with a credible exploit path

The following are **out of scope**:

- Vulnerabilities in provider SDKs or upstream packages without a demonstrated exploit path in Routerly
- Self-XSS in the dashboard
- Issues requiring physical access to the server
