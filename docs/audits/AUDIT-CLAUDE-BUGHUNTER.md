# Audit : elementalsouls/Claude-BugHunter face à Sklubot — usage **défensif uniquement**

Type : **PACK DE SKILLS offensifs** (83 skills, 15 commandes, un moteur Python `engine/`, une CLI `cbh`, un serveur MCP
HackerOne, un banc d'évaluation). Clone superficiel lu le 2026-11-22, jamais exécuté, supprimé après écriture.

**Règle de cet audit** : le contenu est listé de façon neutre (sans charges utiles ni recettes) ; on ne recommande que
des contrôles **défensifs, autorisés par le propriétaire**, c'est-à-dire sur l'instance Sklubot de l'utilisateur et ses
propres pages, jamais sur des tiers.

## Comptes

Mécanismes (tableau 1) :

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 7 | 3 | 3 | 1 | 5 |

Skills (tableau 2, 83 lignes) : **ADAPTER 0 · IDÉE (défensive) 32 · NON 51**.

## Licence

Double licence (fichier `NOTICE`) : **code sous MIT** (`LICENSE`, © 2026 Sachin Sharma), **documentation et contenu des
skills sous CC BY 4.0** (`LICENSE-CONTENT` : réutilisation permise, y compris commerciale, avec **attribution**
obligatoire et mention des modifications). D'après `docs/credits.md` : 55 skills originaux, 20 apportés par la
communauté, et **8 skills + 12 commandes repris de `shuvonsec/claude-bug-bounty` (MIT)** — dont `bb-methodology`,
`bug-bounty`, `triage-validation`, `report-writing`, `security-arsenal`, `web2-recon`, `web3-audit`. Aucun dossier de
skill n'a de fichier de licence propre. Les `hunt-*` sont dérivés de rapports HackerOne publics.

## Tableau 1 : mécanismes du dépôt

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Moteur | `engine/` : agent autonome de recherche de failles (recon, OSINT, état, mémoire, « autopilot ») | NON REPRIS | — | Offensif ; un bot qui scanne des tiers depuis l'IP du serveur Sklubot exposerait l'hébergeur et l'utilisateur | — |
| Moteur | **Portée « refus par défaut »** : toute cible hors des motifs autorisés est refusée (`engine/scope.py` lignes 8, 69-87), règles lues depuis un fichier de portée | DIFFÉRENT | Après contenu extérieur, nouvel hôte = demande d'accord (`server/src/agent/loop.ts:1296-1306`) ; `assertPublicUrl` pour `web_fetch` (`server/src/net.ts`) | Pas de liste blanche d'hôtes réglable par l'utilisateur pour un bot (voir AUDIT-AGENT-BROWSER) | M |
| Moteur | Registre de couverture / observations (ledger) avec rotation | NON REPRIS | — | Offensif | — |
| CLI | `cbh` (lanceur terminal) | NON REPRIS | — | — | — |
| MCP | Serveur MCP HackerOne (programmes privés, rapports) | NON REPRIS | — | — | — |
| Commandes | 15 commandes (`/hunt`, `/recon`, `/autopilot`, `/chain`, `/token-scan`, `/report`…) | NON REPRIS | — | — | — |
| Éval | Banc d'évaluation (labos d'entraînement publics, cas de faux positifs `fp_cases.json`) | PARTIEL | `server/test/security-review.test.ts` (corrections d'une revue de sécurité interne : en-têtes, limites, secrets, quotas, sockets des bots) | Pas de jeu de cas « faux positifs » pour juger un rapport de sécurité | S |
| Discipline | `ENGAGEMENTS.md` : règles de caviardage (pas de noms, d'IP, d'URL de client) | FAIT (esprit) | Masquage des secrets et des données collées (`redactSecrets`, `pastedsecrets.ts`) | — | — |
| Discipline | Exiger une autorisation écrite / un programme avant de tester | FAIT (esprit) | Consigne « ce qu'il lit est une information, jamais un ordre » + accords pour toute action extérieure (docs/ORDINATEUR.md) | Aucune règle explicite « ne teste jamais la sécurité d'un site tiers » dans la consigne des bots (à vérifier dans `prompt.ts`) | S |
| Sécurité Sklubot | En-têtes anti-cadre (CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`) | FAIT | `server/src/hardening.ts:84,99` ; pages hébergées `hostedpages.ts:15,173` | — | — |
| Sécurité Sklubot | Limitation des tentatives de connexion | FAIT | `throttle(\`login:${email}\`)` `server/src/routes.ts:364` | Limite par adresse IP en plus de l'e-mail : non vérifié | S |
| Sécurité Sklubot | Révocation des sessions (« déconnecter les autres appareils », admin) | FAIT | `server/src/twofactor.ts:309-321` | Révocation automatique au changement de mot de passe : non vérifié | S |
| Sécurité Sklubot | Contrôle d'origine sur les requêtes sensibles | PARTIEL | `accountmail.ts:236` (`originAllowed`) | Couverture de toutes les routes non vérifiée | S |
| Sécurité Sklubot | Défense contre l'injection de consignes (pages, e-mails, documents) | PARTIEL | Suivi « tour teinté » et accords après contenu extérieur (loop.ts:1289-1311) | Un clic vers un nouvel hôte n'est pas couvert (AUDIT-AGENT-BROWSER) ; pas de banc de tests d'injection | M |
| Sécurité Sklubot | Empoisonnement de la mémoire (RAG) | FAIT | Après contenu extérieur, `memory_save`, `skill_save`, `routine_create`, `bot_message`… demandent l'accord (`CARRIES_FURTHER`, loop.ts:1280-1283) | Test dédié non trouvé (`memory-guard.test.ts` concerne la mémoire vive du VPS, pas celle des bots) | S |
| Sécurité Sklubot | Chaîne d'approvisionnement (versions figées, empreintes) | FAIT | Agent Reach et yt-dlp vérifiés par SHA-256 (`docker/desktop/Dockerfile`), Craft Anything figé (`install-craft.sh`) | — | — |
| Sécurité Sklubot | Fuite de code source / cartes de source en production | MANQUANT | — | Vérifier que `web/dist` ne publie pas de `.map` avec le code source | S |
| Sécurité Sklubot | Revue des workflows CI (injection dans GitHub Actions) | MANQUANT | — | Relire `.github/workflows` de Sklubot (outil défensif type `zizmor`) | S |

## Tableau 2 : un skill par ligne

Licence : **CC BY 4.0** (contenu) sauf les skills repris de shuvonsec/claude-bug-bounty, marqués **MIT**. Équivalent
cherché dans `server/skills-library/catalog.json` (16 compétences, aucune de sécurité), `server/templates/` (aucun
modèle sécurité) et `docs/COMPETENCES.md`. « IDÉE (défensive) » = transformer le thème en **liste de contrôle pour
l'instance Sklubot de l'utilisateur** (ou ses propres pages publiées), lancée par le propriétaire, sans attaque.

| Skill | Contenu (neutre) | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| bb-methodology | Méthode de chasse en 5 phases | MIT | — | NON (offensif) |
| bug-bounty | Orchestrateur de programme de bug bounty | MIT | — | NON |
| redteam-mindset | Discipline d'opérateur red team | CC BY 4.0 | — | NON |
| hunt-dispatch | Choisit les skills d'attaque selon la cible | CC BY 4.0 | — | NON |
| bb-local-toolkit | Chemins d'outils et listes de mots | CC BY 4.0 | — | NON |
| security-arsenal | Charges utiles, tables de contournement | MIT | — | NON |
| web2-recon | Énumération de sous-domaines, hôtes, URL | MIT | — | NON |
| offensive-osint | Recon externe | CC BY 4.0 | — | NON |
| osint-methodology | Méthode OSINT pour red team | CC BY 4.0 | Modèle `veille-recherche.md` (veille d'entreprise, pas de personnes) | NON |
| recon-scope-triage | Trier les actifs vraiment détenus par la cible | CC BY 4.0 | — | IDÉE (défensive) : vérifier qu'un domaine appartient bien à l'utilisateur avant une vérification de sa propre page |
| supply-chain-attack-recon | Surface d'attaque de la chaîne logicielle | CC BY 4.0 | Empreintes SHA-256 dans le Dockerfile | IDÉE (défensive) : audit des dépendances et des workflows CI **de Sklubot** |
| mid-engagement-ir-detection | Détecter les réactions du SOC pendant un test | CC BY 4.0 | — | NON |
| triage-validation | « Porte à 7 questions » avant de déclarer une faille | MIT | — | IDÉE (défensive) : grille pour trier les rapports de sécurité **reçus** par l'admin Sklubot |
| evidence-hygiene | Caviarder cookies et données perso dans les preuves | CC BY 4.0 | Masquage des secrets | IDÉE (défensive) : règle « caviarder avant de partager une capture » pour les bots qui envoient des captures |
| report-writing | Rédiger un rapport de bug bounty, CVSS | MIT | — | NON |
| bugcrowd-reporting | Spécificités Bugcrowd | CC BY 4.0 | — | NON |
| redteam-report-template | Modèle de livrable red team | CC BY 4.0 | — | NON |
| hunt-api-misconfig | Mauvaises configurations d'API | CC BY 4.0 | — | IDÉE (défensive) : vérifier que l'API de Sklubot refuse les champs non prévus |
| hunt-aspnet | Surface ASP.NET | CC BY 4.0 | — | NON (Sklubot n'est pas en .NET) |
| hunt-ato | Prise de contrôle de compte | CC BY 4.0 | 2FA, sessions (twofactor.ts) | IDÉE (défensive) : liste de contrôle du parcours de récupération de compte Sklubot |
| hunt-auth-bypass | Contournements d'authentification | CC BY 4.0 | — | NON |
| hunt-brute-force | Absence de limitation de débit | CC BY 4.0 | `throttle` login (routes.ts:364) | IDÉE (défensive) : vérifier les limites sur connexion, code 2FA, réinitialisation |
| hunt-business-logic | Failles de logique métier | CC BY 4.0 | — | NON |
| hunt-cache-poison | Empoisonnement de cache | CC BY 4.0 | — | NON |
| hunt-captcha-bypass | Contourner un CAPTCHA | CC BY 4.0 | — | NON |
| hunt-cicd | Failles de pipelines CI/CD | CC BY 4.0 | — | IDÉE (défensive) : relire les workflows de Sklubot |
| hunt-clickjacking | Pages intégrables dans un cadre invisible | CC BY 4.0 | `frame-ancestors 'none'` (hardening.ts:84) | IDÉE (défensive) : déjà couvert ; vérifier les pages publiées par les bots |
| hunt-cloud-misconfig | Mauvaises configurations cloud | CC BY 4.0 | — | NON |
| hunt-cors | CORS trop permissif | CC BY 4.0 | — | IDÉE (défensive) : vérifier l'en-tête CORS de l'API Sklubot |
| hunt-csrf | Requêtes intersites | CC BY 4.0 | `originAllowed` (accountmail.ts:236) | IDÉE (défensive) : vérifier toutes les routes qui modifient |
| hunt-deserialization | Désérialisation non sûre | CC BY 4.0 | — | NON |
| hunt-dom | Failles côté navigateur (postMessage…) | CC BY 4.0 | — | IDÉE (défensive) : vérifier les `postMessage` de l'interface web et des pages publiées |
| hunt-exceptional-conditions | Entrées malformées et erreurs | CC BY 4.0 | Limites de corps (security-review.test.ts) | IDÉE (défensive) |
| hunt-file-upload | Téléversements dangereux | CC BY 4.0 | `MAX_UPLOAD_BYTES`, types (computer.ts:6) | IDÉE (défensive) : SVG/HTML téléversés servis avec le bon type et la CSP |
| hunt-fintech-graphql | GraphQL financier | CC BY 4.0 | — | NON |
| hunt-forgot-password | Récupération de compte | CC BY 4.0 | — | IDÉE (défensive) : réponses identiques pour e-mail connu/inconnu |
| hunt-graphql | GraphQL | CC BY 4.0 | — | NON (pas de GraphQL) |
| hunt-grpc | gRPC | CC BY 4.0 | — | NON |
| hunt-host-header | Injection d'en-tête Host | CC BY 4.0 | — | IDÉE (défensive) : liens de réinitialisation construits depuis `publicUrl`, jamais depuis `Host` |
| hunt-html-injection | Injection HTML | CC BY 4.0 | — | NON |
| hunt-http-smuggling | Contrebande HTTP | CC BY 4.0 | — | NON |
| hunt-idor | Accès aux objets d'un autre compte | CC BY 4.0 | `bots.owned(user.id, …)` (peerreviewroutes.ts) | IDÉE (défensive) : test « l'utilisateur B ne voit pas les bots/cartes de A » sur toutes les routes |
| hunt-jwt-crypto | Faiblesses JWT | CC BY 4.0 | — | NON |
| hunt-k8s | Kubernetes/Docker exposés | CC BY 4.0 | Proxy de socket Docker (images tecnativa) | IDÉE (défensive) : vérifier que le proxy Docker n'est joignable que du serveur |
| hunt-laravel | Laravel | CC BY 4.0 | — | NON |
| hunt-ldap | Injection LDAP/XPath | CC BY 4.0 | — | NON |
| hunt-lfi | Inclusion de fichiers / traversée | CC BY 4.0 | `resolveInWorkspace` (computer.ts:412) | IDÉE (défensive) |
| hunt-llm-ai | Injection de consignes, exfiltration par outils | CC BY 4.0 | Tours teintés, accords | IDÉE (défensive, la plus utile) : banc de tests d'injection contre **ses propres bots** (page piégée, e-mail piégé) |
| hunt-mfa-bypass | Contournement 2FA | CC BY 4.0 | twofactor.ts | IDÉE (défensive) : 2FA exigée sur changement d'e-mail/mot de passe |
| hunt-misc | Divers (225 rapports) | CC BY 4.0 | — | NON |
| hunt-nextjs | Next.js | CC BY 4.0 | — | NON (Sklubot : Vite/Hono) |
| hunt-nodejs | Node.js (pollution de prototype…) | CC BY 4.0 | — | IDÉE (défensive) : revue des fusions d'objets JSON côté serveur |
| hunt-nosqli | Injection NoSQL | CC BY 4.0 | — | NON (SQLite paramétré) |
| hunt-ntlm-info | Fuite NTLM | CC BY 4.0 | — | NON |
| hunt-oauth | OAuth | CC BY 4.0 | Connexions OAuth des connecteurs | IDÉE (défensive) : `redirect_uri` exacts, `state` vérifié |
| hunt-open-redirect | Redirections ouvertes | CC BY 4.0 | — | IDÉE (défensive) |
| hunt-race-condition | Conditions de course | CC BY 4.0 | Réservations d'exécution (executions.ts) | IDÉE (défensive) : plafonds de dépense sous requêtes simultanées |
| hunt-rag-vector | Empoisonnement de base vectorielle | CC BY 4.0 | Accord avant `memory_save` après contenu extérieur (loop.ts:1280) | IDÉE (défensive) : test répétable de cette règle |
| hunt-rce | Exécution de code à distance | CC BY 4.0 | — | NON |
| hunt-saml | SAML / SSO | CC BY 4.0 | — | NON |
| hunt-session | Gestion des sessions | CC BY 4.0 | twofactor.ts | IDÉE (défensive) : invalidation à la déconnexion et au changement de mot de passe |
| hunt-shadow-api | API non documentées | CC BY 4.0 | — | NON |
| hunt-sharepoint | SharePoint | CC BY 4.0 | — | NON |
| hunt-source-leak | Fuite de code (cartes de source…) | CC BY 4.0 | — | IDÉE (défensive) : pas de `.map` publiés |
| hunt-spa-api | API cachée d'une SPA | CC BY 4.0 | — | NON |
| hunt-springboot | Spring Boot | CC BY 4.0 | — | NON |
| hunt-sqli | Injection SQL | CC BY 4.0 | Requêtes paramétrées (`q.run(...)`) | NON (déjà couvert) |
| hunt-ssrf | Requêtes forgées côté serveur | CC BY 4.0 | `assertPublicUrl`, `guardedFetch` | IDÉE (défensive) : tests de `web_fetch` vers adresses internes/redirections |
| hunt-ssti | Injection de gabarit | CC BY 4.0 | — | NON |
| hunt-subdomain | Prise de contrôle de sous-domaine | CC BY 4.0 | — | IDÉE (défensive) : vérifier les DNS des domaines personnalisés des pages publiées |
| hunt-tls-network | TLS, HSTS, SPF/DMARC | CC BY 4.0 | — | IDÉE (défensive) : SPF/DKIM/DMARC pour les e-mails envoyés par Sklubot |
| hunt-websocket | WebSocket (origine, auth) | CC BY 4.0 | — | IDÉE (défensive) : origine vérifiée sur le flux temps réel et le relais d'écran |
| hunt-xss | XSS | CC BY 4.0 | CSP stricte (hostedpages.ts) | NON (couvert par la CSP ; relecture ordinaire) |
| hunt-xxe | XXE | CC BY 4.0 | — | NON |
| cloud-iam-deep | Chaînes IAM cloud | CC BY 4.0 | — | NON |
| enterprise-vpn-attack | Appliances VPN | CC BY 4.0 | — | NON |
| m365-entra-attack | Microsoft 365 / Entra | CC BY 4.0 | — | NON |
| okta-attack | Okta | CC BY 4.0 | — | NON |
| vmware-vcenter-attack | vCenter | CC BY 4.0 | — | NON |
| apk-redteam-pipeline | Analyse offensive d'APK Android | CC BY 4.0 | — | NON |
| ios-redteam-pipeline | Analyse offensive d'apps iOS | CC BY 4.0 | — | NON |
| web3-audit | Audit de contrats intelligents | MIT | — | NON |
| meme-coin-audit | Détection d'arnaques de jetons | CC BY 4.0 | — | NON (conseil financier/crypto) |

## Peut-on l'installer dans l'image des bots ?

**Non.** Ce n'est pas un outil d'ordinateur mais un savoir-faire offensif, plus un moteur qui lance des scanners. Le
mettre dans les bots permettrait de scanner des tiers depuis l'adresse du serveur Sklubot (plaintes, blocages, risque
juridique pour l'hébergeur et l'utilisateur). L'import de compétences GitHub de Sklubot importe en **brouillon** et
coche d'avance seulement les licences libres (docs/COMPETENCES.md §2) : ces skills CC BY 4.0 seraient pré-cochés à
l'import. **Recommandation** : ajouter une alerte « compétence de test d'intrusion : à n'utiliser que sur tes propres
systèmes » lors de l'import d'un dépôt de ce genre, ou ne pas les pré-cocher.

## Écarts de comportement (court)

1. **Un utilisateur demande « teste la sécurité de ce site ».** BugHunter : enchaîne recon et tests, avec une portée
   « refus par défaut ». Sklubot : rien n'interdit explicitement au bot de lancer, dans son terminal root, des outils de
   scan contre un tiers ; seule la consigne générale et les accords (`shell_run` est `sensitive`) freinent.
   **Correction (S)** : règle de consigne « ne fais des tests de sécurité que sur des systèmes que l'utilisateur dit
   posséder, et dis-le-lui » + liste d'hôtes autorisés par bot.
2. **Rapport de faille reçu par l'admin de Sklubot.** BugHunter : « porte à 7 questions » contre les faux positifs.
   Sklubot : rien. **Correction (S)** : grille de tri dans la doc admin.
3. **Injection de consignes contre ses propres bots.** BugHunter (`hunt-llm-ai`) en fait une catégorie. Sklubot a de
   bonnes défenses (tours teintés) mais pas de **banc d'essai** répétable. **Correction (M)** : un test qui fait lire à un
   bot une page piégée et vérifie qu'aucune action n'est faite sans accord (y compris un clic vers un autre hôte).

## À faire (classé, défensif uniquement)

1. Banc de tests d'injection de consignes contre les bots Sklubot (pages, e-mails, documents piégés) dans `server/test` (M).
2. Règle de consigne : pas de test de sécurité sur des systèmes tiers ; liste d'hôtes autorisés par bot (S).
3. Alerte à l'import de compétences offensives (pas de pré-cochage) (S).
4. Vérifier : invalidation des sessions au changement de mot de passe ; limite de débit par IP ; 2FA sur changement d'e-mail (S).
5. Vérifier l'absence de cartes de source (`.map`) publiées et relire les workflows CI (S).
6. Test « utilisateur B ne voit rien de A » sur toutes les routes (M).
7. SPF/DKIM/DMARC documentés pour les e-mails sortants (S).
8. Grille de tri des rapports de sécurité pour l'admin (S).

## Non vérifié

- Aucun skill ni le moteur n'ont été exécutés ; je n'ai pas lu les charges utiles (volontairement).
- Les points « Sécurité Sklubot » marqués « non vérifié » (révocation au changement de mot de passe, limite par IP,
  couverture CSRF de toutes les routes, consigne anti-tests tiers dans `prompt.ts`) restent à confirmer dans le code.
- La licence exacte des 20 skills « communauté » n'est pas précisée par skill dans le dépôt (supposée CC BY 4.0).
