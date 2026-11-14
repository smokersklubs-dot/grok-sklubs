/**
 * Anonymises a procedure before it is offered as a learned skill (spec 07 A9): email addresses, web addresses' paths
 * and queries, phone numbers, IBANs and card-like numbers, amounts, order or account numbers and other long numbers,
 * dates, and people's names (after a title or a "to/for/from" word, and the names the caller knows) become
 * placeholders. It is deterministic and errs on the side of replacing too much; the user reviews the result before
 * anything is saved.
 */
export function anonymise(text: string, knownNames: string[] = []): string {
  let s = text;
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "{email}");
  // Keep the site (what the procedure is about), drop what identifies a person or an order in the address.
  s = s.replace(/\b(https?:\/\/[^\s/?#]+)([^\s)]*)/gi, (_m, origin: string, rest: string) => (rest && rest !== "/" ? `${origin}/{path}` : origin));
  s = s.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, "{iban}");
  s = s.replace(/\b(?:\d[ -]?){13,19}\b/g, "{card_number}");
  s = s.replace(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}\b/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "{phone}" : m));
  s = s.replace(/(?:[€$£]\s?\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*\s?(?:€|\$|£|eur\b|euros?\b|usd\b|dollars?\b))/gi, "{amount}");
  s = s.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g, "{date}");
  s = s.replace(/\b(?:[A-Z]{1,4}[-#]?)?\d{4,}(?:[-/]\d+)*\b/g, "{number}");
  // People: after a title, or a word that introduces who something goes to or comes from.
  s = s.replace(/\b(M\.|Mme|Mlle|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Me)\s+[A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+)?/gu, "$1 {name}");
  s = s.replace(/\b(à|a|pour|de la part de|chez|avec|to|for|from|with|dear|cher|chère|bonjour|hello|hi)\s+([A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+)?)/gu, (m, w: string, name: string) => (COMMON.has(name.toLowerCase()) ? m : `${w} {name}`));
  for (const n of knownNames.map((x) => x.trim()).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu"), "{name}");
  }
  return s;
}

/** Capitalised words after "to/for…" that are not people (start of a step, common nouns written with a capital). */
const COMMON = new Set(["the", "le", "la", "les", "un", "une", "this", "that", "google", "gmail", "outlook", "amazon", "paypal", "chrome", "settings", "paramètres", "parametres", "page", "site", "menu", "button", "bouton", "step", "étape", "etape", "home", "accueil", "panier", "cart", "checkout", "login", "connexion"]);
