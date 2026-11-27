/**
 * Gallery « relais »: « Un ordinateur pour tous mes bots » (server computershare.ts) on the real components —
 * the control card with « Pour tous mes bots », the line in Settings → Computers, « Ordinateur de ce bot » (two
 * linked devices, one not connected), and the line a bot writes while it waits for the computer.
 */
import { useState } from "react";
import { CardView } from "../components/Cards";
import { AllBotsControlView, BotRelayDeviceView, type DeviceChoice } from "../components/ComputerShare";
import type { Card } from "../types";
import { GALLERY_BOT_ID, type FixtureOptions } from "./fixtures";

export function GalleryComputerShare({ o }: { o: FixtureOptions }) {
  const F = o.lang === "fr";
  const device = o.long ? (F ? "portable de Léa au bureau du deuxième étage (Linux)" : "Léa’s laptop at the second-floor office (Linux)") : (F ? "portable de Léa (Linux)" : "Léa’s laptop (Linux)");
  const card: Card = {
    type: "approval", approvalId: "ap_share", status: "pending",
    title: F ? `Autoriser Jiren à prendre le contrôle de ${device} (voir l’écran, utiliser la souris et le clavier) ?` : `Allow Jiren to take control of ${device} (see the screen, use the mouse and the keyboard)?`,
    detail: "", tool: "mycomputer: control: Jiren", source: F ? "Mon ordinateur" : "My computer",
  };
  const devices: DeviceChoice[] = [
    { id: "d1", name: "portable", label: device, kind: "computer", online: true },
    { id: "d2", name: "bureau", label: F ? "iMac du bureau (macOS)" : "Office iMac (macOS)", kind: "computer", online: false },
  ];
  const [chosen, setChosen] = useState<string | null>("d2");
  const [on, setOn] = useState(true);
  const waiting = F ? `En attente de l'ordinateur ${device}, utilisé par Max : numéro 2 dans la file, après Zoé. Je continue tout seul dès qu'il est libre.`
    : `Waiting for the computer ${device}, used by Max: number 2 in line, behind Zoé. I will go on by myself as soon as it is free.`;
  return (
    <div className="computer-share-gallery" style={{ display: "grid", gap: 12, maxWidth: 760 }}>
      <CardView card={card} botId={GALLERY_BOT_ID} seq={1} />
      <div className="notice is-info" role="status"><span>{waiting}</span></div>
      <AllBotsControlView on={on} busy={false} error={null} onRevoke={() => setOn(false)} onDismiss={() => undefined} />
      <BotRelayDeviceView botName="Jiren" view={{ deviceId: chosen, devices }} busy={false} error={null} onChoose={(id) => setChosen(id || null)} onDismiss={() => undefined} />
    </div>
  );
}
