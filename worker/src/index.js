const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_GATEWAY_INTENTS = (1 << 0) | (1 << 1);
const GATEWAY_KEEPALIVE_MS = 5 * 60 * 1000;
const SESSION_COOKIE = "sgate_session";
const STATE_COOKIE = "sgate_state";
const RETURN_TO_COOKIE = "sgate_return_to";
const APP_TOKEN_PARAM = "sgate_app_token";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const APP_EXCHANGE_TTL_MS = 5 * 60 * 1000;

const roleNameToEnvKey = {
  "委員長": "DISCORD_ROLE_CHAIRPERSON",
  "部長": "DISCORD_ROLE_DIRECTOR",
  "課長": "DISCORD_ROLE_MANAGER",
  "S-GATE": "DISCORD_ROLE_S_GATE",
  "[S-GATE] 管理者": "DISCORD_ROLE_S_GATE_ADMIN",
  "[S-GATE] 認証済": "DISCORD_ROLE_S_GATE_VERIFIED",
  "[S-GATE] 未認証": "DISCORD_ROLE_S_GATE_UNVERIFIED",
  RC: "DISCORD_ROLE_RC",
  SV: "DISCORD_ROLE_SV",
  JC: "DISCORD_ROLE_JC",
  "ポスター": "DISCORD_ROLE_POSTER",
  "パンフレット": "DISCORD_ROLE_PAMPHLET",
  "Webサイト": "DISCORD_ROLE_WEBSITE",
  "学内宣": "DISCORD_ROLE_INSIDE_PR",
  "学外宣": "DISCORD_ROLE_OUTSIDE_PR",
  "マスコット": "DISCORD_ROLE_MASCOT",
  SNS: "DISCORD_ROLE_SNS",
};

const meetingNameToColumn = {
  "新歓": "meeting_welcome",
  "第1回": "meeting_1",
  "第2回": "meeting_2",
  "第3回": "meeting_3",
  "第4回": "meeting_4",
  "第5回": "meeting_5",
};

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      if (error.status) {
        return json({ error: error.message }, error.status, request, env);
      }
      console.error(error);
      return json({
        error: "internal_error",
      }, 500, request, env);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(getDiscordGateway(env).fetch("https://discord-gateway.internal/ensure", { method: "POST" }));
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return corsPreflight(request, env);
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const gateway = getDiscordGateway(env);
    await gateway.fetch("https://discord-gateway.internal/ensure", { method: "POST" });
    const gatewayStatus = await gateway.fetch("https://discord-gateway.internal/status");
    const status = await gatewayStatus.json();
    return json({ ok: true, service: "S-GATE", discordGateway: status.status }, 200, request, env);
  }

  if (request.method === "POST" && url.pathname === "/discord/interactions") {
    return handleDiscordInteraction(request, env, ctx);
  }

  if (requiresTrustedOrigin(request, url) && !isTrustedOrigin(request, env)) {
    return json({ error: "origin_not_allowed" }, 403, request, env);
  }

  if (request.method === "GET" && url.pathname === "/sgate/login") {
    return startDiscordLogin(request, env, ctx, getAuthFrontendUrl(request, env));
  }

  if (request.method === "GET" && url.pathname === "/sgate/auth") {
    return startDiscordLogin(request, env, ctx, getAuthFrontendUrl(request, env));
  }

  if (request.method === "GET" && url.pathname === "/sgate/manage") {
    return startDiscordLogin(request, env, ctx, getFrontendUrl(request, env));
  }

  if (request.method === "GET" && url.pathname === "/sgate/callback") {
    return handleDiscordCallback(request, env);
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/sgate/logout") {
    return handleLogout(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/sgate/me") {
    return getCurrentSession(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/sgate/apply-roles") {
    return applyVerifiedRoles(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/sgate/email/start") {
    return startEmailVerification(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/sgate/email/confirm") {
    return confirmEmailVerification(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/sgate/email/confirm-token") {
    return confirmEmailVerificationByToken(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/admin/me") {
    return getAdminStatus(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/admin/discord-gateway") {
    return getDiscordGatewayStatus(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/discord-gateway/reconnect") {
    return reconnectDiscordGateway(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/app/bootstrap") {
    return getAppBootstrap(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/app/session") {
    return exchangeAppSession(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/members/import") {
    return importMembers(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/members/delete") {
    return deleteMember(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/admin/members") {
    return listMembers(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/meetings/absentees/dm") {
    return sendAbsenceDirectMessages(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/members/dm") {
    return sendSelectedDirectMessages(request, env);
  }

  return json({ error: "not_found" }, 404, request, env);
}

async function handleDiscordInteraction(request, env, ctx) {
  assertDiscordInteractionEnv(env);
  const rawBody = await request.text();
  const verified = await verifyDiscordSignature(request, rawBody, env);
  if (!verified) {
    return new Response("bad request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);
  if (interaction.type === 1) {
    return interactionJson({ type: 1 });
  }

  if (interaction.type === 2 && interaction.data?.name === "auth") {
    return interactionJson(buildAuthModalResponse());
  }

  if (interaction.type === 5 && interaction.data?.custom_id === "sgate_auth_modal") {
    ctx.waitUntil(processAuthModalSubmit(interaction, env));
    return interactionJson({
      type: 5,
      data: { flags: 64 },
    });
  }

  return interactionJson({
    type: 4,
    data: {
      flags: 64,
      content: "この操作には対応していません。",
    },
  });
}

function buildAuthModalResponse() {
  return {
    type: 9,
    data: {
      custom_id: "sgate_auth_modal",
      title: "S-GATE 部員認証",
      components: [
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "student_id",
            label: "学籍番号",
            style: 1,
            min_length: 8,
            max_length: 8,
            required: true,
            placeholder: "525A1001",
          }],
        },
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "email",
            label: "大学メールアドレス",
            style: 1,
            required: true,
            placeholder: "name@example.ac.jp",
          }],
        },
      ],
    },
  };
}

async function processAuthModalSubmit(interaction, env) {
  try {
    const discordUser = interaction.member?.user ?? interaction.user ?? {};
    const discordUserId = discordUser.id;
    const discordUsername = clean(discordUser.username);
    const values = getModalValues(interaction);
    const studentId = String(values.student_id ?? "").trim().toUpperCase();
    const email = normalizeEmail(values.email);

    if (!discordUserId || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      await editInteractionResponse(interaction, env, "このサーバーではS-GATE認証を開始できません。");
      return;
    }

    if (!/^[0-9A-Z]{8}$/.test(studentId) || !isValidEmail(email) || !isAllowedEmailDomain(email, env)) {
      await editInteractionResponse(interaction, env, "学籍番号または大学メールアドレスの形式が正しくありません。");
      return;
    }

    const member = await findMemberForEmail(email, studentId, env);
    if (!member) {
      await editInteractionResponse(interaction, env, "入力内容と一致する部員データが見つかりませんでした。学籍番号と大学メールを確認してください。");
      return;
    }

    const code = generateVerificationCode();
    const token = generateVerificationToken();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const codeHash = await hashVerificationCode(email, code, env);
    const tokenHash = await hashVerificationToken(token, env);

    await storeEmailVerificationChallenge({
      email,
      discordUserId,
      discordUsername,
      codeHash,
      tokenHash,
      expiresAt,
    }, env);

    await sendVerificationEmail(email, code, env);
    const verifyUrl = `${getVerificationUrlFromEnv(env)}?token=${encodeURIComponent(token)}`;
    await editInteractionResponse(interaction, env, [
      "大学メールに認証コードを送信しました。",
      "下のページで6桁のコードを入力してください。",
      verifyUrl,
      "",
      "有効期限は10分です。",
    ].join("\n"));
  } catch (error) {
    console.error("Discord auth modal failed", error);
    await editInteractionResponse(interaction, env, "認証処理を開始できませんでした。時間を置いてもう一度 `/auth` を実行してください。");
  }
}

function getModalValues(interaction) {
  const values = {};
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      values[component.custom_id] = component.value;
    }
  }
  return values;
}

async function startDiscordLogin(request, env, ctx, fixedReturnTo = "") {
  assertRequiredEnv(env);
  const url = new URL(request.url);
  const redirectUri = getRedirectUri(request, env);
  const state = generateVerificationToken();
  const returnTo = fixedReturnTo
    || sanitizeReturnTo(url.searchParams.get("return_to"), env)
    || getFrontendUrl(request, env);
  try {
    await storeOAuthLoginState(state, returnTo, env);
  } catch (error) {
    logAuthFailure("oauth_state_create", error);
    return loginResultRedirect(request, env, returnTo, "login_service_failed");
  }
  ctx.waitUntil(cleanupExpiredOAuthLoginStates(env).catch((error) => {
    logAuthFailure("oauth_state_cleanup", error);
  }));

  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("scope", "identify guilds.join");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "consent");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function handleDiscordCallback(request, env) {
  assertRequiredEnv(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  let loginState;
  try {
    loginState = state ? await consumeOAuthLoginState(state, env) : null;
  } catch (error) {
    logAuthFailure("oauth_state_consume", error);
    return loginResultRedirect(request, env, getFrontendUrl(request, env), "login_service_failed");
  }
  const frontendUrl = loginState?.return_to || getFrontendUrl(request, env);
  if (!loginState) {
    return loginResultRedirect(request, env, frontendUrl, "state_error");
  }

  if (url.searchParams.get("error")) {
    return loginResultRedirect(request, env, frontendUrl, "discord_error");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return loginResultRedirect(request, env, frontendUrl, "oauth_exchange_failed");
  }

  let token;
  try {
    token = await exchangeCodeForToken(code, getRedirectUri(request, env), env);
  } catch (error) {
    logAuthFailure("oauth_token_exchange", error);
    return loginResultRedirect(request, env, frontendUrl, "oauth_exchange_failed");
  }

  let user;
  try {
    user = await discordFetch("/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
  } catch (error) {
    logAuthFailure("discord_user_lookup", error);
    return loginResultRedirect(request, env, frontendUrl, "discord_user_failed");
  }

  try {
    const guildJoin = await addGuildMemberBestEffort(user.id, token.access_token, env);
    const guildMembership = await checkGuildMembership(user.id, env);
    if (!guildMembership.isMember) {
      const loginStatus = getGuildJoinFailureStatus(guildJoin, guildMembership);
      console.error(JSON.stringify({
        message: "S-GATE guild membership could not be confirmed",
        loginStatus,
        joinStatus: guildJoin.status,
        joinDiscordCode: guildJoin.discordCode,
        membershipStatus: guildMembership.status,
      }));
      return loginResultRedirect(request, env, frontendUrl, loginStatus);
    }

    const linkedMember = await findMemberByDiscordUserId(user.id, env);
    if (linkedMember?.verified_at) {
      await syncVerifiedDiscordMember(user.id, linkedMember, env, "S-GATE login verified");
      await updateMemberDiscordUsername(user.id, user.username, env);
    } else {
      await addRoleBestEffort(user.id, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, "S-GATE login");
    }

    const sessionPayload = { userId: user.id, username: user.username, issuedAt: Date.now(), kind: "browser_session" };
    const session = await signSession(sessionPayload, env);
    const appExchangeToken = generateVerificationToken();
    await storeAppExchangeToken(appExchangeToken, user.id, user.username, env);
    return loginResultRedirect(request, env, frontendUrl, "login_ok", {
      session,
      appExchangeToken,
    });
  } catch (error) {
    logAuthFailure("login_finalize", error);
    return loginResultRedirect(request, env, frontendUrl, "login_service_failed");
  }
}

async function exchangeAppSession(request, env) {
  const body = await readJson(request);
  const exchangeToken = String(body.token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(exchangeToken)) {
    return json({ authenticated: false, error: "invalid_app_token" }, 401, request, env);
  }
  const exchange = await consumeAppExchangeToken(exchangeToken, env);
  if (!exchange) {
    return json({ authenticated: false, error: "invalid_app_token" }, 401, request, env);
  }

  const session = await signSession({
    userId: exchange.user_id,
    username: exchange.username,
    issuedAt: Date.now(),
    kind: "app_session",
  }, env);

  return json({
    authenticated: true,
    session,
    expiresIn: 60 * 60 * 12,
  }, 200, request, env);
}

async function storeAppExchangeToken(token, userId, username, env) {
  if (!env.DB) {
    throw new Error("Missing required DB binding");
  }
  await cleanupExpiredAppExchangeTokens(env);
  const tokenHash = await hashVerificationToken(token, env);
  await env.DB.prepare(`
    INSERT INTO app_exchange_tokens (token_hash, user_id, username, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    userId,
    clean(username),
    Date.now() + APP_EXCHANGE_TTL_MS,
    Date.now(),
  ).run();
}

async function consumeAppExchangeToken(token, env) {
  if (!env.DB) {
    throw new Error("Missing required DB binding");
  }
  const tokenHash = await hashVerificationToken(token, env);
  const stored = await env.DB.prepare(`
    SELECT token_hash, user_id, expires_at, used_at
    FROM app_exchange_tokens
    WHERE token_hash = ?
  `).bind(tokenHash).first();
  const now = Date.now();
  if (!stored || stored.used_at || stored.expires_at < now) {
    return null;
  }
  const result = await env.DB.prepare(`
    UPDATE app_exchange_tokens
    SET used_at = ?
    WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?
  `).bind(now, tokenHash, now).run();
  return Number(result.meta?.changes ?? 0) > 0 ? stored : null;
}

async function cleanupExpiredAppExchangeTokens(env) {
  await env.DB.prepare(`
    DELETE FROM app_exchange_tokens
    WHERE expires_at < ?
  `).bind(Date.now() - 10 * 60 * 1000).run();
}

async function storeOAuthLoginState(state, returnTo, env) {
  const stateHash = await hashOAuthState(state, env);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO oauth_login_states (state_hash, return_to, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(stateHash, returnTo, now + OAUTH_STATE_TTL_MS, now).run();
}

async function consumeOAuthLoginState(state, env) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  const stateHash = await hashOAuthState(state, env);
  const now = Date.now();
  const stored = await env.DB.prepare(`
    SELECT return_to, expires_at, used_at
    FROM oauth_login_states
    WHERE state_hash = ?
  `).bind(stateHash).first();
  if (!stored || stored.used_at || stored.expires_at < now) return null;

  const result = await env.DB.prepare(`
    UPDATE oauth_login_states
    SET used_at = ?
    WHERE state_hash = ? AND used_at IS NULL AND expires_at >= ?
  `).bind(now, stateHash, now).run();
  return Number(result.meta?.changes ?? 0) > 0 ? stored : null;
}

async function cleanupExpiredOAuthLoginStates(env) {
  await env.DB.prepare(`
    DELETE FROM oauth_login_states
    WHERE expires_at < ?
  `).bind(Date.now() - OAUTH_STATE_TTL_MS).run();
}

function handleLogout(request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request, env),
  });
  headers.append("Set-Cookie", cookie(request, SESSION_COOKIE, "", {
    maxAge: 0,
    httpOnly: true,
    sameSite: getSessionCookieSameSite(request, env),
  }));
  headers.append("Set-Cookie", cookie(request, STATE_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  headers.append("Set-Cookie", cookie(request, RETURN_TO_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  return new Response(JSON.stringify({ ok: true }, null, 2), { status: 200, headers });
}

async function getCurrentSession(request, env) {
  const session = await readSignedSession(request, env);
  if (!session) {
    return json({ authenticated: false }, 401, request, env);
  }
  return json({ authenticated: true, userId: session.userId, username: session.username }, 200, request, env);
}

async function applyVerifiedRoles(request, env) {
  const session = await readSignedSession(request, env);
  if (!session) {
    return json({ error: "not_authenticated" }, 401, request, env);
  }

  if (!env.DB) {
    throw new Error("Missing required DB binding");
  }
  const member = await findMemberByDiscordUserId(session.userId, env);
  if (!member?.verified_at) {
    return json({ error: "member_not_verified" }, 403, request, env);
  }
  if (!await isGuildMember(session.userId, env)) {
    return json({ error: "discord_server_join_required" }, 409, request, env);
  }

  const sync = await syncVerifiedDiscordMember(session.userId, member, env, "S-GATE verified role sync");
  return json({ ok: true, roles: sync.roleNames, warnings: sync.warnings }, 200, request, env);
}

async function storeEmailVerificationChallenge(challenge, env) {
  const challengeId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO email_verification_challenges (
      challenge_id,
      email,
      discord_user_id,
      discord_username,
      code_hash,
      token_hash,
      expires_at,
      attempts,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(email, discord_user_id) DO UPDATE SET
      challenge_id = excluded.challenge_id,
      discord_username = excluded.discord_username,
      code_hash = excluded.code_hash,
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      created_at = excluded.created_at
  `).bind(
    challengeId,
    challenge.email,
    challenge.discordUserId,
    clean(challenge.discordUsername),
    challenge.codeHash,
    challenge.tokenHash,
    challenge.expiresAt,
    now,
  ).run();
  await env.DB.prepare(`
    DELETE FROM email_verification_challenges
    WHERE expires_at < ?
  `).bind(now - 10 * 60 * 1000).run();
  return challengeId;
}

async function startEmailVerification(request, env) {
  try {
    const session = await readSignedSession(request, env);
    if (!session) {
      return json({ error: "not_authenticated" }, 401, request, env);
    }
    assertEmailEnv(env);

    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const studentId = String(body.studentId ?? "").trim().toUpperCase();
    if (!isValidEmail(email) || !isAllowedEmailDomain(email, env)) {
      return json({ error: "invalid_email_domain" }, 400, request, env);
    }

    const member = await findMemberForEmail(email, studentId, env);
    if (!member) {
      return json({
        ok: true,
        message: "入力されたメールアドレスが部員名簿に登録されている場合、認証コードを送信しました。",
      }, 200, request, env);
    }

    const code = generateVerificationCode();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const codeHash = await hashVerificationCode(email, code, env);

    await storeEmailVerificationChallenge({
      email,
      discordUserId: session.userId,
      discordUsername: clean(session.username),
      codeHash,
      tokenHash: null,
      expiresAt,
    }, env);

    await sendVerificationEmail(email, code, env);
    return json({
      ok: true,
      message: "入力されたメールアドレスが部員名簿に登録されている場合、認証コードを送信しました。",
    }, 200, request, env);
  } catch (error) {
    console.error("Email verification start failed", error);
    return json({
      error: "email_verification_start_failed",
      code: error?.code ?? "",
    }, 500, request, env);
  }
}

async function confirmEmailVerification(request, env) {
  const session = await readSignedSession(request, env);
  if (!session) {
    return json({ error: "not_authenticated" }, 401, request, env);
  }
  assertEmailEnv(env);

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? "").trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return json({ error: "invalid_code" }, 400, request, env);
  }

  const stored = await env.DB.prepare(`
    SELECT challenge_id, email, discord_user_id, discord_username, code_hash, expires_at, attempts
    FROM email_verification_challenges
    WHERE email = ? AND discord_user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(email, session.userId).first();

  if (!stored || stored.expires_at < Date.now() || stored.attempts >= 5) {
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const expectedHash = await hashVerificationCode(email, code, env);
  if (!await constantTimeEqual(stored.code_hash, expectedHash)) {
    await env.DB.prepare(`
      UPDATE email_verification_challenges SET attempts = attempts + 1 WHERE challenge_id = ?
    `).bind(stored.challenge_id).run();
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const result = await completeMemberVerification(email, session.userId, session.username, env);
  await env.DB.prepare(`DELETE FROM email_verification_challenges WHERE challenge_id = ?`)
    .bind(stored.challenge_id).run();
  return json(result, 200, request, env);
}

async function confirmEmailVerificationByToken(request, env) {
  assertEmailEnv(env);
  const body = await readJson(request);
  const token = String(body.token ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!token || !/^\d{6}$/.test(code)) {
    return json({ error: "invalid_code" }, 400, request, env);
  }

  const tokenHash = await hashVerificationToken(token, env);
  const stored = await env.DB.prepare(`
    SELECT challenge_id, email, discord_user_id, discord_username, code_hash, expires_at, attempts
    FROM email_verification_challenges
    WHERE token_hash = ?
  `).bind(tokenHash).first();

  if (!stored || stored.expires_at < Date.now() || stored.attempts >= 5) {
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const expectedHash = await hashVerificationCode(stored.email, code, env);
  if (!await constantTimeEqual(stored.code_hash, expectedHash)) {
    await env.DB.prepare(`
      UPDATE email_verification_challenges SET attempts = attempts + 1 WHERE challenge_id = ?
    `).bind(stored.challenge_id).run();
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const result = await completeMemberVerification(stored.email, stored.discord_user_id, stored.discord_username, env);
  await env.DB.prepare(`DELETE FROM email_verification_challenges WHERE challenge_id = ?`)
    .bind(stored.challenge_id).run();
  return json(result, 200, request, env);
}

async function completeMemberVerification(email, discordUserId, discordUsername, env) {
  const member = await findMemberForEmail(email, "", env);
  if (!member) {
    throw httpError("member_not_found", 404);
  }
  const linkedMember = await findMemberByDiscordUserId(discordUserId, env);
  if (linkedMember && linkedMember.id !== member.id) {
    throw httpError("discord_account_already_linked", 409);
  }
  if (member.discord_user_id && member.discord_user_id !== discordUserId) {
    throw httpError("member_already_linked", 409);
  }

  const membership = await checkGuildMembership(discordUserId, env);
  if (!membership.apiAccessible) {
    throw httpError("discord_bot_access_error", 503);
  }
  if (!membership.isMember) {
    throw httpError("discord_server_join_required", 409);
  }

  const sync = await provisionVerifiedDiscordMember(discordUserId, member, env, "S-GATE email verified");
  let update;
  try {
    update = await env.DB.prepare(`
      UPDATE members
      SET discord_user_id = ?, discord_username = ?, verified_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (discord_user_id IS NULL OR discord_user_id = ?)
    `).bind(
      discordUserId,
      sync.discordUsername || clean(discordUsername),
      new Date().toISOString(),
      member.id,
      discordUserId,
    ).run();
  } catch (error) {
    await removeRoleBestEffort(discordUserId, sync.verifiedRoleId, env, "S-GATE verification rollback");
    throw error;
  }
  if (Number(update.meta?.changes ?? 0) !== 1) {
    await removeRoleBestEffort(discordUserId, sync.verifiedRoleId, env, "S-GATE verification rollback");
    throw httpError("member_already_linked", 409);
  }

  return {
    ok: true,
    member: {
      memberNo: member.member_no,
      name: member.name,
      committeeType: member.committee_type,
      team: member.team,
    },
    roles: sync.roleNames,
    warnings: sync.warnings,
  };
}

async function getAdminStatus(request, env) {
  const session = await readSignedSession(request, env);
  if (!session) {
    return json({ authenticated: false, admin: false }, 200, request, env);
  }
  const admin = await isAdminSession(session, env);
  return json({
    authenticated: true,
    admin,
    userId: session.userId,
    username: session.username,
  }, 200, request, env);
}

async function getAppBootstrap(request, env) {
  if (!env.DB) {
    throw new Error("Missing required DB binding");
  }
  const session = await readSignedSession(request, env);
  if (!session) {
    return json({ authenticated: false, access: "guest", members: [] }, 200, request, env);
  }

  const member = await findMemberByDiscordUserId(session.userId, env);
  const access = getAccessLevel(session, member, env);
  if (access === "none") {
    return json({
      authenticated: true,
      access,
      user: { userId: session.userId, username: session.username },
      member: null,
      members: [],
    }, 403, request, env);
  }

  const members = access === "self"
    ? (member ? [member] : [])
    : await selectAllMembers(env);

  return json({
    authenticated: true,
    access,
    canEdit: access === "admin",
    user: { userId: session.userId, username: session.username },
    member,
    members,
  }, 200, request, env);
}

async function importMembers(request, env) {
  const session = await requireAdminSession(request, env);
  const body = await readJson(request);
  const sourceMembers = Array.isArray(body.members) ? body.members : [];
  if (!sourceMembers.length) {
    return json({ error: "no_members" }, 400, request, env);
  }
  if (sourceMembers.length > 1000) {
    return json({ error: "too_many_members" }, 400, request, env);
  }

  const normalizedMembers = sourceMembers.map(normalizeMemberForImport);
  const errors = normalizedMembers
    .map((member, index) => validateMemberForImport(member, index + 1))
    .filter(Boolean);
  if (errors.length) {
    return json({ error: "validation_failed", errors }, 400, request, env);
  }

  const memberNoCounts = new Map();
  for (const member of normalizedMembers) {
    memberNoCounts.set(member.memberNo, (memberNoCounts.get(member.memberNo) ?? 0) + 1);
  }
  const duplicateMemberNos = [...memberNoCounts]
    .filter(([, count]) => count > 1)
    .map(([memberNo]) => memberNo);
  if (duplicateMemberNos.length) {
    return json({ error: "duplicate_member_no", memberNos: duplicateMemberNos }, 409, request, env);
  }

  const existingMembers = await env.DB.prepare(`
    SELECT member_no, student_id
    FROM members
    WHERE member_no IS NOT NULL AND trim(member_no) <> ''
  `).all();
  const existingOwnerByMemberNo = new Map(
    (existingMembers.results ?? []).map((member) => [member.member_no, member.student_id]),
  );
  const conflictingMemberNos = normalizedMembers
    .filter((member) => {
      const existingStudentId = existingOwnerByMemberNo.get(member.memberNo);
      return existingStudentId && existingStudentId !== member.studentId;
    })
    .map((member) => member.memberNo);
  if (conflictingMemberNos.length) {
    return json({
      error: "member_no_conflict",
      memberNos: [...new Set(conflictingMemberNos)],
    }, 409, request, env);
  }

  const statements = normalizedMembers.map((member) => env.DB.prepare(`
    INSERT INTO members (
      member_no,
      committee_type,
      name,
      kana,
      line_name,
      student_id,
      email,
      grade,
      faculty,
      department,
      position,
      team,
      meeting_welcome,
      meeting_1,
      meeting_2,
      meeting_3,
      meeting_4,
      meeting_5,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id) DO UPDATE SET
      member_no = excluded.member_no,
      committee_type = excluded.committee_type,
      name = excluded.name,
      kana = excluded.kana,
      line_name = excluded.line_name,
      email = excluded.email,
      grade = excluded.grade,
      faculty = excluded.faculty,
      department = excluded.department,
      position = excluded.position,
      team = excluded.team,
      meeting_welcome = excluded.meeting_welcome,
      meeting_1 = excluded.meeting_1,
      meeting_2 = excluded.meeting_2,
      meeting_3 = excluded.meeting_3,
      meeting_4 = excluded.meeting_4,
      meeting_5 = excluded.meeting_5,
      updated_at = CURRENT_TIMESTAMP
    ON CONFLICT(email) DO UPDATE SET
      member_no = excluded.member_no,
      committee_type = excluded.committee_type,
      name = excluded.name,
      kana = excluded.kana,
      line_name = excluded.line_name,
      student_id = excluded.student_id,
      grade = excluded.grade,
      faculty = excluded.faculty,
      department = excluded.department,
      position = excluded.position,
      team = excluded.team,
      meeting_welcome = excluded.meeting_welcome,
      meeting_1 = excluded.meeting_1,
      meeting_2 = excluded.meeting_2,
      meeting_3 = excluded.meeting_3,
      meeting_4 = excluded.meeting_4,
      meeting_5 = excluded.meeting_5,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    member.memberNo,
    member.committeeType,
    member.name,
    member.kana,
    member.lineName,
    member.studentId,
    member.email,
    member.grade,
    member.faculty,
    member.department,
    member.position,
    member.team,
    member.meetings["新歓"],
    member.meetings["第1回"],
    member.meetings["第2回"],
    member.meetings["第3回"],
    member.meetings["第4回"],
    member.meetings["第5回"],
  ));

  await env.DB.batch(statements);
  return json({ ok: true, imported: normalizedMembers.length, importedBy: session.userId }, 200, request, env);
}

async function listMembers(request, env) {
  await requireAdminSession(request, env);
  const members = await selectAllMembers(env);
  return json({ ok: true, members }, 200, request, env);
}

async function deleteMember(request, env) {
  const session = await requireAdminSession(request, env);
  const body = await readJson(request);
  const studentId = clean(body.studentId).toUpperCase();
  const memberNo = clean(body.memberNo);
  if (!studentId && !memberNo) {
    return json({ error: "missing_member_key" }, 400, request, env);
  }

  const existing = studentId
    ? await env.DB.prepare("SELECT id, member_no, name, student_id, email FROM members WHERE upper(student_id) = ?")
      .bind(studentId)
      .first()
    : await env.DB.prepare("SELECT id, member_no, name, student_id, email FROM members WHERE member_no = ?")
      .bind(memberNo)
      .first();

  if (!existing) {
    return json({ error: "member_not_found" }, 404, request, env);
  }

  const statements = [
    env.DB.prepare("DELETE FROM members WHERE id = ?").bind(existing.id),
  ];
  if (existing.email) {
    statements.push(env.DB.prepare("DELETE FROM email_verification_challenges WHERE lower(email) = ?").bind(normalizeEmail(existing.email)));
  }
  await env.DB.batch(statements);
  return json({
    ok: true,
    deleted: {
      memberNo: existing.member_no,
      name: existing.name,
      studentId: existing.student_id,
    },
    deletedBy: session.userId,
  }, 200, request, env);
}

async function selectAllMembers(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      member_no,
      committee_type,
      name,
      kana,
      line_name,
      student_id,
      email,
      grade,
      faculty,
      department,
      position,
      team,
      meeting_welcome,
      meeting_1,
      meeting_2,
      meeting_3,
      meeting_4,
      meeting_5,
      discord_user_id,
      discord_username,
      verified_at
    FROM members
    ORDER BY student_id
  `).all();
  return result.results ?? [];
}

async function findMemberByDiscordUserId(discordUserId, env) {
  if (!discordUserId) return null;
  return env.DB.prepare(`
    SELECT
      id,
      member_no,
      committee_type,
      name,
      kana,
      line_name,
      student_id,
      email,
      grade,
      faculty,
      department,
      position,
      team,
      meeting_welcome,
      meeting_1,
      meeting_2,
      meeting_3,
      meeting_4,
      meeting_5,
      discord_user_id,
      discord_username,
      verified_at
    FROM members
    WHERE discord_user_id = ?
  `).bind(discordUserId).first();
}

function getAccessLevel(session, member, env) {
  if (isAdminDiscordUser(session.userId, env)) {
    return "admin";
  }
  const committeeType = String(member?.committee_type ?? "");
  if (committeeType === "委員長" || committeeType === "RC" || committeeType === "SV") {
    return "staff";
  }
  if (committeeType === "JC") {
    return "self";
  }
  return "none";
}

async function sendAbsenceDirectMessages(request, env) {
  const session = await requireAdminSession(request, env);
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("Missing required env: DISCORD_BOT_TOKEN");
  }

  const body = await readJson(request);
  const meeting = String(body.meeting ?? "").trim();
  const message = String(body.message ?? "").trim();
  const meetingColumn = meetingNameToColumn[meeting];
  if (!meetingColumn) {
    return json({ error: "invalid_meeting" }, 400, request, env);
  }
  if (!message || message.length > 1800) {
    return json({ error: "invalid_message", message: "メッセージは1文字以上1800文字以内で入力してください。" }, 400, request, env);
  }

  const result = await env.DB.prepare(`
    SELECT member_no, name, discord_user_id, ${meetingColumn} AS meeting_status
    FROM members
    WHERE COALESCE(${meetingColumn}, '') <> '出席'
    ORDER BY student_id
  `).all();
  const absentMembers = result.results ?? [];
  const sendableMembers = absentMembers.filter((member) => String(member.discord_user_id ?? "").trim());
  const skippedNoDiscord = absentMembers.length - sendableMembers.length;
  if (!sendableMembers.length) {
    return json({
      ok: true,
      meeting,
      targeted: absentMembers.length,
      sent: 0,
      failed: 0,
      skippedNoDiscord,
      results: [],
      sentBy: session.userId,
    }, 200, request, env);
  }

  const sendResults = [];
  for (const member of sendableMembers) {
    try {
      const sentMessage = await sendDirectMessage(
        member.discord_user_id,
        buildAbsenceDmMessage(meeting, message),
        env,
      );
      sendResults.push({
        memberNo: member.member_no,
        name: member.name,
        discordUserId: member.discord_user_id,
        ok: true,
        messageId: sentMessage?.id ?? "",
      });
    } catch (error) {
      console.warn(`Failed to send absence DM to ${member.member_no}: ${error.message}`);
      sendResults.push({
        memberNo: member.member_no,
        name: member.name,
        discordUserId: member.discord_user_id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sent = sendResults.filter((entry) => entry.ok).length;
  const failed = sendResults.length - sent;
  return json({
    ok: failed === 0,
    meeting,
    targeted: absentMembers.length,
    sent,
    failed,
    skippedNoDiscord,
    results: sendResults,
    sentBy: session.userId,
  }, 200, request, env);
}

async function requireAdminSession(request, env) {
  const session = await readSignedSession(request, env);
  if (!session) {
    throw httpError("not_authenticated", 401);
  }
  if (!await isAdminSession(session, env)) {
    throw httpError("admin_required", 403);
  }
  if (!env.DB) {
    throw new Error("Missing required DB binding");
  }
  return session;
}

async function isAdminSession(session, env) {
  return isAdminDiscordUser(session.userId, env);
}

function isAdminDiscordUser(userId, env) {
  return String(env.S_GATE_ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

function normalizeMemberForImport(member) {
  return {
    memberNo: clean(member.memberNo),
    committeeType: normalizeCommitteeType(member.committeeType),
    name: clean(member.name),
    kana: clean(member.kana),
    lineName: clean(member.lineName),
    studentId: clean(member.studentId).toUpperCase(),
    email: normalizeEmail(member.email) || null,
    grade: clean(member.grade),
    faculty: clean(member.faculty),
    department: clean(member.department),
    position: clean(member.position),
    team: clean(member.team),
    meetings: {
      "新歓": clean(member.meetings?.["新歓"]),
      "第1回": clean(member.meetings?.["第1回"]),
      "第2回": clean(member.meetings?.["第2回"]),
      "第3回": clean(member.meetings?.["第3回"]),
      "第4回": clean(member.meetings?.["第4回"]),
      "第5回": clean(member.meetings?.["第5回"]),
    },
  };
}

function validateMemberForImport(member, rowNumber) {
  const fields = [];
  const expectedMemberNoPrefix = member.committeeType === "委員長"
    ? "C"
    : member.committeeType === "RC" ? "R" : member.committeeType === "SV" ? "S" : "J";
  if (!new RegExp(`^${expectedMemberNoPrefix}[1-9]\\d*$`).test(member.memberNo)) fields.push("部員No.");
  if (!member.name) fields.push("氏名");
  if (!/^[0-9A-Z]{8}$/.test(member.studentId)) fields.push("学籍番号");
  if (member.email && !isValidEmail(member.email)) fields.push("大学メール");
  if (!member.faculty || member.faculty === "不明") fields.push("学部");
  if (!member.department || member.department === "不明") fields.push("学科");
  return fields.length ? { rowNumber, fields } : null;
}

function buildVerifiedRoleNames(member, discordUserId = "", env = {}) {
  const roleNames = ["[S-GATE] 認証済"];
  const committeeType = normalizeCommitteeType(member.committeeType);
  roleNames.push(committeeType);

  if (isAdminDiscordUser(discordUserId, env)) {
    roleNames.push("[S-GATE] 管理者");
  }

  for (const teamRole of normalizeTeamRoles(member.team)) {
    if (teamRole) {
      roleNames.push(teamRole);
    }
  }

  return [...new Set(roleNames)];
}

function normalizeCommitteeType(value) {
  return value === "委員長" || value === "RC" || value === "SV" || value === "JC" ? value : "JC";
}

function normalizeTeamRoles(team) {
  return String(team ?? "")
    .split(/[・、,／/]+/)
    .map((part) => normalizeTeamRole(part))
    .filter(Boolean);
}

function normalizeTeamRole(team) {
  const map = new Map([
    ["ポスター課", "ポスター"],
    ["ポスター", "ポスター"],
    ["パンフレット課", "パンフレット"],
    ["パンフレット", "パンフレット"],
    ["ウェブサイト広報課", "Webサイト"],
    ["ウェブサイト", "Webサイト"],
    ["Webサイト", "Webサイト"],
    ["学内情報宣伝課", "学内宣"],
    ["学内宣", "学内宣"],
    ["学外情報宣伝課", "学外宣"],
    ["学外宣", "学外宣"],
    ["マスコット課", "マスコット"],
    ["マスコット", "マスコット"],
    ["SNS広報課", "SNS"],
    ["SNS", "SNS"],
  ]);
  return map.get(String(team ?? "").trim()) ?? "";
}

async function findMemberForEmail(email, studentId, env) {
  if (studentId) {
    return env.DB.prepare(`
      SELECT * FROM members WHERE lower(email) = ? AND upper(student_id) = ?
    `).bind(email, studentId).first();
  }
  return env.DB.prepare(`
    SELECT * FROM members WHERE lower(email) = ?
  `).bind(email).first();
}

async function sendVerificationEmail(email, code, env) {
  const from = parseEmailAddress(env.S_GATE_EMAIL_FROM, "情報宣伝部");
  const subject = "S-GATE 認証コード";
  const text = [
    "S-GATEの認証コードをお知らせします。",
    "",
    `認証コード: ${code}`,
    "",
    "有効期限は10分です。",
    "このメールに心当たりがない場合は、破棄してください。",
  ].join("\n");

  const message = {
    to: email,
    from,
    subject,
    text,
    html: `
      <p>S-GATEの認証コードをお知らせします。</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 0.12em;">${code}</p>
      <p>有効期限は10分です。</p>
      <p>このメールに心当たりがない場合は、破棄してください。</p>
    `,
  };

  if (env.GOOGLE_APPS_SCRIPT_MAIL_URL) {
    await sendEmailViaGoogleAppsScript(message, env);
    return;
  }

  if (env.RESEND_API_KEY) {
    await sendEmailViaResend(message, env);
    return;
  }

  if (env.SAKURA_MAIL_RELAY_URL) {
    await sendEmailViaSakuraRelay(message, env);
    return;
  }

  await env.EMAIL.send(message);
}

async function sendEmailViaGoogleAppsScript(message, env) {
  if (!env.GOOGLE_APPS_SCRIPT_MAIL_SECRET) {
    throw new Error("Missing required env: GOOGLE_APPS_SCRIPT_MAIL_SECRET");
  }

  const response = await fetch(env.GOOGLE_APPS_SCRIPT_MAIL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GOOGLE_APPS_SCRIPT_MAIL_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: env.GOOGLE_APPS_SCRIPT_MAIL_SECRET,
      to: formatEmailAddress(message.to),
      from: message.from,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Apps Script mail error ${response.status}: ${detail}`);
  }

  const result = await response.json().catch(() => null);
  if (!result?.ok) {
    throw new Error(`Google Apps Script mail error: ${result?.error ?? "unknown_error"}`);
  }
}

async function sendEmailViaResend(message, env) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: formatEmailAddress(message.from),
      to: [formatEmailAddress(message.to)],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend API error ${response.status}: ${detail}`);
  }
}

async function sendEmailViaSakuraRelay(message, env) {
  if (!env.SAKURA_MAIL_RELAY_SECRET) {
    throw new Error("Missing required env: SAKURA_MAIL_RELAY_SECRET");
  }

  const response = await fetch(env.SAKURA_MAIL_RELAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SAKURA_MAIL_RELAY_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Sakura mail relay error ${response.status}: ${detail}`);
  }
}

function parseEmailAddress(value, fallbackName) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim() || fallbackName, email: match[2].trim() };
  }
  return raw;
}

function formatEmailAddress(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value?.name && value?.email) {
    return `${value.name} <${value.email}>`;
  }
  if (value?.email) {
    return value.email;
  }
  return String(value ?? "");
}

function generateVerificationCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = new DataView(bytes.buffer).getUint32(0);
  return String(value % 1000000).padStart(6, "0");
}

function generateVerificationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function hashVerificationCode(email, code, env) {
  return hmac(`${email}:${code}`, getSessionSecret(env));
}

async function hashVerificationToken(token, env) {
  return hmac(`token:${token}`, getSessionSecret(env));
}

async function updateMemberDiscordUsername(discordUserId, discordUsername, env) {
  const username = clean(discordUsername);
  if (!discordUserId || !username) return;
  await env.DB.prepare(`
    UPDATE members
    SET discord_username = ?, updated_at = CURRENT_TIMESTAMP
    WHERE discord_user_id = ? AND COALESCE(discord_username, '') <> ?
  `).bind(username, discordUserId, username).run();
}

async function sendSelectedDirectMessages(request, env) {
  const session = await requireAdminSession(request, env);
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("Missing required env: DISCORD_BOT_TOKEN");
  }

  const body = await readJson(request);
  const memberNos = [...new Set(
    (Array.isArray(body.memberNos) ? body.memberNos : [])
      .map((value) => String(value ?? "").trim())
      .filter((value) => /^[CRSJ][1-9]\d*$/.test(value)),
  )];
  const message = String(body.message ?? "").trim();
  if (!memberNos.length || memberNos.length > 100) {
    return json({ error: "invalid_recipients" }, 400, request, env);
  }
  if (!message || message.length > 1800) {
    return json({ error: "invalid_message", message: "メッセージは1文字以上1800文字以内で入力してください。" }, 400, request, env);
  }

  const placeholders = memberNos.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT member_no, name, discord_user_id
    FROM members
    WHERE member_no IN (${placeholders})
  `).bind(...memberNos).all();
  const memberByNo = new Map((result.results ?? []).map((member) => [member.member_no, member]));
  const selectedMembers = memberNos.map((memberNo) => memberByNo.get(memberNo)).filter(Boolean);
  const sendableMembers = selectedMembers.filter((member) => String(member.discord_user_id ?? "").trim());
  const skippedNoDiscord = selectedMembers.length - sendableMembers.length;
  const notFound = memberNos.length - selectedMembers.length;
  const sendResults = [];

  for (const member of sendableMembers) {
    try {
      const sentMessage = await sendDirectMessage(
        member.discord_user_id,
        buildSelectedDmMessage(message),
        env,
      );
      sendResults.push({
        memberNo: member.member_no,
        name: member.name,
        discordUserId: member.discord_user_id,
        ok: true,
        messageId: sentMessage?.id ?? "",
      });
    } catch (error) {
      console.warn(`Failed to send selected DM to ${member.member_no}: ${error.message}`);
      sendResults.push({
        memberNo: member.member_no,
        name: member.name,
        discordUserId: member.discord_user_id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sent = sendResults.filter((entry) => entry.ok).length;
  const failed = sendResults.length - sent;
  return json({
    ok: failed === 0 && notFound === 0,
    targeted: memberNos.length,
    sent,
    failed,
    skippedNoDiscord,
    notFound,
    results: sendResults,
    sentBy: session.userId,
  }, 200, request, env);
}

function getDiscordGateway(env) {
  if (!env.DISCORD_GATEWAY) {
    throw new Error("Missing required binding: DISCORD_GATEWAY");
  }
  return env.DISCORD_GATEWAY.getByName(String(env.DISCORD_GUILD_ID));
}

async function getDiscordGatewayStatus(request, env) {
  await requireAdminSession(request, env);
  const gateway = getDiscordGateway(env);
  await gateway.fetch("https://discord-gateway.internal/ensure", { method: "POST" });
  const status = await gateway.fetch("https://discord-gateway.internal/status");
  return json({ ok: true, gateway: await status.json() }, 200, request, env);
}

async function reconnectDiscordGateway(request, env) {
  await requireAdminSession(request, env);
  const gateway = getDiscordGateway(env);
  const status = await gateway.fetch("https://discord-gateway.internal/reconnect", { method: "POST" });
  return json({ ok: true, gateway: await status.json() }, 200, request, env);
}

async function hashOAuthState(state, env) {
  return hmac(`oauth-state:${state}`, getSessionSecret(env));
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clean(value) {
  return String(value ?? "").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAllowedEmailDomain(email, env) {
  const domain = email.split("@")[1];
  const allowed = String(env.S_GATE_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(domain);
}

async function exchangeCodeForToken(code, redirectUri, env) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  return discordFetch("/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function addGuildMember(userId, accessToken, env) {
  await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
    method: "PUT",
    headers: botHeaders(env),
    body: JSON.stringify({ access_token: accessToken }),
  }, [201, 204]);
}

async function addGuildMemberBestEffort(userId, accessToken, env) {
  try {
    await addGuildMember(userId, accessToken, env);
    return { ok: true };
  } catch (error) {
    console.warn(`Skipping optional guild member add: ${error.message}`);
    return {
      ok: false,
      status: Number(error?.httpStatus ?? 0),
      discordCode: Number(error?.discordCode ?? 0),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getGuildJoinFailureStatus(guildJoin, guildMembership) {
  const discordCode = Number(guildJoin?.discordCode ?? 0);
  const statusByDiscordCode = new Map([
    [30001, "discord_guild_limit"],
    [40002, "discord_account_verification_required"],
    [40007, "discord_user_banned"],
    [50013, "discord_join_bot_permission"],
    [50026, "discord_join_scope_missing"],
  ]);
  if (statusByDiscordCode.has(discordCode)) {
    return statusByDiscordCode.get(discordCode);
  }
  if (!guildMembership?.apiAccessible && [401, 403].includes(Number(guildMembership?.status ?? 0))) {
    return "discord_bot_access_error";
  }
  return "server_join_failed";
}

async function checkGuildMembership(userId, env) {
  try {
    await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
      method: "GET",
      headers: botHeaders(env),
    }, [200]);
    return { isMember: true, apiAccessible: true, status: 200 };
  } catch (error) {
    const status = Number(error?.httpStatus ?? 0);
    if (status === 404) {
      return { isMember: false, apiAccessible: true, status };
    }
    return { isMember: false, apiAccessible: false, status };
  }
}

async function isGuildMember(userId, env) {
  return (await checkGuildMembership(userId, env)).isMember;
}

async function syncVerifiedDiscordMember(userId, member, env, reason) {
  const roleNames = buildVerifiedRoleNames({
    committeeType: member.committee_type,
    position: member.position,
    team: member.team,
  }, userId, env);
  const roles = roleNames
    .map((name) => ({ name, id: env[roleNameToEnvKey[name]] }))
    .filter((role) => role.id);
  const warnings = [];

  if (!await setMemberNicknameBestEffort(userId, member.name, env, reason)) {
    warnings.push("nickname_sync_failed");
  }
  if (!await removeRoleBestEffort(userId, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, reason)) {
    warnings.push("unverified_role_removal_failed");
  }
  for (const role of roles) {
    if (!await addRoleBestEffort(userId, role.id, env, reason)) {
      warnings.push(`role_sync_failed:${role.name}`);
    }
  }
  if (warnings.length) {
    console.warn(JSON.stringify({
      message: "S-GATE authentication completed with Discord sync warnings",
      warningCount: warnings.length,
      warnings,
    }));
  }
  return { roleNames, warnings };
}

async function provisionVerifiedDiscordMember(userId, member, env, reason) {
  const roleNames = buildVerifiedRoleNames({
    committeeType: member.committee_type,
    position: member.position,
    team: member.team,
  }, userId, env);
  const roles = roleNames.map((name) => ({ name, id: env[roleNameToEnvKey[name]] }));
  const missingRoleNames = roles.filter((role) => !role.id).map((role) => role.name);
  if (missingRoleNames.length) {
    console.error(JSON.stringify({
      message: "S-GATE required Discord role is not configured",
      missingRoleNames,
    }));
    throw httpError("discord_role_sync_failed", 503);
  }

  const verifiedRole = roles.find((role) => role.name === "[S-GATE] 認証済");
  const prerequisiteRoles = roles.filter((role) => role !== verifiedRole);
  let verifiedRoleAdded = false;
  const warnings = [];

  try {
    if (!await setMemberNicknameBestEffort(userId, member.name, env, reason)) {
      warnings.push("nickname_sync_failed");
    }
    for (const role of prerequisiteRoles) {
      await addRole(userId, role.id, env, reason);
    }
    await addRole(userId, verifiedRole.id, env, reason);
    verifiedRoleAdded = true;

    await removeRole(userId, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, reason);
    const guildMember = await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
      method: "GET",
      headers: botHeaders(env),
    }, [200]);
    const assignedRoleIds = new Set((guildMember.roles ?? []).map(String));
    const missingAssignedRoles = roles.filter((role) => !assignedRoleIds.has(String(role.id)));
    const stillUnverified = env.DISCORD_ROLE_S_GATE_UNVERIFIED
      && assignedRoleIds.has(String(env.DISCORD_ROLE_S_GATE_UNVERIFIED));
    if (missingAssignedRoles.length || stillUnverified) {
      throw new Error("Discord role assignment could not be confirmed");
    }

    return {
      roleNames,
      warnings,
      verifiedRoleId: verifiedRole.id,
      discordUsername: clean(guildMember.user?.username),
    };
  } catch (error) {
    if (verifiedRoleAdded) {
      await removeRoleBestEffort(userId, verifiedRole.id, env, "S-GATE verification rollback");
    }
    console.error(JSON.stringify({
      message: "S-GATE Discord role provisioning failed",
      discordUserId: userId,
      detail: error.message,
    }));
    throw httpError("discord_role_sync_failed", 503);
  }
}

async function addRole(userId, roleId, env, reason) {
  if (!roleId) return;
  await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: botHeaders(env, reason),
  }, [204]);
}

async function addRoleBestEffort(userId, roleId, env, reason) {
  try {
    await addRole(userId, roleId, env, reason);
    return true;
  } catch (error) {
    console.warn(`Skipping optional role assignment: ${error.message}`);
    return false;
  }
}

async function removeRole(userId, roleId, env, reason) {
  if (!roleId) return;
  await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    headers: botHeaders(env, reason),
  }, [204, 404]);
}

async function removeRoleBestEffort(userId, roleId, env, reason) {
  try {
    await removeRole(userId, roleId, env, reason);
    return true;
  } catch (error) {
    console.warn(`Skipping optional role removal: ${error.message}`);
    return false;
  }
}

function makeDiscordNickname(name) {
  return String(name ?? "").replace(/[\s\u3000]+/g, "").slice(0, 32);
}

async function setMemberNickname(userId, name, env, reason) {
  const nick = makeDiscordNickname(name);
  if (!userId || !nick) return;
  await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
    method: "PATCH",
    headers: botHeaders(env, reason),
    body: JSON.stringify({ nick }),
  }, [200]);
}

async function setMemberNicknameBestEffort(userId, name, env, reason) {
  try {
    await setMemberNickname(userId, name, env, reason);
    return true;
  } catch (error) {
    console.warn(`Skipping optional nickname update: ${error.message}`);
    return false;
  }
}

async function sendDirectMessage(userId, content, env) {
  const channel = await discordFetch("/users/@me/channels", {
    method: "POST",
    headers: botHeaders(env),
    body: JSON.stringify({ recipient_id: userId }),
  }, [200]);

  return discordFetch(`/channels/${channel.id}/messages`, {
    method: "POST",
    headers: botHeaders(env),
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  }, [200]);
}

function buildAbsenceDmMessage(meeting, message) {
  return [
    `【JAMS / S-GATE 全体会連絡】`,
    `対象: ${meeting}`,
    "",
    message,
  ].join("\n");
}

async function discordFetch(path, init = {}, okStatuses = [200]) {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, init);
  if (!okStatuses.includes(response.status)) {
    const detail = await response.text();
    const error = new Error(`Discord API error ${response.status}: ${detail}`);
    error.httpStatus = response.status;
    try {
      error.discordCode = Number(JSON.parse(detail)?.code ?? 0);
    } catch {
      error.discordCode = 0;
    }
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function editInteractionResponse(interaction, env, content) {
  await discordFetch(`/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      flags: 64,
    }),
  });
}

async function verifyDiscordSignature(request, rawBody, env) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(env.DISCORD_PUBLIC_KEY),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${timestamp}${rawBody}`);
  return crypto.subtle.verify("Ed25519", key, hexToBytes(signature), signed);
}

function interactionJson(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function hexToBytes(hex) {
  const cleanHex = String(hex ?? "").trim();
  if (!/^[0-9a-fA-F]*$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex value");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}

function botHeaders(env, reason = "") {
  const headers = {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (reason) {
    headers["X-Audit-Log-Reason"] = encodeURIComponent(reason);
  }
  return headers;
}

async function signSession(payload, env) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmac(body, getSessionSecret(env));
  return `${body}.${signature}`;
}

async function readSignedSession(request, env) {
  const bearer = readBearerToken(request);
  if (bearer) {
    return readSignedToken(bearer, env, {
      allowedKinds: ["app_session"],
      maxAgeMs: 60 * 60 * 12 * 1000,
    });
  }

  const value = readCookie(request, SESSION_COOKIE);
  return readSignedToken(value, env, {
    allowedKinds: ["browser_session", ""],
    maxAgeMs: 60 * 60 * 12 * 1000,
  });
}

async function readSignedToken(value, env, options = {}) {
  try {
    if (!value || !value.includes(".")) {
      return null;
    }
    const [body, signature] = value.split(".", 2);
    const expected = await hmac(body, getSessionSecret(env));
    if (!await constantTimeEqual(signature, expected)) {
      return null;
    }
    const payload = JSON.parse(base64UrlDecode(body));
    const kind = payload.kind || "";
    const allowedKinds = options.allowedKinds || ["browser_session", "app_session", ""];
    const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 12 * 1000;
    if (!allowedKinds.includes(kind) || !payload.userId || Date.now() - payload.issuedAt > maxAgeMs) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function readBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function buildSelectedDmMessage(message) {
  return [
    "【JAMS / S-GATE 個別連絡】",
    "",
    message,
  ].join("\n");
}

export { getGuildJoinFailureStatus, provisionVerifiedDiscordMember };

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left ?? ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right ?? ""))),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function base64UrlEncode(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getSessionSecret(env) {
  return env.S_GATE_SESSION_SECRET || env.DISCORD_CLIENT_SECRET;
}

function getRedirectUri(request, env) {
  if (env.S_GATE_REDIRECT_URI) {
    return env.S_GATE_REDIRECT_URI;
  }
  const url = new URL(request.url);
  return `${url.origin}/sgate/callback`;
}

function getFrontendUrl(request, env) {
  if (env.JAMS_FRONTEND_URL) {
    return env.JAMS_FRONTEND_URL;
  }
  const url = new URL(request.url);
  return `${url.origin}/index.html`;
}

function sanitizeReturnTo(value, env) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const allowedOrigins = getAllowedFrontendOrigins(env);
    if (!allowedOrigins.includes(url.origin)) {
      return "";
    }
    url.searchParams.delete("status");
    url.searchParams.delete(APP_TOKEN_PARAM);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function getFrontendUrlFromEnv(env) {
  return env.JAMS_FRONTEND_URL || "index.html";
}

function getVerificationUrlFromEnv(env) {
  const frontendUrl = getFrontendUrlFromEnv(env);
  try {
    const url = new URL(frontendUrl);
    url.pathname = url.pathname.replace(/[^/]*$/, "verify.html");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "verify.html";
  }
}

function getSessionCookieSameSite(request, env) {
  if (!env.JAMS_FRONTEND_ORIGIN) {
    return "Lax";
  }
  const workerOrigin = new URL(request.url).origin;
  return env.JAMS_FRONTEND_ORIGIN === workerOrigin ? "Lax" : "None";
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

function loginResultRedirect(request, env, frontendUrl, status, options = {}) {
  const location = appendQueryParams(frontendUrl, {
    status,
    [APP_TOKEN_PARAM]: options.appExchangeToken,
  });
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  headers.append("Set-Cookie", cookie(request, STATE_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  headers.append("Set-Cookie", cookie(request, RETURN_TO_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  if (options.session) {
    headers.append("Set-Cookie", cookie(request, SESSION_COOKIE, options.session, {
      maxAge: 60 * 60 * 12,
      httpOnly: true,
      sameSite: getSessionCookieSameSite(request, env),
    }));
  }
  return new Response(null, { status: 302, headers });
}

function getAuthFrontendUrl(request, env) {
  return new URL("auth.html", getFrontendUrl(request, env)).toString();
}

function logAuthFailure(stage, error, details = {}) {
  console.error(JSON.stringify({
    message: "S-GATE authentication step failed",
    stage,
    httpStatus: Number(error?.httpStatus ?? 0),
    error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    ...details,
  }));
}

function appendQueryParams(location, params) {
  const url = new URL(location);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function corsPreflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function requiresTrustedOrigin(request, url) {
  if (request.method !== "POST") return false;
  if (url.pathname === "/discord/interactions") return false;
  return url.pathname === "/sgate/logout" || url.pathname.startsWith("/api/");
}

function isTrustedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const workerOrigin = new URL(request.url).origin;
  const allowedOrigins = [...getAllowedFrontendOrigins(env), workerOrigin];
  return allowedOrigins.includes(origin);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError("invalid_json", 400);
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const workerOrigin = new URL(request.url).origin;
  const allowedOrigins = [...getAllowedFrontendOrigins(env), workerOrigin];
  const allowedOrigin = origin && allowedOrigins.includes(origin)
    ? origin
    : allowedOrigins[0] || workerOrigin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function getAllowedFrontendOrigins(env) {
  const origins = [env.JAMS_FRONTEND_ORIGIN];
  if (env.JAMS_FRONTEND_URL) {
    try {
      origins.push(new URL(env.JAMS_FRONTEND_URL).origin);
    } catch {
      // Invalid frontend URL is ignored; setup checks should catch this.
    }
  }
  return [...new Set(origins.filter(Boolean))];
}

function cookie(request, name, value, options = {}) {
  const parts = [`${name}=${value}`, "Path=/"];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  return cookieHeader.split(";").map((part) => part.trim()).reduce((found, part) => {
    if (found) return found;
    const [key, ...rest] = part.split("=");
    return key === name ? rest.join("=") : "";
  }, "");
}

function assertRequiredEnv(env) {
  const required = [
    "DB",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_ROLE_CHAIRPERSON",
    "DISCORD_ROLE_S_GATE",
    "DISCORD_ROLE_S_GATE_UNVERIFIED",
    "DISCORD_ROLE_S_GATE_VERIFIED",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}

function assertEmailEnv(env) {
  const missing = ["DB", "S_GATE_EMAIL_FROM", "S_GATE_ALLOWED_EMAIL_DOMAINS"]
    .filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required email env/binding: ${missing.join(", ")}`);
  }
  if (!env.GOOGLE_APPS_SCRIPT_MAIL_URL && !env.RESEND_API_KEY && !env.EMAIL && !env.SAKURA_MAIL_RELAY_URL) {
    throw new Error("Missing email sender: configure GOOGLE_APPS_SCRIPT_MAIL_URL, RESEND_API_KEY, EMAIL binding, or SAKURA_MAIL_RELAY_URL");
  }
  if (env.GOOGLE_APPS_SCRIPT_MAIL_URL && !env.GOOGLE_APPS_SCRIPT_MAIL_SECRET) {
    throw new Error("Missing required env: GOOGLE_APPS_SCRIPT_MAIL_SECRET");
  }
  if (env.SAKURA_MAIL_RELAY_URL && !env.SAKURA_MAIL_RELAY_SECRET) {
    throw new Error("Missing required env: SAKURA_MAIL_RELAY_SECRET");
  }
}

function assertDiscordInteractionEnv(env) {
  const missing = [
    "DISCORD_PUBLIC_KEY",
    "DISCORD_GUILD_ID",
    "DISCORD_BOT_TOKEN",
    "DB",
    "S_GATE_EMAIL_FROM",
    "S_GATE_ALLOWED_EMAIL_DOMAINS",
  ].filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required Discord interaction env/binding: ${missing.join(", ")}`);
  }
  assertEmailEnv(env);
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export class DiscordGateway {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.socket = null;
    this.connectPromise = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.heartbeatAcked = true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/ensure") {
      return Response.json(await this.ensureConnected());
    }
    if (request.method === "POST" && url.pathname === "/reconnect") {
      return Response.json(await this.reconnect());
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json(await this.getStatus());
    }
    return new Response("Not found", { status: 404 });
  }

  async ensureConnected() {
    await this.scheduleKeepalive();
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
      return this.getStatus();
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
    return this.getStatus();
  }

  async reconnect() {
    this.clearTimers();
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(4000, "S-GATE reconnect requested");
    }
    this.socket = null;
    await this.setGatewayStatus("reconnecting");
    return this.ensureConnected();
  }

  async getStatus() {
    const stored = await this.ctx.storage.get([
      "gatewayStatus",
      "lastConnectedAt",
      "lastEventAt",
      "lastHeartbeatAckAt",
      "lastDisconnectAt",
      "lastDisconnectCode",
      "lastError",
    ]);
    return {
      status: stored.get("gatewayStatus") ?? "not_started",
      socketState: this.socket?.readyState ?? WebSocket.CLOSED,
      lastConnectedAt: stored.get("lastConnectedAt") ?? null,
      lastEventAt: stored.get("lastEventAt") ?? null,
      lastHeartbeatAckAt: stored.get("lastHeartbeatAckAt") ?? null,
      lastDisconnectAt: stored.get("lastDisconnectAt") ?? null,
      lastDisconnectCode: stored.get("lastDisconnectCode") ?? null,
      lastError: stored.get("lastError") ?? null,
    };
  }

  async alarm() {
    await this.ensureConnected();
  }

  async connect() {
    this.clearTimers();
    await this.setGatewayStatus("connecting", { lastError: null });
    const resumeUrl = await this.ctx.storage.get("resumeGatewayUrl");
    const socket = new WebSocket(resumeUrl || DISCORD_GATEWAY_URL);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.ctx.waitUntil(this.setGatewayStatus("waiting_for_hello"));
    });
    socket.addEventListener("message", (event) => {
      this.ctx.waitUntil(this.handleGatewayMessage(socket, event.data));
    });
    socket.addEventListener("close", (event) => {
      this.ctx.waitUntil(this.handleGatewayClose(socket, event.code, event.reason));
    });
    socket.addEventListener("error", () => {
      this.ctx.waitUntil(this.setGatewayStatus("error", { lastError: "gateway_websocket_error" }));
    });
  }

  async handleGatewayMessage(socket, rawMessage) {
    if (socket !== this.socket || typeof rawMessage !== "string") return;
    let payload;
    try {
      payload = JSON.parse(rawMessage);
    } catch {
      await this.setGatewayStatus("error", { lastError: "invalid_gateway_payload" });
      return;
    }

    if (payload.s !== null && payload.s !== undefined) {
      await this.ctx.storage.put("sequence", payload.s);
    }
    await this.ctx.storage.put("lastEventAt", new Date().toISOString());

    switch (payload.op) {
      case 10:
        await this.handleHello(socket, payload.d?.heartbeat_interval);
        return;
      case 11:
        this.heartbeatAcked = true;
        await this.ctx.storage.put("lastHeartbeatAckAt", new Date().toISOString());
        return;
      case 7:
        await this.restartSocket(socket, 4000, "Discord requested reconnect");
        return;
      case 9:
        if (!payload.d) {
          await this.ctx.storage.delete(["sessionId", "resumeGatewayUrl", "sequence"]);
        }
        await this.restartSocket(socket, 4000, "Discord invalid session");
        return;
      case 0:
        await this.handleDispatch(payload.t, payload.d);
        return;
      default:
        return;
    }
  }

  async handleHello(socket, heartbeatInterval) {
    if (!Number.isFinite(heartbeatInterval) || heartbeatInterval < 1000) {
      await this.restartSocket(socket, 4000, "Invalid heartbeat interval");
      return;
    }
    this.startHeartbeat(socket, heartbeatInterval);

    const sessionId = await this.ctx.storage.get("sessionId");
    const sequence = await this.ctx.storage.get("sequence");
    if (sessionId && sequence !== undefined) {
      this.send(socket, {
        op: 6,
        d: {
          token: this.env.DISCORD_BOT_TOKEN,
          session_id: sessionId,
          seq: sequence,
        },
      });
      await this.setGatewayStatus("resuming");
      return;
    }

    this.send(socket, {
      op: 2,
      d: {
        token: this.env.DISCORD_BOT_TOKEN,
        intents: DISCORD_GATEWAY_INTENTS,
        properties: {
          os: "cloudflare-workers",
          browser: "jams-s-gate",
          device: "jams-s-gate",
        },
      },
    });
    await this.setGatewayStatus("identifying");
  }

  async handleDispatch(eventName, data) {
    if (eventName === "READY") {
      await this.ctx.storage.put({
        sessionId: data.session_id,
        resumeGatewayUrl: `${data.resume_gateway_url}/?v=10&encoding=json`,
        gatewayStatus: "connected",
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
      });
      console.log(JSON.stringify({ message: "S-GATE Discord Gateway connected", resumed: false }));
      return;
    }
    if (eventName === "RESUMED") {
      await this.setGatewayStatus("connected", { lastConnectedAt: new Date().toISOString(), lastError: null });
      console.log(JSON.stringify({ message: "S-GATE Discord Gateway connected", resumed: true }));
      return;
    }
    if (eventName !== "GUILD_MEMBER_REMOVE" || String(data?.guild_id) !== String(this.env.DISCORD_GUILD_ID)) {
      return;
    }

    const discordUserId = String(data?.user?.id ?? "");
    if (!/^\d{17,20}$/.test(discordUserId)) return;
    const result = await this.env.DB.prepare(`
      UPDATE members
      SET verified_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE discord_user_id = ? AND verified_at IS NOT NULL
    `).bind(discordUserId).run();
    console.log(JSON.stringify({
      message: "S-GATE Discord departure processed",
      discordUserId,
      authenticationRevoked: Number(result.meta?.changes ?? 0) === 1,
    }));
  }

  startHeartbeat(socket, interval) {
    this.stopHeartbeat();
    const heartbeat = () => {
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      if (!this.heartbeatAcked) {
        this.ctx.waitUntil(this.restartSocket(socket, 4000, "Heartbeat ACK timeout"));
        return;
      }
      this.heartbeatAcked = false;
      this.ctx.waitUntil(this.ctx.storage.get("sequence").then((sequence) => {
        this.send(socket, { op: 1, d: sequence ?? null });
      }));
      this.heartbeatTimer = setTimeout(heartbeat, interval);
    };
    this.heartbeatAcked = true;
    this.heartbeatTimer = setTimeout(heartbeat, Math.floor(Math.random() * interval));
  }

  async handleGatewayClose(socket, code, reason) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.stopHeartbeat();
    const fatalCodes = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
    await this.setGatewayStatus(fatalCodes.has(code) ? "configuration_error" : "disconnected", {
      lastDisconnectAt: new Date().toISOString(),
      lastDisconnectCode: code,
      lastError: reason || null,
    });
    if (fatalCodes.has(code)) return;
    this.scheduleReconnect();
  }

  async restartSocket(socket, code, reason) {
    if (socket !== this.socket) return;
    this.stopHeartbeat();
    this.socket = null;
    if (socket.readyState < WebSocket.CLOSING) socket.close(code, reason);
    await this.setGatewayStatus("reconnecting");
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = 1000 + Math.floor(Math.random() * 4000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ctx.waitUntil(this.ensureConnected());
    }, delay);
  }

  send(socket, payload) {
    if (socket === this.socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async scheduleKeepalive() {
    await this.ctx.storage.setAlarm(Date.now() + GATEWAY_KEEPALIVE_MS);
  }

  async setGatewayStatus(status, extra = {}) {
    await this.ctx.storage.put({ gatewayStatus: status, ...extra });
  }
}
