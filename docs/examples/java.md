---
title: Java
sidebar_label: Java
---

# Java

Java does not have an official OpenAI SDK, but the standard `java.net.http` client (Java 11+) covers all use cases.

---

## Raw HTTP (java.net.http)

No external dependencies required.

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class RouterlyExample {

    private static final String BASE_URL = "http://localhost:3000/v1";
    private static final String API_KEY  = "sk-rt-YOUR_PROJECT_TOKEN";

    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        String body = """
            {
              "model": "gpt-5-mini",
              "messages": [{"role": "user", "content": "Hello from Java!"}]
            }
            """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(BASE_URL + "/chat/completions"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + API_KEY)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        HttpResponse<String> response =
            client.send(request, HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
        // Parse with Jackson / Gson to extract choices[0].message.content
    }
}
```

---

## With OkHttp

If you already use OkHttp in your project:

```java
// build.gradle
// implementation("com.squareup.okhttp3:okhttp:4.12.0")

import okhttp3.*;
import java.io.IOException;

public class RouterlyOkHttp {

    private static final MediaType JSON = MediaType.get("application/json");

    public static void main(String[] args) throws IOException {
        OkHttpClient client = new OkHttpClient();

        String json = """
            {
              "model": "gpt-5-mini",
              "messages": [{"role": "user", "content": "Hello from OkHttp!"}]
            }
            """;

        Request request = new Request.Builder()
            .url("http://localhost:3000/v1/chat/completions")
            .header("Authorization", "Bearer sk-rt-YOUR_PROJECT_TOKEN")
            .post(RequestBody.create(json, JSON))
            .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println(response.body().string());
        }
    }
}
```

---

## Streaming (SSE)

For streaming responses, consume the `InputStream` line by line:

```java
HttpRequest streamRequest = HttpRequest.newBuilder()
    .uri(URI.create(BASE_URL + "/chat/completions"))
    .header("Content-Type", "application/json")
    .header("Authorization", "Bearer " + API_KEY)
    .POST(HttpRequest.BodyPublishers.ofString("""
        {
          "model": "gpt-5-mini",
          "messages": [{"role": "user", "content": "Tell me a story."}],
          "stream": true
        }
    """))
    .build();

HttpResponse<java.io.InputStream> streamResponse =
    client.send(streamRequest, HttpResponse.BodyHandlers.ofInputStream());

try (var reader = new java.io.BufferedReader(
        new java.io.InputStreamReader(streamResponse.body()))) {
    String line;
    while ((line = reader.readLine()) != null) {
        if (line.startsWith("data: ") && !line.equals("data: [DONE]")) {
            System.out.println(line.substring(6)); // parse JSON delta here
        }
    }
}
```

:::tip
Use [Jackson](https://github.com/FasterXML/jackson) or [Gson](https://github.com/google/gson) to deserialise the JSON response body into a typed object.
:::
