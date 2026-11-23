/**
 * The gallery's « salons » section (section=salons): « Qui répond » in a group chat with fake data — a conversation where
 * the automatic mode routed messages (open line with « Plutôt demander à… », a re-routed one, chit-chat nobody answers,
 * an offer accepted), and the group's settings (the rule, Discret, Proposer avant de commencer). Development only.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Bot, RoomRule, Row } from "../types";
import { buildItems, RowItems } from "../components/Transcript";
import { RoomWhoAnswers } from "../components/RoomRouting";
import { RoomNotes } from "../components/RoomNotes";
import { RoomLimits } from "../components/RoomLimits";
import { NOW, type FixtureOptions } from "./fixtures";

const ROOM = "room_gallery";
const member = (id: string, name: string, label: string, color: string, shape: string): Bot =>
  ({ id, kind: "agent", name, label, description: "", instructions: "", shape, color, pause: null, access: null, memberIds: [] } as unknown as Bot);

export function GalleryRooms({ o }: { o: FixtureOptions }) {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const lea = member("bot_lea", "Léa", L("Compta", "Accounts"), "moss", "pebble");
  const marc = member("bot_marc", "Marc", "Marketing", "ember", "bean");
  const zoe = member("bot_zoe", "Zoé", "Support", "sky", "cloud");
  const room = { ...member(ROOM, L("Équipe", "Team"), L("Groupe", "Group"), "slate", "squircle"), kind: "room", roomRule: "auto", memberIds: [lea.id, marc.id, zoe.id] } as unknown as Bot;
  const [rule, setRule] = useState<RoomRule>("auto");
  useEffect(() => {
    const before = useStore.getState().bots;
    useStore.setState({ bots: { ...before, [ROOM]: room, [lea.id]: lea, [marc.id]: marc, [zoe.id]: zoe } });
    return () => useStore.setState({ bots: before });
  }, [o.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    let seq = 0;
    const at = NOW - 30 * 60_000;
    const r = (body: Row["body"], i: number): Row => ({ botId: ROOM, generation: 1, seq: ++seq, rev: 1, createdAt: at + i * 60_000, body });
    const fromBot = (b: Bot, text: string) => ({ kind: "message" as const, role: "assistant" as const, text, origin: { kind: "bot" as const, id: b.id, name: b.name } });
    const route = (messageSeq: number, b: Bot | null, by: "keywords" | "model" | "none" | "reroute", why: string, status: "open" | "rerouted" | "archived", text: string) =>
      ({ kind: "notice" as const, tone: "info" as const, text, action: { kind: "route" as const, messageSeq, thread: 0, botId: b?.id ?? "", botName: b?.name ?? "", by, why, status } });
    return [
      r({ kind: "message", role: "user", text: L("La facture de mars pour Dupont est partie ?", "Did the March invoice for Dupont go out?") }, 0),
      r(route(1, lea, "keywords", L("son rôle correspond", "its role matches"), "open", L("→ Léa (Compta) a pris la question · son rôle correspond", "→ Léa (Accounts) took the question · its role matches")), 1),
      r(fromBot(lea, L("Oui, envoyée hier à 16 h. Je relance mardi s'il n'y a pas de paiement.", "Yes, sent yesterday at 4 pm. I will chase it on Tuesday if it is not paid.")), 2),
      r({ kind: "message", role: "user", text: L("Quelqu'un peut regarder les chiffres de la newsletter ?", "Can someone look at the newsletter numbers?") }, 3),
      r(route(4, zoe, "reroute", L("à ta demande", "you asked"), "rerouted", L("→ Zoé (Support) a pris la question · à ta demande", "→ Zoé (Support) took the question · you asked")), 4),
      r({ kind: "message", role: "user", text: L("Merci à tous, bon week-end !", "Thanks all, have a good weekend!") }, 5),
      r(route(6, null, "none", "", "open", L("Personne ne répond : ça ressemble à une discussion qui n'appelle pas de réponse.", "Nobody answers: this reads like chit-chat that needs no answer.")), 6),
      r({ kind: "message", role: "user", text: L("Il faudrait un post LinkedIn pour le lancement de jeudi.", "We need a LinkedIn post for Thursday's launch.") }, 7),
      r(route(8, marc, "model", L("lancement, réseaux sociaux", "launch, social media"), "open", L("→ Marc (Marketing) a pris la question · lancement, réseaux sociaux", "→ Marc (Marketing) took the question · launch, social media")), 8),
      r(fromBot(marc, L("Je peux m'en charger : un post de 5 lignes avec le visuel du lancement. Je m'y mets ?", "I can take this: a 5-line post with the launch visual. Shall I start?")), 9),
      r({ kind: "message", role: "user", text: L("oui", "yes") }, 10),
      r({ kind: "notice", tone: "info", text: L("Marc s'y met.", "Marc is on it.") }, 11),
      r({ kind: "message", role: "user", text: L("Qui peut trier les vieux tickets ?", "Who can sort the old tickets?") }, 12),
      r(route(13, zoe, "keywords", L("son rôle correspond", "its role matches"), "archived", L("→ Zoé (Support) a pris la question · son rôle correspond", "→ Zoé (Support) took the question · its role matches")), 12),
      r({ kind: "notice", tone: "info", text: L("Zoé est en attente dans ce groupe : écris « reprends @Zoé » pour le relancer.", "Zoé is on hold in this group: write « reprends @Zoé » to bring it back.") }, 12),
      r(fromBot(marc, L("@Zoé, je te passe la main : les questions des clients sur le lancement sont pour toi.", "@Zoé, I'm handing this over to you: customer questions about the launch are yours.")), 12),
    ];
  }, [o.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => buildItems(rows, false), [rows]);
  return (
    <section className="gallery-section" id="g-salons" aria-labelledby="g-salons-h">
      <h2 id="g-salons-h" className="gallery-h">{L("Salons : qui répond", "Group chats: who answers")}</h2>
      <div className="gallery-rooms">
        <div className="gallery-chat rooms-chat"><RowItems items={items} bot={room} /></div>
        <div className="gallery-chat rooms-settings"><RoomWhoAnswers room={room} value={rule} onChange={setRule} /><RoomLimits room={room} initial={{ limits: { [lea.id]: 30 }, min: 1, max: 240, held: [zoe.id] }} /><RoomNotes room={room} initial={[
          { id: "mem_room_1", botId: ROOM, text: L("Les livrables partent le vendredi avant 17 h.", "Deliverables go out on Fridays before 5 pm."), source: "chat", createdAt: NOW - 3 * 86400_000, status: "active", quote: "", category: null, confidence: "once", confirmedAt: null, lastUsedAt: null, pinned: true, until: null },
          { id: "mem_room_2", botId: ROOM, text: L("Marc relit chaque newsletter avant l'envoi.", "Marc proofreads every newsletter before it goes out."), source: "chat", createdAt: NOW - 86400_000, status: "active", quote: "", category: null, confidence: "once", confirmedAt: null, lastUsedAt: null, until: "2027-03-31" },
        ]} /></div>
      </div>
    </section>
  );
}
