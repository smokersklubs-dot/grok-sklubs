/** L184 « Tableau de bord et chiffres » on the phone: the pinned views and the account's numbers (components/ChatPlus.tsx). */
import { useNavigation } from "@react-navigation/native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PinnedDashboard, UsageMetrics } from "../components/ChatPlus";
import { Icon } from "../components/Icon";
import { SectionTitle, text } from "../components/ui";
import { useT } from "../i18n";
import { useTheme } from "../theme";

export function DashboardScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => nav.goBack()} hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="back" size={24} color={c.text} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[text.h1, { color: c.text, flex: 1 }]}>{t("dash.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 4 }}>
        <PinnedDashboard />
        <SectionTitle>{t("metrics.title")}</SectionTitle>
        <UsageMetrics />
      </ScrollView>
    </View>
  );
}
