/**
 * Sets a new password for an account, from the server's own command line. With an SMTP account set up (Settings →
 * Account → E-mails du serveur, or SMTP_* variables), people can also use "Mot de passe oublié ?" on the sign-in page.
 *   node server/dist/reset-password.js you@example.com
 * Prints the new password once. Every device signed in to that account is signed out.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "./auth.js";
import { q } from "./db.js";
import { account, audit, users } from "./store.js";

const email = process.argv[2];
const user = email ? users.byEmail(email) : null;
if (!user) {
  console.error(email ? `No account uses the address ${email}.` : "Usage: reset-password <email>");
  process.exit(1);
}
const password = randomBytes(9).toString("base64url");
account.setPassword(user.id, hashPassword(password));
q.run("DELETE FROM sessions WHERE user_id = ?", user.id);
q.run("DELETE FROM password_resets WHERE user_id = ?", user.id);
audit(user.id, "account", "Password reset from the server's command line");
console.log(`New password for ${user.email}: ${password}\nSign in with it, then change it in Settings → Account.`);
