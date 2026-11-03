---
title: Rust
sidebar_label: Rust
---

# Rust

---

## async-openai

[async-openai](https://github.com/64bit/async-openai) is the most popular async OpenAI client for Rust.

```toml
# Cargo.toml
[dependencies]
async-openai = "0.27"
futures = "0.3"
tokio = { version = "1", features = ["full"] }
```

```rust
use async_openai::{
    config::OpenAIConfig,
    types::{ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs},
    Client,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = OpenAIConfig::new()
        .with_api_base("http://localhost:3000/v1")
        .with_api_key("sk-rt-YOUR_PROJECT_TOKEN");

    let client = Client::with_config(config);

    // Non-streaming
    let request = CreateChatCompletionRequestArgs::default()
        .model("gpt-5-mini")
        .messages([ChatCompletionRequestUserMessageArgs::default()
            .content("Hello from Rust!")
            .build()?
            .into()])
        .build()?;

    let response = client.chat().create(request).await?;
    println!("{}", response.choices[0].message.content.as_deref().unwrap_or(""));

    Ok(())
}
```

### Streaming

```rust
use async_openai::types::CreateChatCompletionRequestArgs;
use futures::StreamExt;

let request = CreateChatCompletionRequestArgs::default()
    .model("gpt-5-mini")
    .messages([ChatCompletionRequestUserMessageArgs::default()
        .content("Tell me a story.")
        .build()?
        .into()])
    .build()?;

let mut stream = client.chat().create_stream(request).await?;

while let Some(result) = stream.next().await {
    match result {
        Ok(response) => {
            for choice in &response.choices {
                if let Some(ref content) = choice.delta.content {
                    print!("{}", content);
                }
            }
        }
        Err(e) => eprintln!("Stream error: {e}"),
    }
}
```

---

## Raw HTTP (reqwest)

```toml
# Cargo.toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

```rust
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let body = json!({
        "model": "gpt-5-mini",
        "messages": [{"role": "user", "content": "Hello from reqwest!"}]
    });

    let response = client
        .post("http://localhost:3000/v1/chat/completions")
        .header("Authorization", "Bearer sk-rt-YOUR_PROJECT_TOKEN")
        .json(&body)
        .send()
        .await?;

    let data: serde_json::Value = response.json().await?;
    println!(
        "{}",
        data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
    );

    Ok(())
}
```
