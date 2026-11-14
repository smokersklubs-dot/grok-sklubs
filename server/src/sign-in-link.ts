/**
 * Prints a one-time sign-in link for an account (valid 15 minutes, works once).
 *   node server/dist/sign-in-link.js you@example.com
 */
import { config } from "./config.js";
import { q } from "./db.js";
import { now, randomToken, sha256, users } from "./store.js";

const user = process.argv[2] ? users.byEmail(process.argv[2]) : null;
if (!user) {
  console.error(process.argv[2] ? `No account uses the address ${process.argv[2]}.` : "Usage: sign-in-link <email>");
  process.exit(1);
}
const token = randomToken(24);
q.run("INSERT INTO sign_in_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(token), user.id, now() + 15 * 60_000);
console.log(`${config.publicUrl}/api/auth/link?token=${token}\n(valid 15 minutes, works once)`);
