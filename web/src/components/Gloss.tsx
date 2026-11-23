import { useId, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { glossOf, type GlossTerm } from "../lib/glossary";
import "./Comfort7.css";

/** A word with its plain explanation (L161): on hover, keyboard focus or tap; Escape closes it. */
export function Gloss({ term, children }: { term: GlossTerm; children?: ReactNode }) {
  const lang = useStore((s) => (s.locale === "fr" ? "fr" : "en"));
  const [open, setOpen] = useState(false);
  const id = useId();
  const [word, text] = glossOf(term, lang);
  return (
    <span className="gloss" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="gloss-word" aria-describedby={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
        {children ?? word}
      </button>
      {open && <span role="tooltip" id={id} className="gloss-tip"><strong>{word}</strong> — {text}</span>}
    </span>
  );
}
