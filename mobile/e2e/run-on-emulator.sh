#!/usr/bin/env bash
# Runs the real-device test on an already booted Android emulator (called by .github/workflows/android.yml,
# inside reactivecircus/android-emulator-runner, whose `script` runs line by line: the logic lives here).
# Usage: run-on-emulator.sh <apk> <output dir>
# Needs: adb, maestro on PATH; APP_ID, SERVER_URL, E2E_EMAIL, E2E_PASSWORD in the environment.
# Each step writes "<status>|<label>" to <output dir>/steps.txt (rendered as the job summary); a failed step stops
# the next ones, and the script exits non-zero.
set -uo pipefail

APK="$1"
OUT="$2"
mkdir -p "$OUT/maestro" "$OUT/screenshots"
STEPS="$OUT/steps.txt"
: > "$STEPS"
FLOWS="$(cd "$(dirname "$0")/flows" && pwd)"
failed=0

step() { # step "<label>" <command...>
  local label="$1"; shift
  if [ "$failed" = 1 ]; then echo "⏭️|$label (pas lancée : une étape précédente a échoué)" >> "$STEPS"; return; fi
  echo "::group::$label"
  if "$@"; then echo "✅|$label" >> "$STEPS"; else echo "❌|$label" >> "$STEPS"; failed=1; fi
  echo "::endgroup::"
}

# adb screencap of whatever is on screen, for the steps Maestro does not drive.
shot() { adb exec-out screencap -p > "$OUT/screenshots/$1.png" || true; }

install_apk() {
  adb uninstall "$APP_ID" >/dev/null 2>&1 || true
  adb install -r "$APK" 2>&1 | tee "$OUT/adb-install.txt"
  grep -q "^Success" "$OUT/adb-install.txt" && adb shell pm path "$APP_ID" | grep -q "base.apk"
}

launch_activity() {
  # The launcher activity as Android resolves it (what a tap on the icon opens).
  local comp
  comp="$(adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "$APP_ID" | tr -d '\r' | tail -n 1)"
  echo "Activité de lancement : $comp"
  [[ "$comp" == "$APP_ID/"* ]] || return 1
  adb shell am start -W -n "$comp" | tee "$OUT/am-start.txt"
  grep -q "Status: ok" "$OUT/am-start.txt" || return 1
  sleep 15
  shot 00-lancement-depuis-l-icone
  adb shell pidof "$APP_ID" || { echo "Le processus de l'appli n'existe plus après 15 s."; return 1; }
  adb shell dumpsys activity activities | tr -d '\r' | grep -E "(mResumedActivity|topResumedActivity).*$APP_ID" \
    || { echo "L'appli n'est pas au premier plan."; return 1; }
}

flow() { # flow <file> : one Maestro flow, its screenshots and debug output kept under $OUT/maestro/<name>
  local name="${1%.yaml}"
  maestro test "$FLOWS/$1" \
    -e APP_ID="$APP_ID" -e SERVER_URL="$SERVER_URL" -e E2E_EMAIL="$E2E_EMAIL" -e E2E_PASSWORD="$E2E_PASSWORD" \
    --test-output-dir "$OUT/maestro/$name" --debug-output "$OUT/maestro/$name/debug" --flatten-debug-output
}

still_running() {
  adb shell pidof "$APP_ID" || { echo "Le processus de l'appli n'existe plus à la fin du test."; return 1; }
}

no_crash() {
  adb logcat -d -v threadtime > "$OUT/logcat.txt" || true
  adb logcat -d -b crash > "$OUT/logcat-crash.txt" 2>/dev/null || true
  # A crash of the app prints "FATAL EXCEPTION" followed by "Process: <package>, PID: …"; an ANR "ANR in <package>".
  local bad=0
  if grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" "$OUT/logcat-crash.txt" | grep -q "Process: $APP_ID"; then
    echo "Plantage de l'appli trouvé dans logcat :"; grep -B2 -A30 "Process: $APP_ID" "$OUT/logcat.txt" | head -80; bad=1
  fi
  if grep -q "ANR in $APP_ID" "$OUT/logcat.txt"; then
    echo "L'appli ne répondait plus (ANR) :"; grep -A20 "ANR in $APP_ID" "$OUT/logcat.txt" | head -40; bad=1
  fi
  # React Native's own fatal errors (red screen in release = crash) are logged by ReactNativeJS / unknown:ReactNative.
  if grep -E "E (ReactNativeJS|unknown:ReactNative)" "$OUT/logcat.txt" | grep -qi "fatal\|Unhandled JS Exception"; then
    echo "Erreur JavaScript fatale :"; grep -E "E (ReactNativeJS|unknown:ReactNative)" "$OUT/logcat.txt" | head -40; bad=1
  fi
  [ "$bad" = 0 ]
}

# A freshly booted emulator often shows "Pixel Launcher isn't responding" over everything (seen on the first runs):
# let the system settle, ask Android not to show error dialogs (we read crashes from logcat instead), close dialogs.
settle() {
  sleep 20
  adb shell settings put global hide_error_dialogs 1 || true
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null || true
  adb shell input keyevent KEYCODE_HOME || true
}

settle
adb logcat -c || true
step "Installation de l'APK sur le téléphone virtuel (adb install)" install_apk
step "Ouverture depuis l'icône : l'appli est au premier plan" launch_activity
step "Premier écran affiché (adresse du serveur)" flow 01-ouverture.yaml
step "Connexion au serveur Sklubot de test et liste des bots" flow 02-connexion.yaml
step "Discussion avec un bot : message envoyé, réponse reçue" flow 03-discussion.yaml
step "Arrière-plan, rotation, fermeture et relance (toujours connecté)" flow 04-cycle-de-vie.yaml
step "L'appli tourne toujours à la fin" still_running
# Always checked, even after a failed step: a crash is what we most want to see.
crash_failed_before=$failed; failed=0
step "Aucun plantage ni blocage (ANR) dans logcat" no_crash
[ "$crash_failed_before" = 1 ] && failed=1
shot 99-ecran-final

# Every screenshot in one folder, in step order.
find "$OUT/maestro" -name '*.png' -path '*takeScreenshot*' -exec cp {} "$OUT/screenshots/" \; 2>/dev/null || true
find "$OUT/maestro" -name '*.png' ! -path '*takeScreenshot*' -name '[0-9][0-9]-*' -exec cp -n {} "$OUT/screenshots/" \; 2>/dev/null || true
ls -1 "$OUT/screenshots"
cat "$STEPS"
exit "$failed"
