/**
 * Gallery « relais »: « Téléphones Android (USB) » (Settings → Computers, AndroidUsbPanel.tsx, L177) on the real view —
 * one phone used by a bot (with « Arrêter »), one phone that has not allowed the computer yet, and the guide shown when
 * Google's adb is missing on the computer.
 */
import { AndroidUsbView, type AndroidUsbData } from "../components/AndroidUsbPanel";
import type { FixtureOptions } from "./fixtures";

export function GalleryAndroidUsb({ o }: { o: FixtureOptions }) {
  const long = !!o.long;
  const phones: AndroidUsbData = {
    online: true, supported: true, adb: { found: true, version: "1.0.41" }, checkedAt: Date.now(),
    devices: [
      { serial: "R58M12ABCDE", state: "device", model: long ? "Samsung Galaxy S24 Ultra Enterprise Edition" : "Pixel 8", android: "15", inUse: { botId: "b1", botName: long ? "Jiren l’assistant des courses du samedi" : "Jiren", since: Date.now() - 4 * 60_000 } },
      { serial: "ZY22XYZ0099", state: "unauthorized", inUse: null },
    ],
  };
  const missing: AndroidUsbData = { online: true, supported: true, adb: { found: false }, devices: [], checkedAt: Date.now() };

  const noop = () => undefined;
  return (
    <div className="android-usb-gallery" style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <AndroidUsbView data={phones} busy={false} error={null} onRefresh={noop} onStop={noop} onDismiss={noop} />
      <AndroidUsbView data={missing} busy={false} error={null} onRefresh={noop} onStop={noop} onDismiss={noop} />
    </div>
  );
}
