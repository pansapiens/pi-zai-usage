# pi-zai-usage

Z.ai API quota monitor extension for [pi coding agent](https://pi.dev). Displays a progress bar in the [pi-powerline](https://github.com/harms-haus/pi-powerline) footer showing current Z.ai token quota usage.

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

Responses are cached for **30 seconds**. Within the TTL, cached data is returned immediately without an API call. The cache is cleared when the model selection changes.

## Events

The extension listens to the following pi lifecycle events:

| Event | Behavior |
|-------|----------|
| `session_start` | Fetches and publishes usage data |
| `model_select` | Clears the cache, then fetches and publishes usage data |
| `turn_end` | Fetches and publishes usage data (respects cache TTL) |
| `session_shutdown` | Clears the status display |

All events are no-ops when no UI is available or when the active provider is not Z.ai.

## Status Payload

The extension publishes under the status key `"zai-usage"`:

```json
{ "percentage": 42.5, "resetTimeMs": 1719360000000 }
```

| Field | Type | Description |
|-------|------|-------------|
| `percentage` | `number` | Token quota used, rounded to one decimal place |
| `resetTimeMs` | `number \| undefined` | Unix timestamp (ms) when the quota resets |

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
