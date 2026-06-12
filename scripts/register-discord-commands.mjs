import { readFile } from "node:fs/promises";

const env = parseEnv(await readFile(".env", "utf8"));
const required = ["DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"];
const missing = required.filter((key) => !env.get(key));
if (missing.length) {
  console.error(`Missing required values: ${missing.join(", ")}`);
  process.exit(1);
}

const commands = [
  {
    name: "auth",
    description: "S-GATEで部員認証を開始します",
    dm_permission: false,
  },
];

const response = await fetch(
  `https://discord.com/api/v10/applications/${env.get("DISCORD_CLIENT_ID")}/guilds/${env.get("DISCORD_GUILD_ID")}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${env.get("DISCORD_BOT_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

const result = await response.json();
console.log(`Registered ${result.length} Discord command(s).`);

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
