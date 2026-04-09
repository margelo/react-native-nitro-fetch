# `nitro-fetch` agent skill

A single, on-demand skill for AI coding assistants (and humans) who are working in a project that uses the `react-native-nitro-fetch` family of packages.

Each agent loads one thing — `skills/nitro-fetch/SKILL.md` — and reads the matching file from `references/` on demand when a question comes up. No per-topic picking, no copying files into your repo.

## What the skill covers

The agent routes the user's question to one of these `references/*.md` files:

| Topic | Reference |
|---|---|
| Warming the native cache (`prefetch`, `prefetchOnAppStart`) | [`prefetching.md`](./nitro-fetch/references/prefetching.md) |
| Pointing `globalThis.fetch` / `globalThis.WebSocket` at nitro | [`replace-global.md`](./nitro-fetch/references/replace-global.md) |
| Native UTF-8 `TextDecoder` | [`text-decoder.md`](./nitro-fetch/references/text-decoder.md) |
| Opening WebSockets before React Native boots | [`websocket-prewarm.md`](./nitro-fetch/references/websocket-prewarm.md) |
| The `NitroWebSocket` class, including `wss://` | [`using-websockets.md`](./nitro-fetch/references/using-websockets.md) |
| Migrating from React Native's `WebSocket` | [`migrate-from-rn-ws.md`](./nitro-fetch/references/migrate-from-rn-ws.md) |
| In-process `NetworkInspector` for HTTP and WS | [`network-inspector.md`](./nitro-fetch/references/network-inspector.md) |
| Native Perfetto / Instruments + Hermes profiler | [`perfetto-profiling.md`](./nitro-fetch/references/perfetto-profiling.md) |
| Plugging nitro-fetch into axios (full adapter) | [`axios-adapter.md`](./nitro-fetch/references/axios-adapter.md) |

## Install it in your agent

Pick one. Each is a single command — no scripts, no file copying.

### Claude Code

```bash
/plugin marketplace add margelo/react-native-nitro-fetch
/plugin install nitro-fetch@react-native-nitro-fetch
```

After install, you can invoke the skill explicitly with `/nitro-fetch` in any conversation, or just ask a nitro-fetch question — Claude Code matches the skill's frontmatter description automatically.

### Cursor

In **Settings → Rules → Import rules from GitHub**, paste:

```
https://github.com/margelo/react-native-nitro-fetch.git
```

Cursor pulls the `skills/nitro-fetch/` folder and surfaces it as an MDC rule.

### Gemini CLI

```bash
gemini skills install https://github.com/margelo/react-native-nitro-fetch.git
```

Add `--scope workspace` to install the skill only for the current repo.

### OpenAI Codex / ChatGPT

```bash
npx codex-plugin add margelo/react-native-nitro-fetch
```

### OpenCode

```bash
git clone https://github.com/margelo/react-native-nitro-fetch.git /tmp/nitro-fetch \
  && cp -r /tmp/nitro-fetch/skills/nitro-fetch .opencode/skill/
```

### Any other agent (Cline, Continue, Aider, Open-WebUI, …)

Every tool that accepts a system prompt can load this skill. Point it at:

```
https://raw.githubusercontent.com/margelo/react-native-nitro-fetch/main/skills/nitro-fetch/SKILL.md
```

The `SKILL.md` router is small and tells the agent which `references/*.md` to read for each question — so you don't need to preload all of them.

## How "on demand" works

`skills/nitro-fetch/SKILL.md` is a **router**, not a dump. It's small — just a mental model, a problem → reference table, and verification tips — so it can stay loaded in every conversation cheaply. When the agent gets a specific question (*"how do I prewarm a wss connection?"*), it reads exactly one file from `references/` and answers from that.

You get the skill with one install command; you never choose which sub-skills to enable.

## Verifying it took

Ask the agent something the skill covers, e.g.:

> *How do I prewarm a wss connection in this repo?*

Correct answer cites `prewarmOnAppStart` and the Android `Application.onCreate` wiring via `NitroWebSocketPrewarmer`. Wrong answer invents an `install()` or `setup()` helper that doesn't exist.

## Contributing a new topic

1. Add a new file under `skills/nitro-fetch/references/<topic>.md`.
2. Add a row to the routing table in `skills/nitro-fetch/SKILL.md`.
3. Add a row to the table in this README.
4. Keep the new reference focused — if it grows past ~300 lines, split examples into a subfolder.

Do **not** create a new top-level skill — the whole point is that there's exactly one.
