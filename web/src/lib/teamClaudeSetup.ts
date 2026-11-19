/** Both commands prompt for the Sklubot token. Nothing pasted into the shell command is secret. */
export function teamClaudeSetup(server: string, platform: "windows" | "bash") {
  const url = new URL(server);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw Error("HTTPS requis pour connecter l’équipe.");
  const endpoint = url.origin + "/api/v1/team/mcp";
  if (platform === "bash")
    return [
      "bash -c '",
      '  read -rsp "Sklubot token: " grant && printf "\\n" >&2',
      '  [[ "$grant" =~ ^sk-team-[a-zA-Z0-9_-]{43}$ ]] || { echo "Invalid token" >&2; exit 1; }',
      '  claude mcp add --scope user --transport http sklubot-team "' +
        endpoint +
        '" --header "Authorization: Bearer $grant" >/dev/null',
      "'",
    ].join("\n");
  return [
    "$sklubotInput = Read-Host 'Jeton Sklubot' -AsSecureString",
    "$sklubotHandle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sklubotInput)",
    "try {",
    "  $sklubotGrant = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($sklubotHandle)",
    '  if ($sklubotGrant -cnotmatch "^sk-team-[a-zA-Z0-9_-]{43}$") { throw "Jeton Sklubot invalide" }',
    "  & claude mcp add --scope user --transport http sklubot-team '" +
      endpoint +
      `' --header "Authorization: Bearer $sklubotGrant" | Out-Null`,
    '  if ($LASTEXITCODE -ne 0) { throw "Configuration Claude Code incomplète" }',
    "} finally {",
    "  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sklubotHandle)",
    "  Remove-Variable sklubotGrant,sklubotInput,sklubotHandle -ErrorAction SilentlyContinue",
    "}",
  ].join("\n");
}
