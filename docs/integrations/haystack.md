---
title: Haystack
sidebar_label: Haystack
---

# Haystack

[Haystack](https://haystack.deepset.ai) by deepset is an open-source NLP framework for building production-ready RAG and Question Answering pipelines. Its `OpenAIChatGenerator` and `OpenAITextEmbedder` components accept a custom endpoint, making them fully compatible with Routerly.

---

## Install

```bash
pip install haystack-ai
```

---

## Configure

Pass the Routerly endpoint when constructing any OpenAI-based component:

```python
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.dataclasses import ChatMessage
from haystack.utils import Secret

generator = OpenAIChatGenerator(
    model="gpt-5-mini",
    api_base_url="http://localhost:3000/v1",
    api_key=Secret.from_token("sk-rt-YOUR_PROJECT_TOKEN"),
)
```

For embeddings:

```python
from haystack.components.embedders import OpenAITextEmbedder

embedder = OpenAITextEmbedder(
    model="text-embedding-3-small",
    api_base_url="http://localhost:3000/v1",
    api_key=Secret.from_token("sk-rt-YOUR_PROJECT_TOKEN"),
)
```

---

## Usage

Use the components in a Haystack `Pipeline` as usual:

```python
from haystack import Pipeline

pipeline = Pipeline()
pipeline.add_component("generator", generator)

result = pipeline.run({
    "generator": {
        "messages": [ChatMessage.from_user("Summarise the French Revolution in two sentences.")]
    }
})

print(result["generator"]["replies"][0].content)
```

All inference calls in the pipeline are routed through Routerly's engine.

:::tip
If your pipeline uses both a generator and an embedder, you can register both models in the same Routerly project and control costs and limits centrally.
:::
