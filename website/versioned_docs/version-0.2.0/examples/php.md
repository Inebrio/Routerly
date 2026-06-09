---
title: PHP
sidebar_label: PHP
---

# PHP

---

## openai-php/client

[openai-php/client](https://github.com/openai-php/client) is a community-maintained PHP SDK with full OpenAI API support.

```bash
composer require openai-php/client
```

```php
<?php

require 'vendor/autoload.php';

$client = OpenAI::factory()
    ->withBaseUri('http://localhost:3000/v1')
    ->withApiKey('sk-rt-YOUR_PROJECT_TOKEN')
    ->make();

// Non-streaming
$response = $client->chat()->create([
    'model'    => 'gpt-5-mini',
    'messages' => [
        ['role' => 'user', 'content' => 'Hello from PHP!'],
    ],
]);

echo $response->choices[0]->message->content;

// Streaming
$stream = $client->chat()->createStreamed([
    'model'    => 'gpt-5-mini',
    'messages' => [
        ['role' => 'user', 'content' => 'Tell me a story.'],
    ],
]);

foreach ($stream as $response) {
    echo $response->choices[0]->delta->content;
}
```

---

## Raw HTTP (Guzzle)

```bash
composer require guzzlehttp/guzzle
```

```php
<?php

require 'vendor/autoload.php';

use GuzzleHttp\Client;

$http = new Client();

$response = $http->post('http://localhost:3000/v1/chat/completions', [
    'headers' => [
        'Authorization' => 'Bearer sk-rt-YOUR_PROJECT_TOKEN',
        'Content-Type'  => 'application/json',
    ],
    'json' => [
        'model'    => 'gpt-5-mini',
        'messages' => [
            ['role' => 'user', 'content' => 'Hello from Guzzle!'],
        ],
    ],
]);

$data = json_decode($response->getBody(), true);
echo $data['choices'][0]['message']['content'];
```

---

## Raw HTTP (curl — no dependencies)

```php
<?php

$payload = json_encode([
    'model'    => 'gpt-5-mini',
    'messages' => [['role' => 'user', 'content' => 'Hello!']],
]);

$ch = curl_init('http://localhost:3000/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN',
    ],
]);

$body = curl_exec($ch);
curl_close($ch);

$data = json_decode($body, true);
echo $data['choices'][0]['message']['content'];
```
