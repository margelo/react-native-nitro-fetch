---
id: skills
title: Agent Skill
sidebar_position: 10
---

# Agent Skill

`react-native-nitro-fetch` ships a single agent skill — **`nitro-fetch`** — that teaches any AI coding assistant how to use this library correctly: `fetch`, prefetching, `NitroWebSocket`, pre-warming, migrating from React Native's built-in `WebSocket`, `NetworkInspector`, native tracing, `NitroTextDecoder`, and plugging nitro-fetch into axios via a custom adapter.

It loads on demand — the agent keeps a small router in context and only reads the relevant reference file when a matching question comes up.

## Install

Pick your agent. Each is a single command.

**Claude Code**

```bash
/plugin marketplace add margelo/react-native-nitro-fetch
/plugin install nitro-fetch@react-native-nitro-fetch
```

After install, invoke the skill explicitly in any conversation with:

```
/nitro-fetch
```

or just ask a nitro-fetch question and Claude Code will load the skill automatically from its description.

**Cursor** — Settings → Rules → *Import rules from GitHub* → paste `https://github.com/margelo/react-native-nitro-fetch.git`

**Gemini CLI**

```bash
gemini skills install https://github.com/margelo/react-native-nitro-fetch.git
```

**Codex / ChatGPT**

```bash
npx codex-plugin add margelo/react-native-nitro-fetch
```

**Any other agent** — point its system prompt at:

```
https://raw.githubusercontent.com/margelo/react-native-nitro-fetch/main/skills/nitro-fetch/SKILL.md
```

## Use

Once installed, just ask your agent questions in a project that uses nitro-fetch. It will route the question to the right reference file automatically, e.g.:

- *"How do I prewarm a wss connection?"*
- *"How do I make axios go through nitro-fetch?"*
- *"Why is my cold-start GET still slow after calling `prefetch`?"*

Correct answers cite the real APIs (`prefetchOnAppStart`, `prewarmOnAppStart`, `NitroWebSocket`, …) and point at files in the repo. If you get a made-up `install()` or `setup()` helper, the skill isn't loaded.

The source lives under [`skills/nitro-fetch/`](https://github.com/margelo/react-native-nitro-fetch/tree/main/skills/nitro-fetch) if you want to browse or contribute a new topic.
