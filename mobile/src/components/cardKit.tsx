/** Small pieces shared by the cards and the connect sheet. */
import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { errText } from "../i18n";
import { radius, useTheme } from "../theme";

/** Runs one card action at a time: which button is busy, and the error to show. */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await fn(); return true; } catch (e) { setError(errText(e)); return false; } finally { setBusy(null); }
  };
  return { busy, error, run };
}

/** A text field for a secret: masked, no autofill, no suggestions, no autocorrect (nothing kept by the keyboard). */
export function SecretInput({ value, onChangeText, placeholder, label, reveal }: { value: string; onChangeText: (v: string) => void; placeholder: string; label: string; reveal?: boolean }) {
  const { c } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.text3}
      accessibilityLabel={label}
      secureTextEntry={!reveal}
      // https://reactnative.dev/docs/textinput: "off" disables autofill; importantForAutofill "no" keeps it out of the
      // Android autofill service; no autocorrect/spellcheck so the keyboard learns nothing from it.
      autoComplete="off"
      importantForAutofill="no"
      autoCorrect={false}
      spellCheck={false}
      autoCapitalize="none"
      keyboardType={reveal ? "visible-password" : "default"}
      maxLength={8000}
      style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]}
    />
  );
}

const styles = StyleSheet.create({
  input: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
});
