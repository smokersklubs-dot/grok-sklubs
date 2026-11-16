# Android UI polish — v1.2.0

This pass is intentionally additive and presentation-focused. It keeps the existing navigation, bot data, tasks,
chat cards, voice calls, remote computer, phone relay, background connection, settings, notifications, and account
flows intact.

## Visual direction

- Warm industrial neutral surfaces in light mode, deep graphite surfaces in dark mode.
- Sklubot orange is a restrained action accent, not a full-screen decoration.
- More consistent spacing, corner radii, typography hierarchy, touch targets, and pressed feedback.
- Bot identities and their individual colors remain unchanged.
- Existing French/English strings and system/light/dark theme preferences remain supported.

## Scope of this release

- Shared theme tokens and reusable controls.
- Main bottom navigation and its safe-area spacing.
- Bot list cards and task list cards.
- Android application version 1.2.0 (versionCode 3).

## Acceptance checklist

- [ ] No existing screen, tab, setting, bot, room, task, or action removed.
- [ ] Light and dark modes remain readable.
- [ ] French and English layouts remain legible on narrow phones.
- [ ] Buttons retain their original callbacks and disabled/busy behavior.
- [ ] Bottom navigation remains usable with gesture navigation and three-button navigation.
- [ ] Complete Android APK installs over the prior complete variant without clearing app data.
- [ ] Validate on a physical Samsung device before calling the release final.
