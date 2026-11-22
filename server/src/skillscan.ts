import { createHash } from "node:crypto";
import { q } from "./db.js";
import { mentionsKey } from "./projectimport.js";
import { maskSecrets, type Skill, type SkillExtras } from "./shared.js";
import type { ScanCode, ScanFinding, ScanSeverity, SkillScan, SkillScanEntry, SkillScanReport } from "./skillscantypes.js";
import { audit, bots, now, setSkillGuard, skills } from "./store.js";

/**
 * « Contrôle de sécurité des compétences » (docs/COMPETENCES.md).
 *
 * A skill is text a bot will follow, so a skill from elsewhere can try to steer the bot against its owner. This module
 * reads that text with fixed rules (no model call, same answer every time) and lists what it finds: a code, a
 * severity, the line and a short quote. It is a reading aid, not a proof: it knows wordings, not intentions.
 *
 *   danger   stays a draft until the owner reads the findings and accepts them (acceptSkill); a bot cannot do that
 *   warning  to read before activating
 *   info     the line names a risky thing but says NOT to do it ("never run curl | sh"), or is harmless on its own
 *
 * What a line-by-line reading cannot tell apart, on purpose kept simple and said in the docs:
 *   - a negation is only seen on the same line, just before the risky words ("Never …", "Ne … jamais"); a list of
 *     forbidden things under a heading such as "Do not do this:" is reported as if it were asked for;
 *   - an instruction spread over several lines, written in another language than French or English, or reworded so
 *     that no rule matches, is not found; a quoted example ("an attacker may write …") is reported as the real thing;
 *   - a harmless installer (`curl … | sh`) and a harmful one read the same: both are "danger".
 *
 * The last result is kept per skill in `skill_scans` (created here, like team_md_links in teammdimport.ts), with the
 * hash of the text the owner accepted: once the text changes, the acceptance no longer counts.
 */

q.run(`CREATE TABLE IF NOT EXISTS skill_scans (
  skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE, text_hash TEXT NOT NULL, worst TEXT NOT NULL,
  findings TEXT NOT NULL DEFAULT '[]', scanned_at INTEGER NOT NULL, accepted_hash TEXT, accepted_at INTEGER)`);

// ── The rules ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Rule {
  code: ScanCode; severity: ScanSeverity; re: RegExp;
  /** "never …" just before it (or a "Never" heading above it) makes it information only. */
  negatable: boolean;
  /** Words later on the line that limit it to harmless things ("… for what is reversible"): a warning then. */
  soften?: RegExp;
}
/** A rule's pattern: case-insensitive, Unicode, starting at a word start (so "skipping" is not "kipping"). */
const W = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${src})`, "iu");
const rule = (code: ScanCode, severity: ScanSeverity, src: string, negatable = true, soften?: RegExp): Rule => ({ code, severity, re: W(src), negatable, soften });
/** A command: matched as written (no word-start rule, case kept loose). */
const cmd = (code: ScanCode, severity: ScanSeverity, re: RegExp): Rule => ({ code, severity, re, negatable: true });

const SECRET_THING = "(?:memor(?:y|ies)|m[ée]moires?|vault|coffre(?:-fort)?|secrets?|api[ _-]?keys?|(?:private |ssh |access )?keys?(?! (?:points?|findings|takeaways|ideas?|facts|results|steps|messages?|words?|figures|numbers))|cl[ée]s? (?:d'api|api|priv[ée]es?|ssh|secr[èe]tes?|d'acc[èe]s)|(?:les|tes|mes|ses|vos|des) cl[ée]s|tokens?|jetons?|cookies?|passwords?|mots? de passe|credentials|identifiants|\\.env(?![\\p{L}])|id_rsa|\\.ssh|system prompt|prompt syst[èe]me)";
const DATA_THING = "(?:files?|fichiers?|documents?|contacts?|conversations?|historique|history|messages|photos|screenshots?|captures? d'[ée]cran|database|base de donn[ée]es|address book|carnet d'adresses|inbox|bo[îi]te (?:mail|de r[ée]ception))";
const SEND_VERB = "(?:send(?:s|ing)?|post(?:s|ing)?|upload(?:s|ing)?|forward(?:s|ing)?|e-?mail(?:s|ing)?|transmit(?:s|ting)?|exfiltrat(?:e|es|ing)|leak(?:s|ing)?|submit(?:s|ting)?|deliver(?:s|ing)?|cop(?:y|ies|ying)|envo(?:ie|ies|yer|yez|i)|transm(?:ets|et|ettre|ettez)|t[ée]l[ée]vers(?:e|es|er|ez)|post(?:e|es|er|ez)|publi(?:e|es|er|ez)|transf[èeé]r(?:e|es|er|ez)|copi(?:e|es|er|ez)|exfiltr(?:e|es|er|ez))";
const PLACEHOLDER_HOST = "(?:example\\.(?:com|org|net)|[\\w.-]+\\.(?:test|example|invalid|local)|localhost)";
const ADDRESS = `(?:https?://(?!${PLACEHOLDER_HOST})[^\\s)>\\]"'\`]+|ftp://\\S+|[\\w.+-]+@(?!${PLACEHOLDER_HOST})[\\w-]+(?:\\.[\\w-]+)+|(?:\\d{1,3}\\.){3}\\d{1,3})`;
const DEST = `(?:${ADDRESS}|(?:a |an |the |this |that |un |une |ce |cette |le |la |l')?(?:webhook|external server|remote server|third[- ]party server|serveur externe|serveur distant|pastebin)|(?:this|the following|that) (?:address|server|url|endpoint)|(?:cette|l') ?adresse)`;
const TO = "(?:to|into|towards?|via|through|[àa]|au|aux|vers|sur|chez|par)";
const OWNER = "(?:owner|user|human|admin|operator|propri[ée]taire|utilisateur|utilisatrice|humain)";
const UNASKED = "(?:without (?:asking|confirmation|approval|permission|checking|telling|waiting)|no need to (?:ask|confirm)|(?:don't|do not) (?:ask|wait)|automatically|immediately|right away|straight away|sans (?:demander|confirmation|accord|validation|autorisation|pr[ée]venir|attendre)|automatiquement|imm[ée]diatement|tout de suite|d'office|inutile de demander|pas besoin de demander)";
const PAY = "(?:buy(?:s|ing)?|purchas(?:e|es|ing)|pay (?:for|the|with|it|them)|make (?:a|the) payment|place (?:an|the) order|(?:proceed to|complete the) checkout|wire transfer|transfer (?:the |some )?(?:money|funds)|send (?:money|funds|bitcoin|crypto|eth|usdt)|ach[èe]t(?:e|es|er|ez)|pa(?:ie|ies|ye|yes|yer|yez)(?![\\p{L}])|r[èe]gl(?:e|es|er|ez) (?:la|le|l')|pass(?:e|es|er|ez) (?:la |une )?commande|command(?:e|es|er|ez) (?:le|la|les|un|une|des)|valid(?:e|es|er|ez) (?:le |la )?(?:panier|commande|paiement)|fai(?:s|tes|re) un virement)";
const SHELL = "(?:sudo\\s+)?(?:(?:ba|z|k|da|fi|a|c)?sh|python[23]?|perl|ruby|node|php)(?![\\w.-])";
const BROAD_PATH = "(?:\\/(?:\\*|\\s|$|[\"'`;&|])|~\\/?(?:\\*|\\s|$|[\"'`;&|])|\\$\\{?HOME\\}?\\/?(?:\\*|\\s|$|[\"'`;&|])|\\/(?:home|etc|usr|var|bin|sbin|boot|root|lib|opt|Users|System|Library|Applications)\\/?(?:\\*|\\s|$|[\"'`;&|])|\\*(?:\\s|$|[\"'`;&|])|\\.\\/?\\*?(?:\\s|$|[\"'`;&|])|[A-Za-z]:\\\\)";

/** "… for what is reversible and expected": the instruction is limited to things that cannot hurt. */
const SCOPED = /(?<![\p{L}])(?:reversible|read-only|harmless|trivial|minor|routine|expected|risk-free|sans risque|r[ée]versibles?|lecture seule|anodins?|mineurs?|attendus?|habituels?)(?![\p{L}])/iu;

const RULES: Rule[] = [
  // Ignoring or replacing the owner's rules.
  rule("override-rules", "danger", "(?:ignor(?:e|es|ing)|disregard(?:s|ing)?|forget(?:s|ting)?|overrid(?:e|es|ing)|bypass(?:es|ing)?|circumvent(?:s|ing)?|overrul(?:e|es|ing)|(?:do not|don't|stop|no longer) follow(?:ing)?)\\b.{0,40}?\\b(?:instructions?|prompts?|guidelines|safeguards?|guardrails?|restrictions?|(?:safety|security|system|owner'?s?|user'?s?|your|previous|prior|above|earlier) (?:rules?|limits|constraints|polic(?:y|ies))|all (?:the |of the |your )?rules)(?! (?:of|for) (?:grammar|css|style|the game))"),
  rule("override-rules", "danger", "(?:ignor(?:e|es|er|ez)|oubli(?:e|es|er|ez)|contourn(?:e|es|er|ez)|outrepass(?:e|es|er|ez)|pass(?:e|es|er|ez) outre|ne (?:suis|suivez|respecte|respectez|tiens|tenez) (?:pas|plus)(?: compte)?)(?![\\p{L}]).{0,40}?(?<![\\p{L}])(?:instructions?|consignes?|garde-fous|prompt|r[èe]gles? (?:pr[ée]c[ée]dentes?|ci-dessus|du propri[ée]taire|de l'utilisat(?:eur|rice)|de s[ée]curit[ée]|syst[èe]me)|(?:tes|vos|toutes les|toutes tes|toutes vos) (?:r[èe]gles|limites|restrictions))"),
  rule("override-rules", "danger", "(?:you are now (?:in )?(?:an? )?(?:unrestricted|unfiltered|jailbroken|developer mode)|you have no (?:restrictions|rules|limits)|developer mode (?:is )?enabled|new system prompt|jailbreak|tu n'as (?:plus )?aucune (?:restriction|limite|r[èe]gle)|nouveau prompt syst[èe]me|nouvelles instructions syst[èe]me)"),
  // Approvals.
  rule("skip-approval", "danger", "(?:(?:do not|don't|never|no need to|needn't|ne (?:pas|jamais)|pas besoin de|inutile de)\\s+(?:ask|wait|request|seek|require|demand(?:e|es|er|ez)|attend(?:re|s|ez)?|sollicit(?:e|es|er|ez))|ne (?:demande|demandez|attends|attendez|sollicite|sollicitez) (?:pas|jamais|plus))(?![\\p{L}]).{0,40}?(?<![\\p{L}])(?:approval|permission|confirmation|consent|go-ahead|authori[sz]ation|accord|autorisation|validation|feu vert)", false, SCOPED),
  rule("skip-approval", "danger", "(?:auto-?approv(?:e|es|ing)|approv(?:e|es|ing) (?:it |them |everything |all )?(?:automatically|yourself|on (?:the |your )?(?:owner|user)'?s? behalf)|approuv(?:e|es|er|ez) (?:automatiquement|toi-m[êe]me|vous-m[êe]me|tout(?![\\p{L}]))|(?:bypass(?:es|ing)?|skip(?:s|ping)?|ignor(?:e|es|ing)|contourn(?:e|es|er|ez)|saut(?:e|es|er|ez)|ignor(?:er|ez))(?![\\p{L}]).{0,30}?(?<![\\p{L}])(?:approval|confirmation|permission|validation|autorisation)s?(?: step| prompt| card| request| du propri[ée]taire| de l'utilisat(?:eur|rice))|even if (?:the |your )?(?:owner|user) (?:says no|refuses|declines|denies|disagrees|objects)|m[êe]me si (?:le propri[ée]taire|l'utilisat(?:eur|rice)) (?:refuse|dit non|n'est pas d'accord))"),
  rule("skip-approval", "warning", "(?:without (?:asking|confirmation|approval|permission|being asked|(?:the |your )?(?:owner|user)'?s? (?:consent|approval|permission|agreement))|sans (?:demander|confirmation|accord|validation|autorisation|l'accord|la validation|l'autorisation))"),
  // Hiding things from the owner.
  rule("hide-from-owner", "danger", `(?:(?:do not|don't|never|ne (?:pas|jamais|rien)|without)\\s+(?:tell(?:ing)?|inform(?:ing)?|mention(?:ing)?|notify(?:ing)?|show(?:ing)?|reveal(?:ing)?|report(?:ing)?|disclos(?:e|ing)|warn(?:ing)?|alert(?:ing)?|dire|informer|pr[ée]venir|mentionner|montrer|signaler|r[ée]v[ée]ler|avertir)|ne (?:dis|dites|pr[ée]viens|pr[ée]venez|informe|informez|mentionne|mentionnez|montre|montrez|signale|signalez|r[ée]v[èe]le|r[ée]v[ée]lez|avertis|avertissez) (?:pas|jamais|rien|plus))(?![\\p{L}]).{0,40}?(?<![\\p{L}])(?:${OWNER}|anyone|anybody|personne)`, false),
  rule("hide-from-owner", "danger", `(?:(?:hid(?:e|es|ing)|conceal(?:s|ing)?|keep(?:s|ing)? (?:it|this|that|them) (?:secret|hidden))(?![\\p{L}]).{0,40}?from (?:the |your )?${OWNER}|(?:cach(?:e|es|er|ez)|dissimul(?:e|es|er|ez))(?![\\p{L}]).{0,40}?(?:au propri[ée]taire|[àa] l'utilisat(?:eur|rice)|[àa] l'humain)|secretly|covertly|behind (?:the |your )?(?:owner|user)'?s? back|without (?:the |your )?(?:owner|user)'?s? knowledge|without (?:the |your )?(?:owner|user) (?:knowing|noticing|seeing)|en secret|en cachette|[àa] l'insu (?:du|de l'|de son|de ton)|sans que (?:le propri[ée]taire|l'utilisat(?:eur|rice)) (?:le sache|s'en aper[çc]oive|le voie))`),
  rule("hide-from-owner", "warning", "sans pr[ée]venir(?! (?:le client|la cliente|les clients))"),
  rule("cover-tracks", "warning", "(?:delet(?:e|es|ing)|eras(?:e|es|ing)|clear(?:s|ing)?|wip(?:e|es|ing)|purg(?:e|es|ing)|remov(?:e|es|ing)|effac(?:e|es|er|ez)|supprim(?:e|es|er|ez)|vid(?:e|es|er|ez))(?![\\p{L}]).{0,30}?(?<![\\p{L}])(?:(?:audit |activity |access |system |shell |command )?logs?|audit trail|(?:shell|command|bash|chat|conversation) history|traces|journal d'activit[ée]|journaux|historique (?:des commandes|du terminal|de la conversation|d'activit[ée])|\\.bash_history|\\.zsh_history)"),
  cmd("cover-tracks", "warning", /(?:\bhistory\s+-c\b|\bunset\s+HISTFILE\b|\bHISTFILE=\/dev\/null\b|\bshred\b[^\n]*\.(?:bash|zsh)_history)/i),
  // Data leaving.
  rule("exfiltration", "danger", `${SEND_VERB}(?![\\p{L}]).{0,80}?(?<![\\p{L}])${SECRET_THING}.{0,80}?(?<![\\p{L}])${TO}\\s.{0,40}?${DEST}`),
  rule("exfiltration", "danger", `${SEND_VERB}(?![\\p{L}]).{0,30}?(?<![\\p{L}])${TO}\\s.{0,30}?${DEST}.{0,60}?(?<![\\p{L}])${SECRET_THING}`),
  cmd("exfiltration", "danger", /\b(?:curl|wget|nc|ncat|scp|rsync|http|httpie)\b[^\n]*(?:\.env\b|id_rsa|\.ssh\/|\.aws\/|\.npmrc|\.netrc|cookies?(?:\.sqlite|\.txt|\.json)?\b|credentials\b|keychain|\/etc\/passwd|\/etc\/shadow|\bvault\b)[^\n]*(?:https?:\/\/|@[\w-]+\.|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i),
  cmd("exfiltration", "danger", /\b(?:cat|base64|tar|zip|env|printenv)\b[^\n|]*\|[^\n]*\b(?:curl|wget|nc|ncat)\b[^\n]*(?:https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i),
  rule("send-data", "warning", `${SEND_VERB}(?![\\p{L}]).{0,60}?(?<![\\p{L}])${DATA_THING}.{0,60}?(?<![\\p{L}])${TO}\\s.{0,30}?${ADDRESS}`),
  // Commands.
  cmd("pipe-to-shell", "danger", new RegExp(`\\b(?:curl|wget|fetch|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\\b[^\\n|]*\\|\\s*${SHELL}`, "i")),
  cmd("pipe-to-shell", "danger", new RegExp(`(?:${SHELL}\\s+(?:-c\\s+)?["']?(?:<\\(|\\$\\()\\s*(?:curl|wget)\\b|\\b(?:iex|Invoke-Expression)\\b[^\\n]*\\b(?:irm|iwr|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\\b|\\b(?:irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\\b[^\\n|]*\\|\\s*(?:iex|Invoke-Expression)\\b|\\beval\\s+["']?\\$\\(\\s*(?:curl|wget)\\b)`, "i")),
  cmd("decode-and-run", "danger", new RegExp(`(?:\\bbase64\\s+(?:-d|-D|--decode)\\b[^\\n]*\\|\\s*${SHELL}|\\bxxd\\s+-r\\b[^\\n]*\\|\\s*${SHELL}|\\b(?:eval|exec)\\s*\\(?\\s*["']?\\$\\([^\\n)]*\\bbase64\\s+(?:-d|-D|--decode)|\\b(?:eval|exec|Function)\\s*\\(\\s*(?:atob|Buffer\\.from|base64\\.b64decode|bytes\\.fromhex|binascii\\.unhexlify|codecs\\.decode)\\b|\\bpowershell(?:\\.exe)?\\b[^\\n]*\\s-(?:e|enc|encodedcommand)\\s+[A-Za-z0-9+/=]{16,}|FromBase64String[^\\n]*\\b(?:iex|Invoke-Expression)\\b|\\b(?:iex|Invoke-Expression)\\b[^\\n]*FromBase64String)`, "i")),
  cmd("destructive-command", "danger", new RegExp(`(?:\\brm\\s+(?:-{1,2}[A-Za-z-]+\\s+)*(?:-[A-Za-z]*[rR][A-Za-z]*f[A-Za-z]*|-[A-Za-z]*f[A-Za-z]*[rR][A-Za-z]*|-[rR]\\s+(?:-{1,2}[A-Za-z-]+\\s+)*-f|-f\\s+(?:-{1,2}[A-Za-z-]+\\s+)*-[rR]|--recursive\\s+--force|--force\\s+--recursive)\\s+(?:-{1,2}[A-Za-z-]+\\s+)*["']?${BROAD_PATH}|--no-preserve-root)`)),
  cmd("destructive-command", "danger", /(?:\bmkfs(?:\.\w+)?\s+\S|\bdd\s[^\n]*\bof=\/dev\/(?:sd|hd|nvme|disk|mmcblk|vd)|>\s*\/dev\/(?:sd[a-z]|hd[a-z]|nvme\d|disk\d)|\bformat\s+[a-zA-Z]:|\bdiskpart\b[^\n]*\bclean\b|\bdiskutil\s+(?:eraseDisk|eraseVolume|zeroDisk)\b|\bwipefs\b|:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:|\b(?:del|erase)\s+(?:\/[a-zA-Z]\s+)+[a-zA-Z]:\\(?:\*|\s|$)|\b(?:rd|rmdir)\s+\/s\s+(?:\/q\s+)?[a-zA-Z]:\\|\bRemove-Item\b[^\n]*-Recurse[^\n]*(?:[a-zA-Z]:\\(?:\*|\s|$)|\$HOME|\$env:USERPROFILE|~)|\bchmod\s+-R\s+0?777\s+\/(?:\s|$)|\bchown\s+-R\s+\S+\s+\/(?:\s|$))/i),
  cmd("disable-security", "danger", /(?:\bsetenforce\s+0\b|\bufw\s+disable\b|\bsystemctl\s+(?:stop|disable|mask)\s+(?:--now\s+)?(?:ufw|firewalld|apparmor|clamav\S*|auditd|fail2ban|falcon-sensor)\b|\bSet-MpPreference\b[^\n]*-Disable\w+\s+(?:\$true|1)\b|\bspctl\s+--master-disable\b|\bcsrutil\s+disable\b|\bnetsh\s+advfirewall\s+set\s+\S+\s+state\s+off\b|\biptables\s+-F\b)/i),
  rule("disable-security", "danger", "(?:disabl(?:e|es|ing)|turn(?:s|ing)? off|switch(?:es|ing)? off|uninstall(?:s|ing)?|kill(?:s|ing)?|stop(?:s|ping)?|d[ée]sactiv(?:e|es|er|ez)|coup(?:e|es|er|ez)|arr[êe]t(?:e|es|er|ez)|d[ée]sinstall(?:e|es|er|ez))(?![\\p{L}]).{0,40}?(?<![\\p{L}])(?:anti-?virus|firewall|pare-feu|defender|gatekeeper|selinux|apparmor|endpoint protection|security (?:software|tools?|checks?|scans?|scanner|updates)|system integrity protection|two-factor|2fa|double authentification|safety checks?|contr[ôo]le de s[ée]curit[ée]|logiciel de s[ée]curit[ée]|sandbox(?![\\p{L}])|bac [àa] sable)"),
  // Money.
  rule("payment-unasked", "danger", `${PAY}.{0,80}?(?<![\\p{L}])${UNASKED}`),
  rule("payment-unasked", "danger", `${UNASKED}.{0,60}?(?<![\\p{L}])${PAY}`),
  rule("payment-details", "warning", "(?:enter|type|fill(?: in)?|use|send|saisi(?:s|r|ssez)|entr(?:e|es|er|ez)|rempli(?:s|r|ssez)|utilis(?:e|es|er|ez)|envo(?:ie|ies|yer|yez))(?![\\p{L}]).{0,40}?(?<![\\p{L}])(?:card number|credit card|debit card|cvv|cvc|num[ée]ro de carte|carte (?:bancaire|bleue|de cr[ée]dit)|iban|wallet address|adresse (?:du |de )?(?:portefeuille|wallet)|seed phrase|phrase de r[ée]cup[ée]ration|bitcoin|crypto(?:monnaie|currency)?)"),
  // The bot changing itself.
  rule("self-modify", "danger", "(?:(?:edit|modify|chang(?:e|ing)|rewrit(?:e|ing)|updat(?:e|ing)|alter|extend|rais(?:e|ing)|increas(?:e|ing)|remov(?:e|ing)|delet(?:e|ing)|disabl(?:e|ing)|turn off|relax|loosen|widen)(?![\\p{L}]).{0,30}?(?<![\\p{L}])your (?:own )?(?:rules?|permissions?|autonomy|approval settings?|safety (?:rules|settings)|guardrails|system prompt)|(?:grant|give) yourself (?:more |full |admin |all )?(?:permissions?|access|rights|autonomy|privileges)|set (?:your )?autonomy to|(?:activate|enable|approve) (?:this|the|your|that) skill (?:yourself|automatically|on your own|without)|mark (?:this|the) skill as (?:active|trusted|approved|safe|verified))"),
  rule("self-modify", "danger", "(?:(?:modifi(?:e|es|er|ez)|chang(?:e|es|er|ez)|r[ée][ée]cri(?:s|t|re|vez)|met(?:s|tre|tez)? [àa] jour|supprim(?:e|es|er|ez)|d[ée]sactiv(?:e|es|er|ez)|augment(?:e|es|er|ez)|[ée]largi(?:s|r|ssez)|assoupli(?:s|r|ssez))(?![\\p{L}]).{0,30}?(?<![\\p{L}])(?:(?:tes|vos) (?:propres )?(?:r[èe]gles|permissions|droits|autorisations|garde-fous)|(?:ton|votre) (?:propre )?(?:autonomie|niveau d'autonomie|prompt syst[èe]me))|(?:accorde|donne)(?:-toi|z-vous) (?:plus de |tous les |toutes les )?(?:droits|permissions|acc[èe]s|autorisations)|(?:activ(?:e|es|er|ez)|approuv(?:e|es|er|ez)) (?:cette|la|ta) comp[ée]tence (?:toi-m[êe]me|tout seul|toute seule|automatiquement|sans))"),
  rule("self-modify", "warning", "(?:(?:edit|modify|chang(?:e|ing)|rewrit(?:e|ing)|updat(?:e|ing)|alter|delet(?:e|ing)|replac(?:e|ing))(?![\\p{L}]).{0,30}?(?<![\\p{L}])your (?:own )?(?:instructions|skills?|settings)|(?:modifi(?:e|es|er|ez)|chang(?:e|es|er|ez)|r[ée][ée]cri(?:s|t|re|vez)|supprim(?:e|es|er|ez)|remplac(?:e|es|er|ez))(?![\\p{L}]).{0,30}?(?<![\\p{L}])(?:tes|vos) (?:propres )?(?:instructions|comp[ée]tences|r[ée]glages))"),
  // Links whose real destination is not readable.
  cmd("short-link", "warning", /(?:https?:\/\/|\bwww\.)(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|v\.gd|ow\.ly|buff\.ly|cutt\.ly|rebrand\.ly|shorturl\.at|rb\.gy|tiny\.cc|lnkd\.in|s\.id|t\.ly|bl\.ink|shorte\.st|adf\.ly|urlz\.fr|bitly\.com|tiny\.one|qrco\.de)\/\S+/i),
  cmd("ip-link", "warning", /(?:https?|ftp):\/\/(?:[^\s/@]+@)?(?!(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0|169\.254\.))(?:(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-fA-F:]+\]|0x[0-9a-fA-F]{8}|\d{8,10})(?=[:/\s"'`)\]>]|$)/i),
];

/** A heading or a list opener that is only a prohibition ("## 5. Never", "À ne jamais faire :"): what is under it is forbidden. */
const PROHIBITION_HEAD = /^(?:#{1,6}\s*|\*\*)?(?:\d+[.)]\s*)?(?:never|do not|don['’]t|not allowed|forbidden|what not to do|things to avoid|avoid|jamais|interdits?|[àa] ne (?:jamais|pas) faire|[àa] [ée]viter|ne (?:fais|faites) (?:jamais|pas))\s*(?:\*\*)?\s*[:.!]?\s*(?:\*\*)?\s*$/iu;
/** "never", "do not", "ne … jamais"… at the end of what comes before the risky words, in the same sentence. */
const NEGATION = /(?<![\p{L}\p{N}_])(?:never(?! mind)|do(?:es)? not|don['’]?t|doesn['’]?t|must not|mustn['’]?t|should not|shouldn['’]?t|shall not|cannot|can['’]?t|may not|not allowed to|avoid(?:s|ing)?|refus(?:e|es|ing) to|forbidden|prohibited|rather than|instead of|ne (?:jamais|pas|plus)|ne [\p{L}'’-]+ (?:jamais|pas|plus)|n['’][\p{L}-]+ (?:jamais|pas|plus)|jamais|interdit(?:e|s|es)? de|il est interdit|[ée]vit(?:e|es|er|ez)|refus(?:e|es|er|ez) de|au lieu de|plut[ôo]t que)(?![\p{L}])[^.;:!?\n]{0,70}$/iu;

/** French puts the verb inside the negation ("ne désactive jamais"): "ne" just before the risky verb, "jamais/pas/plus" just after. */
const FR_NE_BEFORE = /(?<![\p{L}])(?:ne\s+|n['’])(?:(?:le|la|les|lui|leur|en|y|te|me|se)\s+)?$/iu;
const FR_PAS_AFTER = /^[\p{L}'’-]+\s+(?:jamais|pas|plus)(?![\p{L}])/iu;

// Characters nobody sees. Overrides flip the reading order; "tags" and long runs of zero-width marks can carry a text.
const BIDI_OVERRIDE = /[\u202D\u202E]/u;
const BIDI_OTHER = /[\u202A-\u202C\u2066-\u2069]/u;
const TAG_CHARS = /[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]{2,}|[\uFE00-\uFE0F]{3,}/u;
const ZERO_WIDTH = /[\u200B\u200C\u200E\u200F\u2060-\u2064\uFEFF\u061C\u180E\u00AD]|(?<![\p{Extended_Pictographic}\p{M}\u0900-\u0DFF\uFE0F])\u200D/gu;
const INVISIBLE_ALL = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u061C\u180E\u00AD]|(?<![\p{Extended_Pictographic}\p{M}\u0900-\u0DFF\uFE0F])\u200D|[\u{E0000}-\u{E01EF}]/gu;
/** A flag emoji written with tag characters (England, Scotland, Wales): the one harmless use of them. */
const FLAG_TAGS = /\u{1F3F4}[\u{E0020}-\u{E007E}]{1,6}\u{E007F}/gu;
const HIDDEN_BLOCK = /<!--([\s\S]*?)(?:-->|$)|^\[\/\/\]:\s*#\s*[("'](.*)[)"']\s*$|<[a-z][^>\n]*(?:\shidden(?:\s|>|=)|display\s*:\s*none|font-size\s*:\s*0|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]))[^>\n]*>/gim;
const INSTRUCTION_WORDS = /(?<![\p{L}])(?:you (?:must|should|shall|will|are)|always|never|ignore|send|run|execute|do not|don't|make sure|remember to|assistant|system\s*:|instructions?|tu dois|vous devez|toujours|jamais|ignore[rz]?|envoie|envoyez|ex[ée]cute[rz]?|lance[rz]?|n'oublie pas|consignes?)(?![\p{L}])/iu;
const BLOB = /(?<![A-Za-z0-9+/=_-])(?:[A-Za-z0-9+/]{160,}={0,2}|(?:[0-9a-fA-F]{2}){64,}|(?:\\x[0-9a-fA-F]{2}){24,})(?![A-Za-z0-9+/=_-])/;

const MAX_FINDINGS = 40;
const RANK: Record<ScanSeverity, number> = { danger: 0, warning: 1, info: 2 };

/** shared.ts finds "password: word" in plain sentences too: here a labelled value counts only when it looks generated. */
const realSecrets = (line: string) => maskSecrets(line, "").secrets.filter((x) => x.kind !== "password" || (x.value.length >= 8 && /\d/.test(x.value) && /[A-Za-z]/.test(x.value)));
/** The line with those secrets replaced (the existing masking helper finds them; the places are its own). */
function maskLine(line: string): string {
  let out = "", at = 0;
  for (const x of realSecrets(line)) { out += `${line.slice(at, x.start)}[secret]`; at = x.end; }
  return out + line.slice(at);
}
/** A quote for the owner: secrets masked (shared.ts maskSecrets, then the shapes mentionsKey knows), invisible characters named. */
function quote(line: string, at = 0): string {
  const start = Math.max(0, at - 40);
  let s = maskLine(line).slice(start, start + 220);
  s = s
    .replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp]|hf|AIza)[-_][A-Za-z0-9_-]{12,}/g, "[secret]")
    .replace(/((?:KEY|TOKEN|SECRET)\s*[=:]\s*["']?)[A-Za-z0-9_\-./+]{16,}/g, "$1[secret]")
    .replace(/[A-Za-z0-9+/=]{48,}/g, (m) => `${m.slice(0, 12)}…(${m.length})`)
    .replace(INVISIBLE_ALL, (ch) => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`)
    .replace(/\s+/g, " ").trim();
  if (s.length > 160) s = `${s.slice(0, 159)}…`;
  return `${start > 0 ? "…" : ""}${s}`;
}

/** The findings of one text, lines counted from `firstLine` (0: every finding is given line 0). */
export function scanText(text: string, firstLine = 1): ScanFinding[] {
  const out: ScanFinding[] = [];
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  const lineNo = (i: number) => (firstLine === 0 ? 0 : firstLine + i);
  const add = (code: ScanCode, severity: ScanSeverity, i: number, excerpt: string, negated = false) => {
    const line = lineNo(i);
    const same = out.find((f) => f.code === code && f.line === line);
    if (!same) out.push({ code, severity, line, excerpt, negated });
    else if (RANK[severity] < RANK[same.severity]) Object.assign(same, { severity, excerpt, negated });
  };

  let zeroWidth = 0;
  // "heading": under a prohibition heading, until the next heading; "list": under a prohibition line, while the list lasts.
  let forbidden: "" | "heading" | "list" = "";
  for (const [i, raw] of lines.entries()) {
    const shown = raw.trim();
    if (/^#{1,6}\s/.test(shown)) forbidden = PROHIBITION_HEAD.test(shown) ? "heading" : "";
    else if (PROHIBITION_HEAD.test(shown)) forbidden = "list";
    else if (forbidden === "list" && shown && !/^(?:[-*+•]|\d+[.)])\s/.test(shown)) forbidden = "";
    if (!raw.trim() && raw.search(INVISIBLE_ALL) < 0) continue;
    // Invisible characters are reported, then taken out so that they cannot split a word the rules look for.
    if (BIDI_OVERRIDE.test(raw)) add("bidi-text", "danger", i, quote(raw, raw.search(BIDI_OVERRIDE)));
    else if (BIDI_OTHER.test(raw)) add("bidi-text", "warning", i, quote(raw, raw.search(BIDI_OTHER)));
    const tag = TAG_CHARS.exec(raw.replace(FLAG_TAGS, ""));
    if (tag) add("invisible-text", "danger", i, quote(raw.replace(FLAG_TAGS, ""), tag.index));
    const zw = raw.match(ZERO_WIDTH) ?? [];
    if (zw.length) {
      const counted = zw.filter((ch) => ch !== "\u00AD").length;
      zeroWidth += counted;
      const run = /[\u200B-\u200D\u2060-\u2064\uFEFF]{4,}/u.test(raw);
      add("invisible-text", run ? "danger" : "warning", i, quote(raw, raw.search(ZERO_WIDTH)));
    }
    const line = raw.replace(INVISIBLE_ALL, "").normalize("NFKC");

    for (const r of RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      const inline = NEGATION.test(line.slice(0, m.index)) || (FR_NE_BEFORE.test(line.slice(0, m.index)) && FR_PAS_AFTER.test(line.slice(m.index)));
      const negated = r.negatable && (!!forbidden || inline);
      // A "Never" heading far above the line is weaker evidence than a negation on the line itself, and a heading is easy
      // to plant: what would be a danger stays visible as a warning there.
      const severity = negated ? (!inline && r.severity === "danger" ? "warning" : "info") : r.soften?.test(line.slice(m.index)) && r.severity === "danger" ? "warning" : r.severity;
      add(r.code, severity, i, quote(line, m.index), negated);
    }
    if (mentionsKey(line) || realSecrets(line).length) add("embedded-secret", "warning", i, quote(line));
    const blob = BLOB.exec(line);
    // A picture written inline ("data:image/…;base64,…") is a blob too, but a harmless one.
    if (blob) add("encoded-blob", /data:(?:image|font|audio)\/[\w.+-]+;base64,\s*$/i.test(line.slice(0, blob.index)) ? "info" : "warning", i, quote(line, blob.index));
  }
  // Many zero-width marks over the whole text: enough room to carry hidden words.
  if (zeroWidth >= 12) for (const f of out) if (f.code === "invisible-text") f.severity = "danger";

  // Text the reader of the rendered page does not see: HTML comments, hidden tags, markdown "[//]: #" comments.
  for (const m of src.matchAll(HIDDEN_BLOCK)) {
    const inner = (m[1] ?? m[2] ?? "").trim();
    const i = src.slice(0, m.index).split("\n").length - 1;
    if (m[1] === undefined && m[2] === undefined) add("html-comment", "warning", i, quote(m[0]));
    else if (inner) add("html-comment", INSTRUCTION_WORDS.test(inner) ? "warning" : "info", i, quote(m[0]));
  }
  return out;
}

const worstOf = (f: ScanFinding[]): SkillScan["worst"] => (f.some((x) => x.severity === "danger") ? "danger" : f.some((x) => x.severity === "warning") ? "warning" : f.length ? "info" : "ok");

type SkillParts = { name?: string; description?: string; body: string } & Partial<SkillExtras>;
const partsText = (s: SkillParts) => [s.name ?? "", s.description ?? "", s.needs ?? "", s.approvals ?? "", s.check ?? "", s.output ?? ""].filter(Boolean).join("\n");

/** The check of one skill: its steps line by line, and its short fields (name, "when", needs…) as line 0. */
export function scanSkill(s: SkillParts): SkillScan {
  const all = [...scanText(partsText(s), 0), ...scanText(s.body ?? "")];
  all.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.line - b.line);
  return { worst: worstOf(all), findings: all.slice(0, MAX_FINDINGS), truncated: all.length > MAX_FINDINGS };
}

/** A skill of a team file or a template ("when" + steps) with its check, for the review screen. */
export const withScan = <T extends { name: string; when: string; steps: string }>(s: T): T & { scan: SkillScan } => ({ ...s, scan: scanSkill({ name: s.name, description: s.when, body: s.steps }) });

// ── What is kept with each skill ─────────────────────────────────────────────────────────────────────────────────

const hashOf = (s: SkillParts) => createHash("sha256").update(JSON.stringify([s.name ?? "", s.description ?? "", s.body, s.needs ?? "", s.approvals ?? "", s.check ?? "", s.output ?? ""])).digest("hex");

export interface ScanState { scan: SkillScan; /** The owner accepted this exact text. */ accepted: boolean; /** Danger, not accepted: cannot be active. */ blocked: boolean }

/** Scans a stored skill and keeps the result. Changes nothing else. */
export function recordScan(skill: Skill): ScanState {
  const scan = scanSkill(skill), hash = hashOf(skill);
  q.run("INSERT INTO skill_scans (skill_id, text_hash, worst, findings, scanned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(skill_id) DO UPDATE SET text_hash = excluded.text_hash, worst = excluded.worst, findings = excluded.findings, scanned_at = excluded.scanned_at",
    skill.id, hash, scan.worst, JSON.stringify(scan.findings), now());
  const accepted = q.get<{ accepted_hash: string | null }>("SELECT accepted_hash FROM skill_scans WHERE skill_id = ?", skill.id)?.accepted_hash === hash;
  return { scan, accepted, blocked: scan.worst === "danger" && !accepted };
}

const rawSkill = (id: string) => { const r = q.get<{ bot_id: string }>("SELECT bot_id FROM skills WHERE id = ?", id); return r ? skills.list(r.bot_id).find((k) => k.id === id) ?? null : null; };

/**
 * Runs each time a skill's text is saved, whoever saved it (store.ts calls it from skills.create and skills.update):
 * a text with a "danger" finding that its owner has not accepted is put back as a draft, so a bot never gets it.
 */
function guard(skillId: string): void {
  const skill = rawSkill(skillId);
  if (!skill) return;
  if (recordScan(skill).blocked && !skill.draft) q.run("UPDATE skills SET draft = 1 WHERE id = ?", skillId);
}
setSkillGuard(guard);

/** For the code that just saved a skill: its state after the check. */
export function scanStateOf(skillId: string): (ScanState & { skill: Skill }) | null {
  const skill = rawSkill(skillId);
  return skill ? { ...recordScan(skill), skill } : null;
}

/** What a bot is told after it saved a skill the check flagged ("" when nothing serious was found). */
export function botNote(botId: string, name: string): string {
  const skill = skills.list(botId).find((k) => k.name.toLowerCase() === name.trim().toLowerCase());
  const st = skill ? recordScan(skill) : null;
  if (!st?.blocked) return "";
  const codes = [...new Set(st.scan.findings.filter((f) => f.severity === "danger").map((f) => f.code))].join(", ");
  return ` It is kept as a DRAFT and you cannot use it: the safety check found a risk in its text (${codes}). Only the user can read the findings and accept it (the bot's settings → Skills). Tell them in plain words; do not rewrite it to get around the check.`;
}

/** The owner read the findings and accepts this exact text: the skill becomes active. Null: not theirs. */
export function acceptSkill(userId: string, skillId: string): Skill | null {
  const skill = skills.owned(userId, skillId);
  if (!skill) return null;
  const st = recordScan(skill);
  q.run("UPDATE skill_scans SET accepted_hash = ?, accepted_at = ? WHERE skill_id = ?", hashOf(skill), now(), skill.id);
  q.run("UPDATE skills SET draft = 0 WHERE id = ?", skill.id);
  const codes = [...new Set(st.scan.findings.filter((f) => f.severity !== "info").map((f) => f.code))].join(", ");
  audit(userId, "account", `Skill accepted after the safety check: ${skill.name}${codes ? ` (${codes})` : ""}`, skill.botId);
  return skills.owned(userId, skillId);
}

/** The check of the skills of one bot (which the caller owns), by skill id. */
export function scanBot(botId: string): Record<string, ScanState> {
  return Object.fromEntries(skills.list(botId).map((k) => [k.id, recordScan(k)]));
}

/** « Vérifier mes compétences »: every skill of every bot of the account, the ones with findings listed. */
export function scanAccount(userId: string): SkillScanReport {
  const entries: SkillScanEntry[] = [];
  let total = 0;
  for (const b of bots.list(userId)) {
    if (b.kind !== "agent") continue;
    for (const k of skills.list(b.id)) {
      total += 1;
      const st = recordScan(k);
      if (st.scan.worst !== "ok") entries.push({ skillId: k.id, botId: b.id, botName: b.name, name: k.name, draft: k.draft, accepted: st.accepted, scan: st.scan });
    }
  }
  const rank = (w: SkillScan["worst"]) => (w === "ok" ? 3 : RANK[w]);
  entries.sort((a, b) => rank(a.scan.worst) - rank(b.scan.worst) || a.botName.localeCompare(b.botName) || a.name.localeCompare(b.name));
  return { scannedAt: now(), skills: total, clean: total - entries.length, entries };
}
