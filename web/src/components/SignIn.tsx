import { useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { ErrorNote } from "./ui";

export function SignIn() {
  const signupOpen = useStore((s) => s.signupOpen);
  const signedIn = useStore((s) => s.signedIn);
  const [mode, setMode] = useState<"login" | "signup">(signupOpen ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), email: useId(), password: useId() };
  const creating = mode === "signup" && signupOpen;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    if (!mail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    if (creating && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = creating
        ? await api<{ user: User }>("POST", "/auth/signup", { email: mail, name: name.trim() || undefined, password })
        : await api<{ user: User }>("POST", "/auth/login", { email: mail, password });
      await signedIn(r.user);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit} noValidate>
        <div className="signin-brand">
          <Avatar shape="squircle" color="ember" name="S" size={56} />
          <h1>Sklubot</h1>
          <p>Your own team of AI bots — each with its own memory, skills, routines and browser desktop.</p>
        </div>

        <h2 className="signin-title">{creating ? "Create your account" : "Sign in"}</h2>

        {creating && (
          <div className="field">
            <label className="field-label" htmlFor={ids.name}>Name</label>
            <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} placeholder="What should your bots call you?" />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={ids.email}>Email</label>
          <input id={ids.email} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder="you@example.com" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.password}>Password</label>
          <input
            id={ids.password}
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={creating ? "new-password" : "current-password"}
          />
          {creating && <p className="field-hint">At least 8 characters.</p>}
        </div>

        <ErrorNote>{error}</ErrorNote>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? (creating ? "Creating account…" : "Signing in…") : creating ? "Create account" : "Sign in"}
        </button>

        {signupOpen && (
          <p className="signin-switch">
            {creating ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(creating ? "login" : "signup");
                setError(null);
              }}
            >
              {creating ? "Sign in" : "Create an account"}
            </button>
          </p>
        )}
        {!signupOpen && <p className="signin-switch">Sign-ups are closed on this server. Ask its owner for an account.</p>}
      </form>
      <p className="signin-foot">Sklubot is self-hosted, open-source software. Your conversations stay on this server.</p>
    </main>
  );
}
