/**
 * Gallery « creation » (section=creation): Settings → Keys → « Création (images et vidéos) » (MediaKeys.tsx, audit Open
 * Generative AI) on the real component with fixed data (no server).
 *   (default)  Wan2GP on the owner's PC through the Relais, an xAI key saved, recent Wan2GP runs
 *   long=1     long computer names and a computer whose Relais must be updated
 *   empty=1    nothing saved, no computer linked (hosted: no server address offered)
 */
import { MediaKeysSection, type MediaState } from "../components/MediaKeys";
import { NOW, type FixtureOptions } from "./fixtures";

export function mediaFixture(o: FixtureOptions, empty: boolean): MediaState {
  if (empty) return { keys: [], computers: [], urlAllowed: false, privateUrlAllowed: false, jobs: [], defaultPort: 7866 };
  return {
    keys: [
      { provider: "wan2gp", hasKey: false, baseUrl: "http://127.0.0.1:7866", model: "", deviceId: "dev_pc", updatedAt: NOW - 3600_000 },
      { provider: "xai", hasKey: true, baseUrl: "", model: "", deviceId: "", updatedAt: NOW - 86_400_000 },
    ],
    computers: [
      { id: "dev_pc", label: o.long ? "PC de bureau de Léa avec la carte graphique (salon, Windows 11)" : "PC de Léa (Windows)", online: true, gpu: true },
      ...(o.long ? [{ id: "dev_mac", label: "MacBook Air de Léa — ancien Relais", online: true, gpu: false }] : []),
    ],
    urlAllowed: true, privateUrlAllowed: true,
    jobs: [
      { id: "mj1", kind: "video", status: "running", jobId: "job_48", createdAt: NOW - 120_000 },
      { id: "mj2", kind: "video", status: "done", jobId: "job_47", createdAt: NOW - 3_600_000 },
      { id: "mj3", kind: "image", status: "failed", jobId: null, createdAt: NOW - 86_400_000 },
    ],
    defaultPort: 7866,
  };
}

export function GalleryMedia({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  return (
    <div className="app-settings-content settings-pane" style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <MediaKeysSection initial={mediaFixture(o, empty)} />
    </div>
  );
}
