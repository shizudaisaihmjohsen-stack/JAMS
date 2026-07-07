import { readFile } from "node:fs/promises";

const requiredEnvKeys = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_ROLE_CHAIRPERSON",
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
];

const optionalUntilDeploy = new Set([
  "JAMS_FRONTEND_URL",
  "JAMS_FRONTEND_ORIGIN",
]);

const envText = await readOptionalFile(".env");
const wranglerText = await readOptionalFile("wrangler.toml");
const configText = await readOptionalFile("config.js");
const envValues = parseEnvValues(envText);
const missing = requiredEnvKeys.filter((key) => !envValues.get(key));
const hasGoogleAppsScript = Boolean(envValues.get("GOOGLE_APPS_SCRIPT_MAIL_URL") && envValues.get("GOOGLE_APPS_SCRIPT_MAIL_SECRET"));
const missingNow = missing.filter((key) => !optionalUntilDeploy.has(key));
const missingLater = ["JAMS_FRONTEND_URL", "JAMS_FRONTEND_ORIGIN"].filter((key) => !envValues.get(key));
const hasPlaceholderD1 = wranglerText.includes("replace-with-your-d1-database-id");
const hasMissingWorkerUrl = /sGateBaseUrl:\s*""/.test(configText);

if (!envText) {
  console.log("NG .env が見つかりません。");
} else {
  console.log("OK .env を確認しました。");
}

if (missingNow.length) {
  console.log(`NG 必須キーが不足しています: ${missingNow.join(", ")}`);
} else {
  console.log("OK ローカル実行に必要なキーは揃っています。");
}

if (hasGoogleAppsScript) {
  console.log("OK Google Apps Scriptメール中継の設定があります。");
}

if (missingLater.length) {
  console.log(`WARN 本番公開前に必要なキーが未設定です: ${missingLater.join(", ")}`);
}

if (hasPlaceholderD1) {
  console.log("WARN wrangler.toml の database_id がプレースホルダーのままです。");
} else {
  console.log("OK D1 database_id が設定されています。");
}

if (hasMissingWorkerUrl) {
  console.log("WARN config.js の sGateBaseUrl が未設定です。");
} else {
  console.log("OK config.js の sGateBaseUrl が設定されています。");
}

if (missingNow.length || !envText) {
  process.exitCode = 1;
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function parseEnvValues(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      values.set(match[1], unquoteEnvValue(match[2]).trim());
    }
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
