# pi-zai-usage

> A lightweight [pi coding agent](https://pi.dev) extension that monitors your Z.ai token quota in real time and displays a color-coded progress bar in the terminal footer via [pi-powerline](https://github.com/harms-haus/pi-powerline).

## Features

- Fetches Z.ai token quota usage from the official API
- Displays a color-coded progress bar in the pi-powerline footer (Line 2, right-aligned)
- Caches responses for 60 seconds to minimize API calls
- Automatically activates only when a Z.ai provider is selected
- Exposes a `zai_usage` tool the agent itself can call to check remaining quota
- Exposes an `openrouter_usage` tool reporting OpenRouter key quota, spend, and prepaid credit balance
- Gracefully handles network errors, missing API keys, and headless sessions

## Installation

```bash
pi install git:github.com/harms-haus/pi-zai-usage
```

Then restart pi or run `/reload`.

## How It Works

When a Z.ai model is selected (provider name starts with `"zai"`), this extension:

1. Fetches your current token quota from `GET https://api.z.ai/api/monitor/usage/quota/limit`
2. Extracts the `TOKENS_LIMIT` entry from the response
3. Publishes the usage percentage and reset time to the UI via `ctx.ui.setStatus()`

The published status is consumed by [pi-powerline](https://github.com/harms-haus/pi-powerline), which renders it as a color-coded progress bar on footer **Line 2**, right-aligned.

### Caching

Responses are cached for **60 seconds**. Within the TTL, cached data is returned immediately without an API call. The cache is cleared when the selected provider changes (e.g., switching from Z.ai to another provider). Switching between Z.ai models preserves the cache.

## Agent Tool

The extension registers a `zai_usage` tool that the LLM can invoke during a session:

| Parameter | Type    | Description                                                        |
| --------- | ------- | ------------------------------------------------------------------ |
| `refresh` | `bool?` | Force a fresh API fetch instead of using the cache (default: `false`) |

The tool returns a plain-text report, e.g. `Z.AI token quota: 62.5% used, resets (2h 15m @ 10:20 am).` It works without a UI and reports a clear message when the active provider is not Z.ai or no API key is configured.

### openrouter_usage

A second tool reports OpenRouter key usage, e.g. `OpenRouter key sk-or-v1-63e...85c: $3.24 used of $50.00 monthly limit ($46.76 remaining); today $0.00, week $0.38; prepaid credits: $46.75 left (used $0.25 / $47.00).` It queries `GET /api/v1/auth/key` (limit, remaining, daily/weekly/monthly spend) plus `GET /api/v1/credits` (prepaid balance, best-effort). The API key is read from pi's provider credentials for `openrouter`, falling back to the `OPENROUTER_API_KEY` environment variable.

## Events

The extension listens to the following pi lifecycle events:

| Event              | Behavior                                                                        |
| ------------------ | ------------------------------------------------------------------------------- |
| `session_start`    | Fetches and publishes usage data                                                |
| `model_select`     | Clears the cache if the provider changed, then fetches and publishes usage data |
| `turn_end`         | Fetches and publishes usage data (respects cache TTL)                           |
| `session_shutdown` | Clears the status display                                                       |

When no UI is available, all events return early. When the active provider is not Z.ai, the handlers clear any previously published status rather than fetching new data.

## Status Payload

The extension publishes under the status key `"zai-usage"`:

```json
{ "percentage": 42.5, "resetTimeMs": 1719360000000 }
```

| Field         | Type                  | Description                                                            |
| ------------- | --------------------- | ---------------------------------------------------------------------- |
| `percentage`  | `number`              | Token quota used, rounded to one decimal place and clamped to [0, 100] |
| `resetTimeMs` | `number \| undefined` | Unix timestamp (ms) when the quota resets                              |

## Requirements

- **Z.ai API key** — configure via `/login` for the `zai` provider in pi
- **pi-powerline** — renders the progress bar in the footer (optional; without it the status is still published but not displayed)

## Integration with pi-powerline

The progress bar is rendered by [pi-powerline](https://github.com/harms-haus/pi-powerline) on footer **Line 2**, right-aligned. Install both extensions for the full experience:

```bash
pi install git:github.com/harms-haus/pi-powerline
pi install git:github.com/harms-haus/pi-zai-usage
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and PR guidelines.
