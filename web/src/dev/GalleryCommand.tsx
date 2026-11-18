import { useEffect, useState } from "react";
import { useStore } from "../store";
import { CommandView } from "../components/CommandView";
import { commandFixture, commandStoreState } from "./commandFixtures";
import type { FixtureOptions } from "./fixtures";

/** « Centre de commandement » in the dev gallery: the real page, with the fixtures' bots and live states in the store. */
export function GalleryCommand({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const { bots, live } = commandStoreState(commandFixture({ ...o, empty }));
    useStore.setState((s) => ({ bots: { ...s.bots, ...bots }, live: { ...s.live, ...live }, online: true }));
    setReady(true);
  }, [o.lang, o.long, empty]); // eslint-disable-line react-hooks/exhaustive-deps
  return ready ? <CommandView /> : null;
}
