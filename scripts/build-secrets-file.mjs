import { readFile, writeFile } from "node:fs/promises";

const secretKeys = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_ROLE_DIRECTOR",
  "DISCORD_ROLE_MANAGER",
  "DISCORD_ROLE_S_GATE",
  "DISCORD_ROLE_S_GATE_ADMIN",
  "DISCORD_ROLE_S_GATE_VERIFIED",
  "DISCORD_ROLE_S_GATE_UNVERIFIED",
  "DISCORD_ROLE_RC",
  "DISCORD_ROLE_SV",
  "DISCORD_ROLE_JC",
  "DISCORD_ROLE_POSTER",
  "DISCORD_ROLE_PAMPHLET",
  "DISCORD_ROLE_WEBSITE",
  "DISCORD_ROLE_INSIDE_PR",
  "DISCORD_ROLE_OUTSIDE_PR",
  "DISCORD_ROLE_MASCOT",
  "DISCORD_ROLE_SNS",
  "S_GATE_EMAIL_FROM",
  "S_GATE_ALLOWED_EMAIL_DOMAINS",
  "S_GATE_SESSION_SECRET",
  "S_GATE_ADMIN_DISCORD_IDS",
  "GOOGLE_APPS_SCRIPT_MAIL_URL",
  "GOOGLE_APPS_SCRIPT_MAIL_SECRET",
  "JAMS_FRONTEND_URL",
  "JAMS_FRONTEND_ORIGIN",
];

const env = parseEnv(await readFile(".env", "utf8"));
const missing = secretKeys.filter((key) => !env.get(key));
if (missing.length) {
  console.error(`Missing required values: ${missing.join(", ")}`);
  process.exit(1);
}

const output = secretKeys
  .map((key) => `${key}=${quoteEnvValue(env.get(key))}`)
  .join("\n");
await writeFile(".cloudflare-secrets.env", `${output}\n`, "utf8");
console.log("Created .cloudflare-secrets.env for wrangler deploy --secrets-file.");

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values.set(match[1], unquoteEnvValue(match[2]));
  }
  return values;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quoteEnvValue(value) {
  return JSON.stringify(String(value));
}
