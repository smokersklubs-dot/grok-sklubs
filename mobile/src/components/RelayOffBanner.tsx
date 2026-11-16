/**
 * "Phone control is off": the phone is paired and the relay left on, but the accessibility service is off. One tap opens
 * Sklubot's page in the accessibility settings; the user turns it on there (the app never does, and never bypasses the
 * consent of each control session). Checked when the app comes to the front.
 */
import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useT } from "../i18n";
import { openRelayAccessibility, openRelayAppInfo, relayAvailable, relayNeedsAccessibility, relayStatus } from "../relay";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Button } from "./ui";

let dismissedThisRun = false;

export function RelayOffBanner() {
  const { c } = useTheme();
  const t = useT();
  const [show, setShow] = useState(() => relayAvailable && !dismissedThisRun && relayNeedsAccessibility(relayStatus()));
  useEffect(() => {
    if (!relayAvailable) return;
    const check = () => setShow(!dismissedThisRun && relayNeedsAccessibility(relayStatus()));
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    return () => sub.remove();
  }, []);
  if (!show) return null;
  return (
    <View accessibilityRole="alert" style={[styles.box, { backgroundColor: c.warnSoft, borderColor: c.warn }]}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Icon name="phone" size={18} color={c.warn} />
        <Text style={{ color: c.text, fontWeight: "700", fontSize: 15, flex: 1 }}>{t("relay.off.title")}</Text>
      </View>
      <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }}>{t("relay.off.text")}</Text>
      <Button small variant="accent" label={t("relay.off.open")} onPress={openRelayAccessibility} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button small variant="plain" label={t("relay.off.restricted")} onPress={openRelayAppInfo} style={{ paddingHorizontal: 0, flexShrink: 1 }} />
        <View style={{ flex: 1 }} />
        <Button small variant="plain" label={t("relay.off.later")} onPress={() => { dismissedThisRun = true; setShow(false); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1, gap: 8 },
});
