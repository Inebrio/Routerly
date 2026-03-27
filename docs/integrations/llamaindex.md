---
title: LlamaIndex
sidebar_label: LlamaIndex
---

# LlamaIndex

[LlamaIndex](https://llamaindex.ai) is a data framework for building LLM applications over custom data — RAG, document parsing, agent workflows, and structured data extraction. It supports OpenAI-compatible endpoints natively.

---

## Install

```bash
# Python
pip install llama-index llama-index-llms-openai

# TypeScript
npm install llamaindex
```

---

## Configure

```python title="Python"
from llama_index.llms.openai import OpenAI

llm = OpenAI(
    model="gpt-5-mini",
    api_base="http://localhost:3000/v1",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)
```

To set Routerly as the global default so every index and query engine uses it automatically:

```python
from llama_index.core import Settings

Settings.llm = OpenAI(
    model="gpt-5-mini",
    api_base="http://localhost:3000/v1",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)
```

```typescript title="TypeScript"
import { OpenAI, Settings } from "llamaindex";

Settings.llm = new OpenAI({
  model: "gpt-5-mini",
  additionalSessionOptions: {
    baseURL: "http://localhost:3000/v1",
    apiKey: "sk-lr-YOUR_PROJECT_TOKEN",
  },
});
```

---

## Usage

Build your index and query normally:

```python
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

documents = SimpleDirectoryReader("./data").load_data()
index = VectorStoreIndex.from_documents(documents)
query_engine = index.as_query_engine()

response = query_engine.query("What is the main topic of these documents?")
print(response)
```

All LLM calls from LlamaIndex — retrieval, synthesis, re-ranking — flow through Routerly.
