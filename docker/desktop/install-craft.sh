#!/bin/sh
# Same pinned release in new desktops and in desktops originally created by an older Sklubot.
set -eu
version=0.6.1
case "$(uname -m)" in
  x86_64) arch=x86_64; digest=83ec0730c9117f399122b315c63ed4c3a8d31ac55bddd74cb8b33cd2f76ef704 ;;
  aarch64|arm64) arch=aarch64; digest=b4255ac806e2a598b9fc6dba4e8ed2190e49baafd2f68dd7e037f3294e472941 ;;
  *) echo "Unsupported desktop architecture" >&2; exit 1 ;;
esac
program=/usr/local/bin/craft-anything-cli
if [ -x "$program" ] && [ "$("$program" --version)" = "craft-anything-cli $version" ]; then exit 0; fi
dir=$(mktemp -d /usr/local/bin/.sklubot-craft.XXXXXXXX)
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
mv -f -- "$dir/program" "$program"
