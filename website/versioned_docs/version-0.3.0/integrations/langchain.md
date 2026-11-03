---
title: LangChain
sidebar_label: LangChain
---

# LangChain

[LangChain](https://langchain.com) is a framework for building LLM-powered applications — chains, agents, RAG pipelines, and more. Both the Python and JavaScript versions use the OpenAI or Anthropic client under the hood, so they work with Routerly without any framework-specific changes.

---

## Install

```bash
# Python
pip install langchain langchain-openai langchain-anthropic

# JavaScript / TypeScript
npm install langchain @langchain/openai
```

---

## Configure

Pass the Routerly base URL and project token when initialising the ChatOpenAI model:

```python title="Python"
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-5-mini",
    base_url="http://localhost:3000/v1",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)
```

```typescript title="JavaScript / TypeScript"
import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
  model: "gpt-5-mini",
  configuration: {
    baseURL: "http://localhost:3000/v1",
    apiKey: "sk-rt-YOUR_PROJECT_TOKEN",
  },
});
```

To use Anthropic models via the Anthropic SDK + LangChain:

```python title="Python (Anthropic)"
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    model="claude-haiku-4-5",
    anthropic_api_url="http://localhost:3000",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)
```

---

## Usage

Use `llm` in any LangChain chain, agent, or LCEL expression as you normally would:

```python
from langchain_core.messages import HumanMessage

response = llm.invoke([HumanMessage(content="Explain LangChain in one sentence.")])
print(response.content)
```

Every call goes through Routerly. Retries, failover, and cost tracking are handled transparently.
