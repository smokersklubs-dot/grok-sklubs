---
name: Prepare an app for the stores
description: Before a client's iOS or Android app is sent to the App Store or Google Play, or after a refusal - find the project, check it for the usual refusal causes, walk the checks only a person can do, write a fix plan ranked by severity, and give a verdict that is never "ready" while a critical point remains.
---

> Adapted from app-store-compliance (github.com/mjmirza/app-store-compliance, commit 943e855 of 12/08/2026, before its licence changed; © 2026 Mirza Iqbal; code MIT, content CC BY 4.0). Modified for Sklubot (2026-11-22): condensed into one method a Sklubot bot follows on the client's project in its own computer; the original scripts, data files and monitors are not included (the bot checks by reading the project and the stores' own pages); translated into French. The stores' rules change: always check the current official pages.

# Prepare an app for the stores

For a client's mobile app (iOS, Android, Expo, Flutter, Capacitor) about to be sent to the App Store or Google Play, or just refused. This is a decision aid, not legal advice; the stores decide.

## 1. Find the project and the rules

- The project's folder (ask the owner for it, or the repository the bot was given), its platforms and the app's type (games, health, finance, kids, social with user posts, AI that generates content…).
- The rules: read the current official pages with web_fetch, never from memory: Apple's App Store Review Guidelines (developer.apple.com/app-store/review/guidelines/) and Google Play's Developer Program Policies (support.google.com/googleplay/android-developer). Note the date you read them.

## 2. Check the project (reading it, without changing it)

Look in the files for the usual refusal causes and list each finding with its file:
- account creation without a way to delete the account from inside the app;
- a login screen with no demo account written for the reviewers;
- payments for digital content that bypass the store's own purchase system where it is required;
- permissions (camera, location, contacts, microphone) without a clear reason shown to the user;
- an AI that generates content with no way to report a shocking answer;
- user posts with no reporting, blocking and moderation;
- links to a privacy policy that is missing or broken; Apple's privacy manifest (`PrivacyInfo.xcprivacy`) missing on iOS;
- an Android target API level below what Google Play currently requires;
- unfinished screens, placeholder texts, "beta" or test words, crashes you can reproduce.

## 3. The checks only a person can do

Ask the owner (or check with them) — each answer goes in the report:
- Is the server live, and will it stay up during the whole review?
- Is a working demo account written in the notes for the reviewers?
- Do Apple's privacy labels and Google's Data safety form match what the app really does, **including every third-party library**? (The biggest cause of refusals on both stores.)
- Do the screenshots show the app in use, not a splash or login screen? Does the listing promise only what the app does?
- New personal Google account: has the closed test (12 testers for 14 days) been completed?
- Age rating questions answered; for users in the EU, the US or elsewhere, the local rules (AI disclosure, accessibility, children's privacy, age checks) — the stores do not check these.

## 4. The fix plan

One row per finding: severity (critical, high, medium), platform, the rule cited (number and link), the concrete fix, the file or setting to change. Critical first. Every critical point blocks the release.

## 5. The verdict

- **Ready to send** only when no critical point remains. **Never write "ready" while a critical point remains**, even if the owner is in a hurry: say "blocked" and list what is left, numbered.
- **Not checked**: what you could not check (no access, no answer) is said as such, never counted as passed.
- Sending the app (uploading a build, submitting for review) is the owner's act, or needs their approval each time.

## 6. After a refusal

Read the exact rule number the store cited, fix that cause first, explain the fix in the reply to the reviewer, and never send the same build again unchanged (on Google Play a careless resubmission can lead to the account being suspended). The two checks that solve most refusals: a working demo account with a live server, and privacy declarations that match the app.
