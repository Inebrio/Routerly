---
title: Ruby
sidebar_label: Ruby
---

# Ruby

---

## ruby-openai gem

[ruby-openai](https://github.com/alexrudall/ruby-openai) is the most widely used OpenAI SDK for Ruby.

```bash
gem install ruby-openai
# or add to Gemfile: gem "ruby-openai"
```

```ruby
require "openai"

client = OpenAI::Client.new(
  access_token: "sk-lr-YOUR_PROJECT_TOKEN",
  uri_base: "http://localhost:3000/v1/",
)

# Non-streaming
response = client.chat(
  parameters: {
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Hello from Ruby!" }],
  }
)
puts response.dig("choices", 0, "message", "content")

# Streaming
client.chat(
  parameters: {
    model:    "gpt-5-mini",
    messages: [{ role: "user", content: "Tell me a story." }],
    stream:   proc { |chunk, _bytesize|
      print chunk.dig("choices", 0, "delta", "content")
    },
  }
)
```

---

## Raw HTTP (Net::HTTP — no dependencies)

```ruby
require "net/http"
require "uri"
require "json"

uri  = URI("http://localhost:3000/v1/chat/completions")
http = Net::HTTP.new(uri.host, uri.port)

request = Net::HTTP::Post.new(uri.path)
request["Content-Type"]  = "application/json"
request["Authorization"] = "Bearer sk-lr-YOUR_PROJECT_TOKEN"
request.body = JSON.generate(
  model:    "gpt-5-mini",
  messages: [{ role: "user", content: "Hello from Net::HTTP!" }]
)

response = http.request(request)
data = JSON.parse(response.body)
puts data.dig("choices", 0, "message", "content")
```

---

## Streaming (Net::HTTP)

```ruby
require "net/http"
require "uri"
require "json"

uri  = URI("http://localhost:3000/v1/chat/completions")
http = Net::HTTP.new(uri.host, uri.port)

request = Net::HTTP::Post.new(uri.path)
request["Content-Type"]  = "application/json"
request["Authorization"] = "Bearer sk-lr-YOUR_PROJECT_TOKEN"
request.body = JSON.generate(
  model:    "gpt-5-mini",
  messages: [{ role: "user", content: "Tell me a story." }],
  stream:   true
)

http.request(request) do |response|
  response.read_body do |chunk|
    chunk.split("\n").each do |line|
      next unless line.start_with?("data: ")
      data = line[6..]
      next if data == "[DONE]"
      parsed = JSON.parse(data) rescue next
      print parsed.dig("choices", 0, "delta", "content").to_s
    end
  end
end
```
