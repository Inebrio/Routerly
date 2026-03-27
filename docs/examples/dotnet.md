---
title: C# / .NET
sidebar_label: C# / .NET
---

# C# / .NET

---

## OpenAI .NET SDK

The official [OpenAI .NET SDK](https://github.com/openai/openai-dotnet) supports custom endpoints.

```bash
dotnet add package OpenAI
```

```csharp
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

var client = new OpenAIClient(
    new ApiKeyCredential("sk-rt-YOUR_PROJECT_TOKEN"),
    new OpenAIClientOptions { Endpoint = new Uri("http://localhost:3000/v1") }
);

ChatClient chat = client.GetChatClient("gpt-5-mini");

// Non-streaming
ChatCompletion response = await chat.CompleteChatAsync(
    new UserChatMessage("Hello from .NET!")
);
Console.WriteLine(response.Content[0].Text);

// Streaming
await foreach (StreamingChatCompletionUpdate update in
    chat.CompleteChatStreamingAsync(new UserChatMessage("Tell me a story.")))
{
    foreach (ChatMessageContentPart part in update.ContentUpdate)
    {
        Console.Write(part.Text);
    }
}
```

---

## Raw HTTP (HttpClient)

```csharp
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

using var http = new HttpClient();
http.DefaultRequestHeaders.Authorization =
    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "sk-rt-YOUR_PROJECT_TOKEN");

var payload = new
{
    model    = "gpt-5-mini",
    messages = new[] { new { role = "user", content = "Hello from HttpClient!" } }
};

var response = await http.PostAsJsonAsync(
    "http://localhost:3000/v1/chat/completions",
    payload
);

using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
Console.WriteLine(doc.RootElement
    .GetProperty("choices")[0]
    .GetProperty("message")
    .GetProperty("content")
    .GetString());
```

---

## Streaming (HttpClient + SSE)

```csharp
using var request = new HttpRequestMessage(HttpMethod.Post,
    "http://localhost:3000/v1/chat/completions");
request.Headers.Authorization =
    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "sk-rt-YOUR_PROJECT_TOKEN");
request.Content = JsonContent.Create(new
{
    model    = "gpt-5-mini",
    messages = new[] { new { role = "user", content = "Tell me a story." } },
    stream   = true
});

using var response = await http.SendAsync(request,
    HttpCompletionOption.ResponseHeadersRead);
using var stream = await response.Content.ReadAsStreamAsync();
using var reader = new StreamReader(stream);

while (await reader.ReadLineAsync() is string line)
{
    if (!line.StartsWith("data: ") || line == "data: [DONE]") continue;
    var data = JsonDocument.Parse(line[6..]).RootElement;
    Console.Write(data.GetProperty("choices")[0]
        .GetProperty("delta")
        .GetProperty("content")
        .GetString());
}
```
