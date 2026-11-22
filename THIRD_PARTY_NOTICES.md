# Third-party notices

Sklubot is MIT-licensed (see `LICENSE`). Some files contain code adapted from other open-source projects whose
licences allow it; each such file says so in its first lines. This file keeps the notices those licences require.

## n8n-io/nod — Apache License 2.0

- Source: https://github.com/n8n-io/nod, commit `0f9de28af967ad6f7be12a3181edcef860216328` (cloned 22/11/2026).
- Licence: Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0 (the full text ships with the
  upstream repository as `LICENSE`).
- Never reused: `src/providers/local-speech/phonemizer-worker.ts` (GPL-3.0-or-later) and the speech components listed in
  upstream `desktop/licenses/speech.md`.
- Upstream NOTICE file, reproduced as required by section 4(d) of the licence:

```text
Nod
Copyright 2026 n8n GmbH

This product includes software developed at n8n GmbH (https://n8n.io/).

The local phoneme processor includes Spellophone and eSpeak NG under
GPL-3.0-or-later. Its source file src/providers/local-speech/phonemizer-worker.ts
is distributed under GPL-3.0-or-later. See desktop/licenses/speech.md for component
attribution and corresponding source. Desktop builds include the license and
verified source archives under engine/licenses/speech.

Agent Plugins 1.0.0 JSON Schemas
Source: https://github.com/agentplugins/agent-plugins-spec
Schemas in src/server/agent-plugins/ are distributed under Apache-2.0.
```

- Files of Sklubot that contain portions adapted from nod (each starts with a header naming the upstream files and what
  was modified):
  - `server/src/telegramplus.ts` — from `src/providers/chat-sdk/telegram.ts` (attachment picking, getFile download with
    the 20 MB limit and path checks).
  - `server/src/mcptransport.ts` — from `src/providers/discovered/remote.ts` (Streamable HTTP then HTTP+SSE fallback;
    owner-typed private address).
  - `server/src/agent/nodguidance.ts` — from `src/shared/conversation-style.ts`, `src/runtime/tools.ts`,
    `src/runtime/skills/nod/SKILL.md` (prompt sentences: conversation language, cadence, connector before local app,
    acting on a clear yes).
  - `server/src/routineplus.ts` — behaviour of `src/shared/schedule-timing.ts` and `src/server/schedules.ts` (late /
    skipped run track, preview, "run now" guard, approval of a whole saved instruction), rewritten.
  - `web/src/lib/messagecopy.ts` — from `src/web/lib/clipboard.ts` (`selectedText`, `copyContent`, table as
    tab-separated text).
