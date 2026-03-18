# CLI

The Routerly CLI (`routerly`) is the primary administration tool. It communicates with a running
Routerly service over its REST API and provides scripting-friendly, terminal-based access to all
management operations.

---

## Installation

The CLI lives in `packages/cli/` and is invoked via:

```bash
node --import tsx/esm packages/cli/src/index.ts <command>
```

For convenience, add an alias to your shell profile:

```bash
# ~/.zshrc or ~/.bashrc
alias routerly='node --import tsx/esm /path/to/routerly/packages/cli/src/index.ts'
```

Then reload your shell:
```bash
source ~/.zshrc
```

Now you can use:
```bash
routerly model list
routerly project add --name "My App" ...
```

---

## Connecting to a Server

The CLI authenticates against a running Routerly service. Before running management commands,
log in with your dashboard credentials:

```bash
routerly auth login --url http://localhost:3000 \
  --email admin@example.com \
  --password your-password
```

The session token is saved locally under `~/.routerly/cli/accounts.json` and reused for
subsequent commands. Multiple server accounts can be managed and switched between.

---

## Quick Reference

```
routerly auth login|logout|list|use|whoami

routerly model list
routerly model add   --id <id> --provider <provider> [options]
routerly model remove <id>

routerly project list
routerly project add            --name <n> --slug <s> --routing-model <id> [options]
routerly project remove         <slug|id>
routerly project add-model      --project <slug> --model <id> [options]

routerly user list
routerly user add               --email <email> --password <pw>
routerly user remove            <email>

routerly role list
routerly role define            --name <name> --permissions <list>

routerly report usage           [--period daily|weekly|monthly|all] [--project <id>]
routerly report calls           [--limit <n>] [--project <id>]

routerly service status
routerly service configure      [--port <n>] [--host <h>] [--dashboard true|false]

routerly start
```

---

## See Also

- [Commands Reference](commands.md) — full documentation for every command and option
