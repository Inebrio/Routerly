---
title: Go
sidebar_label: Go
---

# Go

---

## go-openai

[go-openai](https://github.com/sashabaranov/go-openai) is the most popular OpenAI client for Go.

```bash
go get github.com/sashabaranov/go-openai
```

```go
package main

import (
	"context"
	"fmt"

	openai "github.com/sashabaranov/go-openai"
)

func main() {
	config := openai.DefaultConfig("sk-rt-YOUR_PROJECT_TOKEN")
	config.BaseURL = "http://localhost:3000/v1"
	client := openai.NewClientWithConfig(config)

	// Non-streaming
	resp, err := client.CreateChatCompletion(
		context.Background(),
		openai.ChatCompletionRequest{
			Model: "gpt-5-mini",
			Messages: []openai.ChatCompletionMessage{
				{Role: openai.ChatMessageRoleUser, Content: "Hello from Go!"},
			},
		},
	)
	if err != nil {
		panic(err)
	}
	fmt.Println(resp.Choices[0].Message.Content)
}
```

### Streaming

```go
stream, err := client.CreateChatCompletionStream(
	context.Background(),
	openai.ChatCompletionRequest{
		Model: "gpt-5-mini",
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleUser, Content: "Tell me a story."},
		},
		Stream: true,
	},
)
if err != nil {
	panic(err)
}
defer stream.Close()

for {
	response, err := stream.Recv()
	if err != nil {
		break
	}
	fmt.Print(response.Choices[0].Delta.Content)
}
```

---

## Raw HTTP (net/http)

No external dependencies.

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func main() {
	payload, _ := json.Marshal(map[string]any{
		"model": "gpt-5-mini",
		"messages": []map[string]string{
			{"role": "user", "content": "Hello from net/http!"},
		},
	})

	req, _ := http.NewRequest(
		"POST",
		"http://localhost:3000/v1/chat/completions",
		bytes.NewBuffer(payload),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer sk-rt-YOUR_PROJECT_TOKEN")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Println(string(body))
}
```
