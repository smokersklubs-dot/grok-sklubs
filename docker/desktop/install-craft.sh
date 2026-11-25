#!/bin/sh
# Same pinned release in new desktops and in desktops originally created by an older Sklubot.
#
# The official binary goes to $lib_dir; what the bot (and Claude Code / Codex in its computer) runs as
# `craft-anything-cli` is a small guard in $bin_dir that locks clean-room mode (L23):
#  - it always passes `--clean-room` ("Clean room for this run only, whatever Settings say: nothing inside a target is
#    read", craft-anything-cli 0.6.1 apps/craft-anything-cli/src/main.rs), so a `settings_set deep_mode true` saved
#    earlier cannot switch a run to Deep mode;
#  - it refuses `--deep` and anything naming `deep_mode`, so a page the bot read cannot talk it into "deep copy" mode;
#  - it keeps the output of each `rebuild` in $log_dir, where Sklubot reads the questions the builder answered on its own
#    (`--unattended`: "? <question> → <first choice> (unattended)") and the "[Check N] X% alike" lines
#    (apps/craft-anything-cli/src/rebuild_cmd.rs in 0.6.1), to show them to the owner (agent/craft-run.ts);
#  - a rebuild WITHOUT --unattended reads its answers from the named pipe "<log>.in": Sklubot relays each question to the
#    owner and writes the owner's own answer there (agent/craft-relay.ts, L23).
# Paths can be moved for the tests (server/test/craft-install.test.ts); the bot's computer uses the defaults.
set -eu
version=0.6.1
bin_dir=${CRAFT_BIN_DIR:-/usr/local/bin}
lib_dir=${CRAFT_LIB_DIR:-/usr/local/lib/craft-anything}
log_dir=${CRAFT_LOG_DIR:-/root/.sklubot/craft-runs}
program="$bin_dir/craft-anything-cli"
real="$lib_dir/craft-anything-cli"
case "$(uname -m)" in
  x86_64) arch=x86_64; digest=83ec0730c9117f399122b315c63ed4c3a8d31ac55bddd74cb8b33cd2f76ef704 ;;
  aarch64|arm64) arch=aarch64; digest=b4255ac806e2a598b9fc6dba4e8ed2190e49baafd2f68dd7e037f3294e472941 ;;
  *) echo "Unsupported desktop architecture" >&2; exit 1 ;;
esac

install_guard() {
  tmp="$program.sklubot-new"
  cat > "$tmp" <<GUARD
#!/bin/sh
# sklubot-craft-guard: clean-room mode only (written by Sklubot's install-craft.sh).
for a in "\$@"; do
  case "\$a" in
    --deep|--deep=*|*deep_mode*|*deep-mode*)
      echo "Sklubot: Craft Anything runs in clean-room mode only on this computer; --deep and deep_mode are refused." >&2
      exit 64 ;;
  esac
done
case "\${1:-}" in
  ""|--version|-V|--help|-h) exec "$real" "\$@" ;;
esac
if [ "\$1" = rebuild ]; then
  mkdir -p "$log_dir"
  log="$log_dir/\$(date +%Y%m%d-%H%M%S)-\$\$.log"
  relay=yes
  for a in "\$@"; do [ "\$a" = --unattended ] && relay=no; done
  if [ "\$relay" = yes ]; then
    # Questions relayed to the owner (L23): answers come through the named pipe "<log>.in" (agent/craft-relay.ts).
    rm -f "\$log.in"; mkfifo -m 600 "\$log.in"
    ( "$real" --clean-room "\$@" <>"\$log.in" 2>&1; echo "\$?" > "\$log.code" ) | tee "\$log"
    rm -f "\$log.in"
  else
    ( "$real" --clean-room "\$@" 2>&1; echo "\$?" > "\$log.code" ) | tee "\$log"
  fi
  code=\$(cat "\$log.code" 2>/dev/null || echo 1)
  rm -f "\$log.code"
  exit "\$code"
fi
exec "$real" --clean-room "\$@"
GUARD
  chmod 755 "$tmp"
  mv -f -- "$tmp" "$program"
}

mkdir -p "$bin_dir" "$lib_dir"
if [ -x "$real" ] && [ "$("$real" --version)" = "craft-anything-cli $version" ]; then install_guard; exit 0; fi
# A desktop from an older Sklubot has the official binary itself at $program: it moves behind the guard.
if [ -x "$program" ] && ! grep -q sklubot-craft-guard "$program" 2>/dev/null && [ "$("$program" --version)" = "craft-anything-cli $version" ]; then
  mv -f -- "$program" "$real"
  install_guard
  exit 0
fi
dir=$(mktemp -d "$lib_dir/.sklubot-craft.XXXXXXXX")
trap 'rm -r -- "$dir"' EXIT
asset="craft-anything-${version}-linux-${arch}"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 8 --max-time 90 --retry 1 \
  "https://github.com/storytold/craft-anything/releases/download/v${version}/${asset}.tar.gz" -o "$dir/release.tar.gz"
(cd "$dir" && printf '%s  release.tar.gz\n' "$digest" | sha256sum -c - >/dev/null)
tar -xOzf "$dir/release.tar.gz" "$asset/bin/craft-anything-cli" > "$dir/program"
chmod 755 "$dir/program"
[ "$("$dir/program" --version)" = "craft-anything-cli $version" ]
mkdir -p /usr/local/share/doc/craft-anything
for notice in LICENSE-MIT LICENSE-APACHE NOTICE; do
  tar -xOzf "$dir/release.tar.gz" "$asset/share/doc/craft-anything/$notice" > "$dir/$notice"
  install -m 644 "$dir/$notice" "/usr/local/share/doc/craft-anything/$notice"
done
mv -f -- "$dir/program" "$real"
install_guard
