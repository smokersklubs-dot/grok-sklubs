# Functional Specification 09 — Public "1.0" launch deltas

Sources (public only, fetched/viewed 2026-11-18): the launch announcement at `https://x.ai/news/grok-bot-1-0`, plus five public pages it links to (product overview, guide index, the guide about sharing a bot as a reusable package, the beginner guide, the bot gallery); and a 78-second promotional screen recording supplied by the owner (a phone capture of the announcement page playing its embedded launch film). The product changelog linked from the announcement refused access (HTTP 403) and was not read.

This document describes what the public "1.0" release adds or changes relative to what specs 01–08 already describe. Spec 04 is the earlier inventory of the same product's public documentation; most capabilities shown at launch (shared team agents, workplace-chat and meeting presence, action reviewer with plain-language rules, teach by demonstration, templates, gallery, pages, analytics) are already in spec 04 and are **not** repeated here. Only genuinely new behaviour, or a precision of an existing requirement, appears below. Existing requirements are cited as REQ-xxx (01), RKZ-xxx (02), OMB-xxx (03), DOC-xxx (04), HQ-xxx (05), U-xxx (06), A-n (07 / 08); new ones are V1-xxx.

Conventions

- Behavioural specification only, written in our own words. No wording, names, layouts, colours, images or code of the source are to be reused. Internal names are suggestions marked "(suggested)".
- Each requirement ends with its source: "Source: announcement" (the launch post), "Source: overview / guide-101 / guide-templates / gallery" (linked public pages), or "Source: video ~m:ss" (time in the 78 s recording). Observations from the video that could be read more than one way are marked "(observed, uncertain)".
- Launch marketing is vague on mechanics. Where a source only states an outcome, the requirement states the outcome and leaves the mechanism open; nothing below invents a mechanism the sources do not show.
- "Shared agent", "team", "manager", "collaborator" have the meaning of spec 04 (DOC-205–206). "Workplace chat" = the external team-chat apps of DOC-255–256. "Meeting" = an external video-call service of DOC-257.

---

## 1. Positioning of the release

- V1-001 **Three headline changes.** The release presents itself as moving from beta to general availability with three themes: (a) multi-person use ("teammates" shared by many people and present in workplace chat and video calls), (b) proactive work driven by the team's goals, and (c) more capable task execution (browser, documents, decks, collaborative pages, more connectors) with lower resource use per task. Everything in §2–§8 hangs off these three themes. Source: announcement; video ~0:00–0:06.
- V1-002 **Availability gating by plan.** Shared (team) agents are offered only on team and enterprise plans; meeting participation is offered on team, enterprise and the highest individual tier; on enterprise, meeting participation is off until an administrator turns it on. For Sklubot this maps to feature switches: a "shared agents" switch and a "meeting participation" switch, the latter defaulting to off at organisation level (suggested setting names `features.sharedAgents`, `features.meetings`). Source: announcement.
- V1-003 **Client surfaces at launch.** The release lists a desktop client (one desktop OS, ARM build) and a phone client, plus workplace chat and meeting services, as the places to use agents; the same agent and its computer are reachable from phone and desktop and keep working when the laptop is closed (already DOC-250–251, DOC-070; listed only to confirm nothing was removed). Source: overview; guide-101.

---

## 2. Agents in multi-person conversations (refines DOC-202, DOC-255–256, RKZ-515–517)

- V1-010 **Participant awareness.** In a group conversation (workplace-chat channel or thread, or an in-app group), the agent works out who is taking part (people and other agents) and takes it into account when answering: whom it addresses, what each person already knows, and who should act next. Source: announcement.
- V1-011 **Unprompted relevant contributions.** In a group conversation the agent may post without being addressed when it holds information relevant to what is being discussed (for example, a fact from an earlier conversation). Such posts must be short and clearly relevant; the existing addressing rules (DOC-201) still decide who answers a direct request. A per-conversation setting to silence unprompted contributions is recommended (suggested `groupProactivity: on | mentions-only`). Source: announcement.
- V1-012 **Volunteering for work.** When a group conversation produces a task that matches the agent's job, the agent offers to take it ("I can do X") rather than doing it silently; it starts only after someone accepts (by reply or by a positive reaction, see V1-061). Source: announcement; video ~0:30–0:32.
- V1-013 **Coordination with other agents in channels.** In a workplace-chat channel an agent can address, in one message, both a human group (a channel user-group mention) and another agent, asking for a follow-up piece of work; the addressed agent acknowledges in the thread and then does the work. Both agents appear as distinct app identities with their own name and avatar. Refines DOC-202/203 (which describe in-app hand-offs) by making the same hand-off work inside external chat threads. Source: video ~0:34–0:38; overview.
- V1-014 **Visible chain of steps across agents.** When one agent brings in another, the team can see each step of the hand-off (who asked whom, for what, with what result), and a discrepancy found by the helper is flagged to a person rather than resolved silently. Source: overview.
- V1-015 **Multi-agent relay routines.** A scheduled or triggered routine may pass one request through several agents in turn (each a specialist) until the job is complete; an agent in the chain may ask another agent for a judgement call before continuing. The routine's run record shows every agent that took part. Refines DOC-170 (one routine binds one agent) — the routine still has one owning agent, which starts the relay. Source: guide-101.

---

## 3. Meetings (refines DOC-257, OMB-195, OMB-296)

- V1-020 **Joining a meeting on request in chat.** A person can ask an agent, in an ordinary chat or voice session, to join a meeting at a given time; the agent confirms and attends at that time without further steps from the person (a calendar connection or link is used to find the meeting). Source: video ~0:08–0:12.
- V1-021 **Admission by the host.** When the agent arrives, the meeting shows a "participant asking to join" notice bearing the agent's name and avatar, which the host admits like any guest (already DOC-257; confirmed). Source: video ~0:14 (observed, uncertain — the notice text is too small to read fully).
- V1-022 **Presence in the call.** Once admitted, the agent occupies a participant tile showing its avatar (not a camera feed) labelled with its name; the avatar animates while the agent is active. Source: video ~0:16–0:18 (observed, uncertain whether the animation reflects speech or only "listening").
- V1-023 **Chat-first participation.** In the meeting the agent listens and contributes through the meeting's text chat when it is useful (not only when asked): it brings in relevant information from earlier conversations and documents. Speaking aloud is not claimed by the sources. Refines OMB-296 / DOC-257 (which describe answering questions and taking notes). Source: announcement; overview.
- V1-024 **Decision tracking and follow-up.** During the meeting the agent keeps a running list of decisions made; after the meeting it follows up on them (posts the decisions and the follow-up work it will do or has done, in the place the meeting was requested from). Source: announcement; overview.

---

## 4. Proactive, goal-driven work (refines DOC-181, A6 of spec 07)

- V1-030 **Project watch.** The agent keeps an eye on the ongoing projects it knows about (from connected tools, conversations and its memory), notices work that needs attention, and tells the relevant person, proposing a next step. Unlike DOC-181 (a lead agent's personal check-in), the trigger is the **team's** stated goals, processes and priorities, and the message can go to whichever team member owns the item. Source: announcement; overview.
- V1-031 **Deadline preparation.** Ahead of a known deadline the agent prepares the materials it will need (draft, data pull, summary) before being asked, and presents them as ready-to-review drafts. Examples given: preparing account usage and a proposal before a renewal; running a health check. Same private-preparation rule as spec 07 A6 (prepare, do not send). Source: announcement; overview.
- V1-032 **Follow-up on unfinished work.** The agent notices tasks that were started (by itself or by the team) and not finished, and follows up with the owner. Source: announcement.
- V1-033 **Escalation of judgement calls.** When a decision needs human judgement, the agent stops and asks a named person rather than choosing; the question carries the context needed to decide. Source: announcement.
- V1-034 **Goal and priority context.** For V1-030–033 to work, a shared agent needs an editable statement of the team's goals, processes and priorities (suggested: a "team brief" section in the shared agent's knowledge, editable by managers, read at the start of every proactive run). Source: announcement (stated need; the storage mechanism is our suggestion).

---

## 5. Learning across a team (refines DOC-150–157)

- V1-040 **Per-person preferences inside a shared agent.** A shared agent learns each person's individual preferences and applies them only when working for that person (consistent with DOC-157's rule that personal facts stay personal). Source: announcement.
- V1-041 **Decisions remembered with their reasons.** The agent records decisions made with it or in its presence together with the reasoning behind them, and can later explain why something was decided. Source: announcement; guide index (decision reasoning kept alongside each decision).
- V1-042 **Who-knows-what.** The agent learns which team members are knowledgeable about which topics and draws on that (cites them, routes questions to them, or asks them) instead of treating all teammates alike. Source: announcement.
- V1-043 **One teacher, all users benefit.** An improvement taught to a shared agent by one person becomes available to every user of that agent. This precises DOC-157: lessons from managers apply at once; lessons from other collaborators still go through the manager review queue before becoming shared (the sources do not say the queue was removed). Source: announcement.
- V1-044 **Self-improvement proposals.** The agent can propose a change to how it works, based on what it has learned (for example, a new default value for one of its own settings, or a new standing rule). The proposal is shown to the person as an accept / dismiss choice; nothing changes until accepted; a dismissed proposal is not re-proposed unless circumstances change. Accepted proposals are recorded in the agent's change history (suggested event `agent.self_proposal.accepted|dismissed`). Source: announcement; overview; video ~0:20 (caption scene only).
- V1-045 **Knowledge management for shared agents.** Both administrators **and** ordinary users can view and manage what a shared agent knows (administrators: the team-level knowledge; users: what it knows about them). Refines DOC-214 (manager-only knowledge console). Source: announcement.

---

## 6. Task execution improvements

### 6.1 Collaborative live pages (refines DOC-315–316, RKZ-520–522)

- V1-050 **Co-editable pages.** A page the agent builds can be edited by the people it is shared with, together, at the same time, in addition to the agent. Refines DOC-315 (pages were view-only with interactive filters). Source: announcement.
- V1-051 **Keep-updated pages.** A person can ask the agent to keep a page up to date; the agent then refreshes its content on a schedule or when its sources change, editing the same page (RKZ-522) without losing human edits made in the meantime. Source: announcement.
- V1-052 **Interactive charts in pages.** Pages can contain charts whose data points reveal values on hover (a small tooltip listing every series' value at that point, with the sample size). Source: video ~0:24–0:26.
- V1-053 **Visible agent presence on shared content.** While the agent works on a shared page, document, design or deck, people looking at it see the agent's own cursor (marked with its avatar) moving and selecting, and the agent is listed among the people currently present on the item. Source: video ~0:24–0:26, ~0:40, ~0:42–0:46, ~0:56 (observed, uncertain whether this is a real product feature or film illustration).

### 6.2 Documents, decks and visual design

- V1-054 **Better documents and slide decks.** The agent produces documents and multi-slide decks as editable files with numbered slides; slides can be referred to by number in conversation ("slide 6"). Quality is claimed improved; no mechanism stated. Source: announcement; video ~0:56.
- V1-055 **Working inside a layered design file.** The agent can open a shared visual-design file, read its layer list (a frame with pixel dimensions, text layers, image layers), select a text layer and rewrite its content, and place several variants of a visual side by side for comparison. Source: video ~0:40–0:50 (observed, uncertain — shown as illustration; the design tool is not named and no connector is announced for it).

### 6.3 Browser, connectors, efficiency

- V1-056 **Smoother sign-ins in the browser.** Browser work needs fewer interruptions: persisted sign-ins are reused, and a sign-in made by one agent on the shared computer is usable by the user's other agents (shared access, with the purchase risk this implies — see V1-066). Hand-over to the person remains for CAPTCHAs and second factors (DOC-073, DOC-289). Source: announcement; guide-101.
- V1-057 **New first-class connectors.** Mail, calendar and code-hosting connectors are promoted so the agent can finish more work directly in those services. Already in DOC-108; listed to confirm priority. Source: announcement.
- V1-058 **Lower resource use per task.** The release claims fewer resources per task. Non-functional target for Sklubot: track tokens and computer-time per completed task (already recorded per run, RKZ-048) and report the trend. Source: announcement.

---

## 7. Approvals and safeguards (refines DOC-280–285, A1 of spec 07)

- V1-060 **Per-person permissions are respected.** When a shared agent acts for someone, it can only do what that person is allowed to do (the person's own access to connected tools and data). Restates DOC-005/DOC-213 as a hard rule for shared agents in every surface, including workplace chat and meetings. Source: announcement.
- V1-061 **Reaction as consent.** A positive reaction by the right person on an offer the agent made (for example, to notify another team) counts as acceptance and the agent proceeds; consistent with OMB-233. Source: video ~0:30–0:32.
- V1-062 **Audience check before posting.** Before posting in a channel, the agent checks whether the content is appropriate for that channel's audience (for example, private or internal information in a public or external channel) and, if not, asks or withholds the sensitive part. Source: announcement.
- V1-063 **Pre-share content scan with a redacted alternative.** Before sharing a document or deck with an outside party, the agent scans its content for sensitive material (e.g. internal financial figures), tells the person exactly which part is sensitive (by slide/section number), and offers to share a version without that part. The person's short reply ("yes") makes the agent send the redacted version; the original is not modified. Source: announcement; video ~0:52–1:02.
- V1-064 **Fewer redundant approval prompts.** The approval logic recognises when the person has already authorised the action (in their own words, earlier in the conversation, or by an existing rule) and does not ask again. Same behaviour as spec 07 A1 (authorisation grounded in the user's exact words); cite A1 rather than re-implementing. Source: announcement.
- V1-065 **Reviewer guided by allow/block lists.** Permission rules written in plain language in settings are complemented by explicit allow and block lists that guide the independent action reviewer, whose outcomes are allow, block, or escalate to the person. Refines DOC-280/282 (adds block lists and the explicit "block" outcome alongside "ask"). Source: guide-101; overview.
- V1-066 **Shared-sign-in risk notice.** Because sign-ins on the shared computer are usable by every agent of the user (V1-056), the settings must warn that a signed-in shopping or payment site could be used for purchases and point to purchase rules (RKZ-607, spec 07 A12). Source: guide-101.

---

## 8. Packaging and gallery (refines DOC-011, DOC-028–029, DOC-207, RKZ-847)

- V1-070 **Template = recipe, not clone.** Publishing an agent produces a blueprint from which a recipient builds their own independent copy; the recipient's copy does not stay linked to the original. Source: guide-templates.
- V1-071 **What a template contains.** Instructions; relevant memories and skills; first-party plugins and skills; routines (its run triggers and schedules); a description of the integrations it expects. Source: guide-templates.
- V1-072 **What a template excludes by default.** Personal or internal memories; private skills; any secret or private information; custom code and scripts; non-standard tool servers (the recipient must set those up). Source: guide-templates.
- V1-073 **Publish flow.** From the agent's settings: (1) ask the agent to package itself — nothing is public yet; (2) review a detail view listing exactly what is included; (3) choose the scope — team-only or public; (4) publish and receive a shareable link. Public sharing remains subject to the admin switch of DOC-344. Source: guide-templates.
- V1-074 **Install flow.** Opening a template link shows its context and expected integrations for review; confirming creates a separate copy for the recipient; plugins shipped with it must be set up again; excluded items must be reconnected or recreated by the recipient. The install screen reminds the recipient to review a template like any software before installing. Source: guide-templates.
- V1-075 **Setup steps encoded by the publisher.** A publisher can instruct the agent to include setup steps (for keys, tool servers, accounts) so that the recipient's copy walks them through what is missing on first run. Source: guide-templates.
- V1-076 **Gallery structure.** The gallery has a featured strip, category filters (an agent may sit in several categories; categories seen: all, made by the product team, engineering, sales, marketing, design, personal, recruiting & people, product, operations), and entries showing name, creator, a one-line summary — which may state the agent's limits such as "asks before sending" — and an add button leading to a detail page. Refines DOC-011/207. Source: gallery.

---

## 9. Chat and voice surface details (from the film)

- V1-080 **Compact voice bar with text.** A voice session can run in a small floating bar showing the agent's avatar, a live voice-activity indicator, settings, a switch to show the text exchange, mute and hang-up; the text exchange expands beneath the bar so typed requests and the agent's written answers appear during the voice session. Refines DOC-231. Source: video ~0:08–0:12, ~0:52–1:02 (observed, uncertain whether typing is possible or the bubbles are a transcript).
- V1-081 **History indicator in the composer.** The message composer shows whether conversation history is being kept for this chat (an on/off state visible in the input field). Source: video ~0:22, ~0:28 (observed, uncertain — meaning of the indicator not explained).
- V1-082 **Reactions on agent messages.** People can add emoji reactions to the agent's messages and to items the agent posts, with counts per emoji; reactions feed back to the agent (see V1-061, OMB-233). Source: video ~0:28, ~1:06.
- V1-083 **Distinct agent identities across surfaces.** Each agent keeps the same name and distinct avatar shape and colour in the app, in workplace chat, in meetings and as a cursor on shared content, so people can tell several agents apart at a glance. Consistent with REQ-010/REQ-012. Source: video ~1:10–1:12.

---

## 10. Not covered / not readable

- The product changelog (versions cited by the announcement for browser, pages, connectors and approval changes) returned HTTP 403; version-specific details are therefore unknown.
- The film briefly shows an agent profile card (~1:08) whose text is cut off; nothing is specified from it.
- Pricing, quotas, data-retention and enterprise controls beyond DOC-340–353 are not described in the sources read, apart from a mention of data-loss-prevention, certificates, proxies and network controls set at start-up (DOC-345 already covers network egress; data-loss prevention is noted here as an enterprise item not specified further).

---

## Ce que ça change pour la reconstruction

Nouvelles capacités pour Sklubot, une ligne chacune, avec une taille estimée (S = petit, M = moyen, L = gros) :

- Interrupteurs de fonctions « agents partagés » et « participation aux réunions » (réunions désactivées par défaut au niveau de l'organisation) — **S** (V1-002)
- Le bot repère qui participe à une discussion de groupe et adapte ses réponses — **M** (V1-010)
- Le bot intervient de lui-même dans un groupe quand il a une info utile, avec un réglage pour le faire taire — **M** (V1-011)
- Le bot propose de prendre une tâche et attend un « oui » (réponse ou réaction) avant de commencer — **S** (V1-012, V1-061)
- Passage de relais entre bots dans un fil de messagerie d'équipe externe, avec mention d'un groupe humain — **M** (V1-013, V1-014)
- Routine « relais » qui fait passer une demande par plusieurs bots spécialistes — **M** (V1-015)
- Demander au bot de rejoindre une réunion à une heure donnée, depuis la discussion — **M** (V1-020)
- En réunion : interventions utiles dans le chat, liste des décisions, suivi après la réunion — **L** (V1-023, V1-024)
- Veille de projets guidée par les objectifs de l'équipe : signaler, proposer la suite, relancer l'inachevé — **L** (V1-030, V1-032)
- Préparation avant échéance (brouillons prêts à relire, sans envoi) — **M** (V1-031)
- Escalade explicite vers une personne nommée pour les décisions de jugement — **S** (V1-033)
- Fiche « objectifs et priorités de l'équipe » modifiable par les responsables — **S** (V1-034)
- Préférences par personne dans un bot partagé — **M** (V1-040)
- Mémoire des décisions avec leurs raisons — **M** (V1-041)
- Carte « qui sait quoi » dans l'équipe — **M** (V1-042)
- Le bot propose de modifier sa propre façon de travailler (accepter / écarter), avec historique — **M** (V1-044)
- Gestion de ce que sait le bot partagé, aussi pour les simples utilisateurs — **M** (V1-045)
- Pages co-éditables par plusieurs personnes en même temps — **L** (V1-050)
- Pages tenues à jour par le bot sans écraser les modifications humaines — **M** (V1-051)
- Graphiques interactifs avec infobulle au survol dans les pages — **S** (V1-052)
- Curseur et présence visibles du bot sur un contenu partagé — **M** (V1-053, incertain)
- Présentations à diapositives numérotées et désignables par leur numéro — **M** (V1-054)
- Édition d'un fichier de design à calques (lire, sélectionner, réécrire un texte, variantes) — **L** (V1-055, incertain)
- Connexions de sites partagées entre les bots + avertissement sur le risque d'achat — **S** (V1-056, V1-066)
- Vérification de l'audience avant de publier dans un canal — **M** (V1-062)
- Analyse d'un document avant partage externe et proposition d'une version expurgée — **M** (V1-063)
- Listes « autoriser / bloquer » pour guider le relecteur d'actions, avec issue « bloquer » — **S** (V1-065)
- Modèles de bot complets : contenu inclus / exclu, relecture avant publication, portée équipe ou public, lien, installation en copie indépendante, étapes d'installation guidées — **L** (V1-070 à V1-075)
- Galerie avec mise en avant, catégories multiples et limites affichées par fiche — **M** (V1-076)
- Barre vocale compacte avec échange écrit dépliable — **S** (V1-080, incertain)
- Indicateur « historique conservé ou non » dans la zone de saisie — **S** (V1-081, incertain)
- Réactions avec compteurs sur les messages et publications du bot — **S** (V1-082)
