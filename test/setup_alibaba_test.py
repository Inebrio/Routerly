#!/usr/bin/env python3
"""
Setup e test integrazione Routerly <-> Alibaba DashScope.
Uso: python3 test/setup_alibaba_test.py
"""
import json, urllib.request, urllib.error, base64, sys

BASE = "http://localhost:3000"
ADMIN_EMAIL = "info@routerly.ai"
ADMIN_PASSWORD = "C4m4ll0!"
DASHSCOPE_KEY = "sk-41c27074f7a54378a8cecd28763785cc"
DASHSCOPE_ENDPOINT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

def req(method, path, body=None, token=None, bearer_type="session"):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  [HTTP {e.code}] {method} {path}: {body}")
        return None

def sep(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)

# ── 1. Login ─────────────────────────────────────────────────────────────────
sep("1. Login admin")
resp = req("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
if not resp or not resp.get("token"):
    print("ERRORE: login fallito")
    sys.exit(1)
session = resp["token"]
print(f"  OK  token: {session[:30]}...")

# ── 2. Crea modelli ───────────────────────────────────────────────────────────
sep("2. Crea modelli Alibaba DashScope")

models_to_create = [
    {
        "id": "alibaba/qwen-vl-plus",
        "name": "Qwen VL Plus (Alibaba)",
        "provider": "custom",
        "endpoint": DASHSCOPE_ENDPOINT,
        "apiKey": DASHSCOPE_KEY,
        "upstreamModelId": "qwen-vl-plus",
        "contextWindow": 32000,
        "capabilities": {"vision": True, "functionCalling": True, "json": True},
        "cost": {"input": 0.0004, "output": 0.0012},
    },
    {
        "id": "alibaba/qwen-plus",
        "name": "Qwen Plus (Alibaba)",
        "provider": "custom",
        "endpoint": DASHSCOPE_ENDPOINT,
        "apiKey": DASHSCOPE_KEY,
        "upstreamModelId": "qwen-plus",
        "contextWindow": 131072,
        "capabilities": {"vision": False, "functionCalling": True, "json": True},
        "cost": {"input": 0.0004, "output": 0.0012},
    },
]

created_model_ids = []
for m in models_to_create:
    # Controlla se esiste già
    existing = req("GET", f"/api/models/{m['id']}", token=session)
    if existing:
        print(f"  SKIP  {m['id']} (già presente)")
        created_model_ids.append(m["id"])
        continue
    r = req("POST", "/api/models", m, token=session)
    if r:
        print(f"  OK    {m['id']}")
        created_model_ids.append(m["id"])
    else:
        print(f"  FAIL  {m['id']}")

# ── 3. Crea progetto ──────────────────────────────────────────────────────────
sep("3. Crea progetto 'alibaba-test'")

PROJECT_NAME = "alibaba-test"
existing_projects = req("GET", "/api/projects", token=session) or []
project = next((p for p in existing_projects if p.get("name") == PROJECT_NAME), None)

if project:
    print(f"  SKIP  progetto '{PROJECT_NAME}' già esistente (id: {project['id']})")
else:
    r = req("POST", "/api/projects", {
        "name": PROJECT_NAME,
        "models": [{"modelId": mid} for mid in created_model_ids],
        "timeoutMs": 30000,
    }, token=session)
    if r:
        project = r.get("project") or r
        print(f"  OK    progetto creato (id: {project.get('id', '?')})")
        if r.get("token"):
            print(f"  token API: {r['token']}")
    else:
        print("  FAIL creazione progetto")
        sys.exit(1)

project_id = project.get("id") or project.get("projectId")

# Aggiorna i modelli del progetto se già esistente ma potrebbe non averli
if project:
    r = req("PUT", f"/api/projects/{project_id}", {
        "name": PROJECT_NAME,
        "models": [{"modelId": mid} for mid in created_model_ids],
        "timeoutMs": 30000,
    }, token=session)
    if r: print(f"  OK    modelli aggiornati nel progetto")

# ── 4. Crea token API per le chiamate di test ─────────────────────────────────
sep("4. Crea token API per il progetto")
token_resp = req("POST", f"/api/projects/{project_id}/tokens", {"labels": ["alibaba-test"]}, token=session)
if not token_resp or not token_resp.get("token"):
    # Prova con tutti i token esistenti
    proj_detail = req("GET", f"/api/projects/{project_id}", token=session) or {}
    tokens = proj_detail.get("tokens", [])
    if tokens:
        api_token = None  # Non abbiamo il token completo, solo snippet
        print(f"  INFO  token esistente snippet: {tokens[0].get('tokenSnippet')}... (non recuperabile, creane uno nuovo)")
        token_resp = req("POST", f"/api/projects/{project_id}/tokens", {"labels": ["test2"]}, token=session)

if token_resp and token_resp.get("token"):
    api_token = token_resp["token"]
    print(f"  OK    {api_token[:30]}...")
else:
    print("  FAIL  impossibile creare token")
    sys.exit(1)

# ── 5. Test: chiamata testo con qwen-plus ─────────────────────────────────────
sep("5. Test testo: qwen-plus via Routerly")
r = req("POST", "/v1/chat/completions", {
    "model": "alibaba/qwen-plus",
    "messages": [{"role": "user", "content": "Dimmi solo: ciao!"}],
    "max_tokens": 10,
}, token=api_token)
if r and r.get("choices"):
    content = r["choices"][0]["message"]["content"]
    model_used = r.get("model", "?")
    print(f"  OK    risposta: {repr(content)}")
    print(f"        model used: {model_used}")
    usage = r.get("usage", {})
    print(f"        tokens: {usage.get('total_tokens', '?')} ({usage.get('prompt_tokens','?')} in + {usage.get('completion_tokens','?')} out)")
else:
    print("  FAIL")

# ── 6. Test: chiamata vision con qwen-vl-plus ─────────────────────────────────
sep("6. Test vision: qwen-vl-plus + immagine base64 via Routerly")

# Scarica un'immagine di test
try:
    img_req = urllib.request.Request(
        "https://images.unsplash.com/photo-1529778873920-4da4926a72c2?w=100",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    img_data = urllib.request.urlopen(img_req, timeout=10).read()
    img_b64 = base64.b64encode(img_data).decode()
    print(f"  immagine scaricata: {len(img_data)} bytes")
except Exception as e:
    print(f"  WARN: impossibile scaricare immagine: {e}")
    img_b64 = None

if img_b64:
    r = req("POST", "/v1/chat/completions", {
        "model": "alibaba/qwen-vl-plus",
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "Descrivi questa immagine in una frase breve."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
        ]}],
        "max_tokens": 40,
    }, token=api_token)
    if r and r.get("choices"):
        content = r["choices"][0]["message"]["content"]
        model_used = r.get("model", "?")
        print(f"  OK    risposta: {repr(content)}")
        print(f"        model used: {model_used}")
        usage = r.get("usage", {})
        print(f"        tokens: {usage.get('total_tokens','?')} ({usage.get('prompt_tokens','?')} in + {usage.get('completion_tokens','?')} out)")
    else:
        print("  FAIL")

sep("COMPLETATO")
print(f"  Progetto: {PROJECT_NAME} (id: {project_id})")
print(f"  Modelli:  {', '.join(created_model_ids)}")
print(f"  Token:    {api_token[:30]}...")
