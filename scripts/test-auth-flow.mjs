import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getGuildJoinFailureStatus, provisionVerifiedDiscordMember } from "../worker/src/index.js";

const port = 8791;
const workerBaseUrl = `http://127.0.0.1:${port}`;
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const testStateRoot = resolve(".wrangler", `auth-flow-test-${process.pid}`);
const migrationState = resolve(testStateRoot, "migration");
const runtimeState = resolve(testStateRoot, "runtime");
const wranglerRoot = `${resolve(".wrangler")}${sep}`;
assert(testStateRoot.startsWith(wranglerRoot), "Test state escaped the workspace .wrangler directory");
assert(
  getGuildJoinFailureStatus({ discordCode: 50013 }, { apiAccessible: true, status: 404 }) === "discord_join_bot_permission",
  "Missing Bot permission is not reported explicitly",
);
assert(
  getGuildJoinFailureStatus({ discordCode: 40007 }, { apiAccessible: true, status: 404 }) === "discord_user_banned",
  "Banned users are not reported explicitly",
);
assert(
  getGuildJoinFailureStatus({}, { apiAccessible: false, status: 403 }) === "discord_bot_access_error",
  "Bot access failures are not reported explicitly",
);

const originalFetch = globalThis.fetch;
const roleTestEnv = {
  DISCORD_GUILD_ID: "guild",
  DISCORD_BOT_TOKEN: "test-token",
  DISCORD_ROLE_S_GATE_VERIFIED: "verified",
  DISCORD_ROLE_S_GATE_UNVERIFIED: "unverified",
  DISCORD_ROLE_JC: "jc",
};
const roleTestMember = {
  committee_type: "JC",
  position: "",
  team: "",
  name: "Test Member",
};
const roleRequests = [];
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  roleRequests.push({ path, method: init.method ?? "GET" });
  if ((init.method ?? "GET") === "GET") {
    return Response.json({ roles: ["jc", "verified"], user: { username: "test-user" } });
  }
  if (init.method === "PATCH") return Response.json({});
  return new Response(null, { status: 204 });
};
const provisionedMember = await provisionVerifiedDiscordMember("user", roleTestMember, roleTestEnv, "test");
assert(provisionedMember.discordUsername === "test-user", "Canonical Discord username was not captured");
const addedRoles = roleRequests
  .filter((request) => request.method === "PUT")
  .map((request) => request.path.split("/").at(-1));
assert(addedRoles.join(",") === "jc,verified", "Verified role was not assigned last");

let rollbackObserved = false;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  if ((init.method ?? "GET") === "GET") return Response.json({ roles: ["jc"] });
  if (init.method === "PATCH") return Response.json({});
  if (init.method === "DELETE" && path.endsWith("/verified")) rollbackObserved = true;
  return new Response(null, { status: 204 });
};
try {
  await provisionVerifiedDiscordMember("user", roleTestMember, roleTestEnv, "test");
  throw new Error("Missing Discord role did not fail verification");
} catch (error) {
  assert(error.message === "discord_role_sync_failed", "Role provisioning returned the wrong error");
}
assert(rollbackObserved, "Verified role was not removed after role confirmation failed");
globalThis.fetch = originalFetch;

function runNpx(args, options = {}) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec || "cmd.exe", [
      "/d",
      "/s",
      "/c",
      `${npxCommand} ${args.join(" ")}`,
    ], options);
  }
  return spawnSync(npxCommand, args, options);
}

function spawnNpx(args, options = {}) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", [
      "/d",
      "/s",
      "/c",
      `${npxCommand} ${args.join(" ")}`,
    ], options);
  }
  return spawn(npxCommand, args, options);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForWorker(processHandle) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`wrangler dev exited with code ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(`${workerBaseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for wrangler dev");
}

async function startLogin(path = "/sgate/auth") {
  const response = await fetch(`${workerBaseUrl}${path}`, {
    redirect: "manual",
  });
  assert(response.status === 302, `login start returned ${response.status}`);
  assert(!response.headers.get("set-cookie"), "OAuth start still depends on a single state cookie");
  const authorizeUrl = new URL(response.headers.get("location"));
  const state = authorizeUrl.searchParams.get("state");
  assert(/^[A-Za-z0-9_-]{43}$/.test(state || ""), "OAuth state is not a 32-byte opaque token");
  return state;
}

async function cancelLogin(state) {
  const callbackUrl = new URL(`${workerBaseUrl}/sgate/callback`);
  callbackUrl.searchParams.set("error", "access_denied");
  callbackUrl.searchParams.set("state", state);
  const response = await fetch(callbackUrl, { redirect: "manual" });
  assert(response.status === 302, `callback returned ${response.status}`);
  return new URL(response.headers.get("location"));
}

const legacySetup = runNpx([
  "wrangler",
  "d1",
  "execute",
  "jams",
  "--local",
  "--persist-to",
  migrationState,
  "--file=worker/tests/legacy_auth_schema.sql",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (legacySetup.status !== 0) {
  throw new Error(`Legacy D1 setup failed:\n${legacySetup.stderr || legacySetup.stdout}`);
}

const migration = runNpx([
  "wrangler",
  "d1",
  "execute",
  "jams",
  "--local",
  "--persist-to",
  migrationState,
  "--file=worker/migrations/0007_rebuild_auth_flow.sql",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (migration.status !== 0) {
  throw new Error(`Auth migration failed:\n${migration.stderr || migration.stdout}`);
}

const migrationAssertion = runNpx([
  "wrangler",
  "d1",
  "execute",
  "jams",
  "--local",
  "--persist-to",
  migrationState,
  "--file=worker/tests/assert_auth_migration.sql",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (migrationAssertion.status !== 0) {
  throw new Error(`Auth migration assertion failed:\n${migrationAssertion.stderr || migrationAssertion.stdout}`);
}

const setup = runNpx([
  "wrangler",
  "d1",
  "execute",
  "jams",
  "--local",
  "--persist-to",
  runtimeState,
  "--file=worker/schema.sql",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (setup.status !== 0) {
  throw new Error(`Local D1 setup failed:\n${setup.stderr || setup.stdout}`);
}

const schemaAssertion = runNpx([
  "wrangler",
  "d1",
  "execute",
  "jams",
  "--local",
  "--persist-to",
  runtimeState,
  "--file=worker/tests/assert_auth_schema.sql",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (schemaAssertion.status !== 0) {
  throw new Error(`Auth schema assertion failed:\n${schemaAssertion.stderr || schemaAssertion.stdout}`);
}

const worker = spawnNpx([
  "wrangler",
  "dev",
  "--local",
  "--port",
  String(port),
  "--persist-to",
  runtimeState,
  "--env-file",
  ".cloudflare-secrets.env",
], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let workerOutput = "";
worker.stdout.on("data", (chunk) => { workerOutput += chunk; });
worker.stderr.on("data", (chunk) => { workerOutput += chunk; });

try {
  await waitForWorker(worker);

  const stateA = await startLogin();
  const stateB = await startLogin();
  assert(stateA !== stateB, "Concurrent login attempts received the same state");

  const resultB = await cancelLogin(stateB);
  assert(resultB.pathname.endsWith("/JAMS/auth.html"), "Authentication flow did not return to the authentication page");
  assert(resultB.searchParams.get("status") === "discord_error", "Second flow did not complete independently");

  const resultA = await cancelLogin(stateA);
  assert(resultA.pathname.endsWith("/JAMS/auth.html"), "Concurrent authentication flow changed its return page");
  assert(resultA.searchParams.get("status") === "discord_error", "First flow was overwritten by the second flow");

  const legacyState = await startLogin("/sgate/login?return_to=https%3A%2F%2Fshizudaisaihmjohsen-stack.github.io%2FJAMS%2F");
  const legacyResult = await cancelLogin(legacyState);
  assert(legacyResult.pathname.endsWith("/JAMS/auth.html"), "Legacy authentication URL could return to the management page");

  const managementState = await startLogin("/sgate/manage");
  const managementResult = await cancelLogin(managementState);
  assert(managementResult.pathname.endsWith("/JAMS/"), "Management login did not return to the management page");

  const replay = await cancelLogin(stateA);
  assert(replay.searchParams.get("status") === "state_error", "Consumed state could be replayed");

  const unknown = await cancelLogin("A".repeat(43));
  assert(unknown.searchParams.get("status") === "state_error", "Unknown state was accepted");

  const invalidExchange = await fetch(`${workerBaseUrl}/api/app/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "B".repeat(43) }),
  });
  assert(invalidExchange.status === 401, "Unknown app exchange token was accepted");

  const unauthorizedSelectedDm = await fetch(`${workerBaseUrl}/api/admin/members/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberNos: ["J1"], message: "test" }),
  });
  assert(unauthorizedSelectedDm.status === 401, "Selected DM endpoint accepted an unauthenticated request");

  console.log("OK OAuth concurrency, one-time state use, auth schema, and migration checks passed.");
} catch (error) {
  if (workerOutput) console.error(workerOutput);
  throw error;
} finally {
  if (process.platform === "win32" && worker.pid) {
    spawnSync("taskkill", ["/pid", String(worker.pid), "/t", "/f"], { windowsHide: true });
  } else {
    worker.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    rmSync(testStateRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`WARN could not remove temporary auth test state: ${error.message}`);
  }
}
