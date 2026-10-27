# Provider mocks

Official mocks of the providers that cannot be tested with a real credential on the dev-box or the UAT box: claude.ai (`anthropic-web`), chatgpt.com (`openai-web`), Azure OpenAI, AWS Bedrock and Google Vertex AI. They live in `tools/provider-mocks/` (Node, no dependencies) and are used by the automated tests (`test/provider-mocks.test.ts`) and by UAT.

## Start

```bash
npm run provider-mocks                    # http://127.0.0.1:4010
npm run provider-mocks -- --port 4020 --host 0.0.0.0
```

One server answers every provider (the paths do not collide). Create a connection per provider with `--endpoint <mock url>`:

```bash
routerly connections add --provider-id anthropic-web --label claude-mock --api-key mock-ok --endpoint http://127.0.0.1:4010
routerly connections add --provider-id bedrock --label bedrock-mock --aws-access-key-id mock-ok --aws-secret-access-key s --aws-region eu-west-1 --endpoint http://127.0.0.1:4010
```


## Behaviour is chosen by the credential

| Credential contains | Result |
|---|---|
| `mock-ok` (any `mock-*`) | Success, reply «Hello from the provider mock» (stream and non-stream) |
| `mock-429` | Rate limit, `Retry-After: 30` |
| `mock-403` | Forbidden (Cloudflare challenge page for chatgpt.com, AccessDenied for Bedrock) |
| `mock-401` | Unauthorized |
| `mock-500` | Server error |
| `mock-cut` | Stream interrupted after the first chunk |
| anything else | 401, so a real key never passes by accident |

The credential is the `sessionKey` (claude.ai), access token (chatgpt.com), `api-key` (Azure), AWS access key id (Bedrock) or bearer token (Vertex). `GET /__mock/requests` lists the requests received (secrets masked), `DELETE` clears them.

## What a mock proves — and what it does not

It proves the adapter → proxy → client path: request shape, stream and non-stream, error mapping, interrupted streams. It does not prove that a real credential or session is valid, nor Cloudflare or other anti-bot defences, nor the Google service-account token exchange (use an access token as the Vertex API key). Shapes come from the current AWS and Azure documentation; claude.ai and chatgpt.com have no public specification, so their mocks replicate what the adapters send and parse.

In UAT a case run only on the mock is recorded as **PASS (mock)** (UAT-04-47, UAT-04-48). It never turns the real-provider cases (UAT-04-23, 04-24, 04-26) into PASS.
