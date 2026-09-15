# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `zai_usage` tool: agent-callable quota report (percentage used + reset time), with optional `refresh` parameter to bypass the 60-second cache. Works in headless sessions and on non-Z.ai providers (returns a diagnostic message instead of failing).

## [0.1.0] - 2026-05-22

### Added

- Initial release: Z.ai API quota monitor extension for pi-coding-agent.
- Fetches token quota from `GET https://api.z.ai/api/monitor/usage/quota/limit`.
- Publishes usage percentage and reset time to UI status bar via `ctx.ui.setStatus()`.
- 60-second response cache to reduce API calls.
- Listens to `session_start`, `model_select`, `turn_end`, and `session_shutdown` events.
