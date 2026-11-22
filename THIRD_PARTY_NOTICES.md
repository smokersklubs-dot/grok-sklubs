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

## storytold/craft-anything — MIT OR Apache-2.0 (used under MIT)

- Source: https://github.com/storytold/craft-anything, commit `8cec25d02007db604b57ce6735ad4eb44a1a9948` (cloned 22/11/2026,
  read only, never run); the CLI behaviour read at tag `v0.6.1` (`48a9c5a60ff83ff620f98661339be6281a7debc6`).
- Adapted in `server/src/agent/engine-failure.ts`: the typed failure table of `crates/ai/src/failure.rs`
  (`TurnFailure::claude`, `from_api`) and the MCP init check of `crates/ai/src/cli_agents/adapters.rs`. Modified for
  Sklubot: rewritten in TypeScript, mapped onto Sklubot's failure classes, its own MCP server name and engine code.
- The "ArtCraft" name, wordmark and logos are not covered by the licence and are not used.
- Copyright notice and permission notice (MIT), as required:

```text
MIT License

Copyright (c) 2026 ArtCraft Team and the Craft Anything contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## affaan-m/ECC — MIT License

- Source: https://github.com/affaan-m/ECC, commit `4adeee6732a12d1540f49a4d50a38ce8c97f9a53` (sparse clone, 22/11/2026).
- Reused: the "CRITICAL" secret patterns of `agents/opensource-sanitizer.md`, rewritten as JavaScript RegExps in
  `server/src/secretformats.ts` (modified: value-only capture groups, word boundaries, Sklubot's secret kinds).
- Licence text (MIT):

```text
MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## milind-soni/OpenMausBot — Apache License 2.0 (ideas only, no code copied)

- Source: https://github.com/milind-soni/OpenMausBot, commit `35d044295697ef2b79b889461af6902c85a1b456` (cloned 22/11/2026), Copyright 2026 Milind Soni and
  OpenMausBot contributors, Apache License 2.0.
- Used for: the per-bot limit of parallel threads with a smaller limit on the entry plan (`server/bot-thread-limits.ts`)
  and "one call per browser at a time" (`server/browser-lane.ts`). Sklubot's `server/src/agent/lanes.ts` and
  `server/src/agent/turnlocks.ts` are written from scratch (a lane per conversation thread with the main chat always
  free; a lease per turn on the screen and on files); they say so in their first lines.

## moby/profiles (Docker's default seccomp profile) — Apache License 2.0

- Source: https://github.com/moby/profiles, file `seccomp/default.json`, commit `a0fa70805f742f7da15b367770d802ea2a86c68b`
  (fetched 22/11/2026). Copyright Docker, Inc. and the Moby project authors.
- Licence: Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0 (full text in the upstream
  repository as `LICENSE`; the repository has no NOTICE file).
- Used in: `docker/desktop/seccomp-chromium.json`. Modified for Sklubot (L48): three rules added at the end, each with a
  `comment` saying so — `clone` with user, PID and network namespaces, `unshare` of a user namespace, `chroot` — so
  Chromium's own sandbox can start in the bots' computers. The 62 upstream rules are unchanged.
