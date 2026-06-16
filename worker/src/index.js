const DISCORD_API_BASE = "https://discord.com/api/v10";
const SESSION_COOKIE = "sgate_session";
const STATE_COOKIE = "sgate_state";
const RETURN_TO_COOKIE = "sgate_return_to";

const roleNameToEnvKey = {
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
        detail: error instanceof Error ? error.message : String(error),
      }, 500, request, env);
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return corsPreflight(request, env);
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "S-GATE" }, 200, request, env);
  }

  if (request.method === "POST" && url.pathname === "/discord/interactions") {
    return handleDiscordInteraction(request, env, ctx);
  }

  if (request.method === "GET" && url.pathname === "/sgate/login") {
    return startDiscordLogin(request, env);
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

  if (request.method === "GET" && url.pathname === "/api/app/bootstrap") {
    return getAppBootstrap(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/members/import") {
    return importMembers(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/admin/members") {
    return listMembers(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/meetings/absentees/dm") {
    return sendAbsenceDirectMessages(request, env);
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
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
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

    await env.DB.prepare(`
      INSERT INTO email_verification_codes (email, discord_user_id, code_hash, token_hash, expires_at, attempts, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET
        discord_user_id = excluded.discord_user_id,
        code_hash = excluded.code_hash,
        token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        created_at = excluded.created_at
    `).bind(email, discordUserId, codeHash, tokenHash, expiresAt, Date.now()).run();

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

async function startDiscordLogin(request, env) {
  assertRequiredEnv(env);
  const url = new URL(request.url);
  const redirectUri = getRedirectUri(request, env);
  const state = crypto.randomUUID();
  const returnTo = sanitizeReturnTo(url.searchParams.get("return_to"), env);
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("scope", "identify guilds.join");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "consent");

  const headers = new Headers({
    Location: authorizeUrl.toString(),
  });
  headers.append("Set-Cookie", cookie(request, STATE_COOKIE, state, { maxAge: 600, httpOnly: true, sameSite: "Lax" }));
  if (returnTo) {
    headers.append("Set-Cookie", cookie(request, RETURN_TO_COOKIE, encodeURIComponent(returnTo), { maxAge: 600, httpOnly: true, sameSite: "Lax" }));
  } else {
    headers.append("Set-Cookie", cookie(request, RETURN_TO_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  }

  return new Response(null, {
    status: 302,
    headers,
  });
}

async function handleDiscordCallback(request, env) {
  assertRequiredEnv(env);
  const url = new URL(request.url);
  const frontendUrl = getLoginReturnUrl(request, env);
  const error = url.searchParams.get("error");
  if (error) {
    return redirect(`${frontendUrl}?status=discord_error`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, STATE_COOKIE);
  if (!code || !state || state !== expectedState) {
    return redirect(`${frontendUrl}?status=state_error`);
  }

  const token = await exchangeCodeForToken(code, getRedirectUri(request, env), env);
  const user = await discordFetch("/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  await addGuildMemberBestEffort(user.id, token.access_token, env);
  await addRoleBestEffort(user.id, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, "S-GATE login");

  const session = await signSession({ userId: user.id, username: user.username, issuedAt: Date.now() }, env);
  const headers = new Headers({ Location: `${frontendUrl}?status=login_ok` });
  headers.append("Set-Cookie", cookie(request, STATE_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  headers.append("Set-Cookie", cookie(request, RETURN_TO_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }));
  headers.append("Set-Cookie", cookie(request, SESSION_COOKIE, session, {
    maxAge: 60 * 60 * 12,
    httpOnly: true,
    sameSite: getSessionCookieSameSite(request, env),
  }));
  return new Response(null, { status: 302, headers });
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

  if (env.S_GATE_ALLOW_CLIENT_ROLE_APPLY !== "true") {
    return json({
      error: "verification_store_not_configured",
      message: "部員照合DBを接続するまで、クライアント申告だけで認証済みロールを付与する処理は無効です。",
    }, 409, request, env);
  }

  const member = await request.json();
  const roleNames = buildVerifiedRoleNames(member);
  const roleIds = roleNames.map((name) => env[roleNameToEnvKey[name]]).filter(Boolean);

  await removeRole(session.userId, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, "S-GATE verified");
  for (const roleId of roleIds) {
    await addRole(session.userId, roleId, env, "S-GATE verified");
  }

  return json({ ok: true, roles: roleNames }, 200, request, env);
}

async function startEmailVerification(request, env) {
  try {
    const session = await readSignedSession(request, env);
    if (!session) {
      return json({ error: "not_authenticated" }, 401, request, env);
    }
    assertEmailEnv(env);

    const body = await request.json();
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

    await env.DB.prepare(`
      INSERT INTO email_verification_codes (email, discord_user_id, code_hash, expires_at, attempts, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET
        discord_user_id = excluded.discord_user_id,
        code_hash = excluded.code_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        created_at = excluded.created_at
    `).bind(email, session.userId, codeHash, expiresAt, Date.now()).run();

    await sendVerificationEmail(email, code, env);
    return json({
      ok: true,
      message: "入力されたメールアドレスが部員名簿に登録されている場合、認証コードを送信しました。",
    }, 200, request, env);
  } catch (error) {
    console.error("Email verification start failed", error);
    return json({
      error: "email_verification_start_failed",
      detail: error instanceof Error ? error.message : String(error),
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

  const body = await request.json();
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? "").trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return json({ error: "invalid_code" }, 400, request, env);
  }

  const stored = await env.DB.prepare(`
    SELECT email, discord_user_id, code_hash, expires_at, attempts
    FROM email_verification_codes
    WHERE email = ?
  `).bind(email).first();

  if (!stored || stored.discord_user_id !== session.userId || stored.expires_at < Date.now() || stored.attempts >= 5) {
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const expectedHash = await hashVerificationCode(email, code, env);
  if (stored.code_hash !== expectedHash) {
    await env.DB.prepare(`
      UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?
    `).bind(email).run();
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const member = await findMemberForEmail(email, "", env);
  if (!member) {
    return json({ error: "member_not_found" }, 404, request, env);
  }

  await env.DB.prepare(`
    UPDATE members
    SET discord_user_id = ?, verified_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(session.userId, new Date().toISOString(), member.id).run();

  const roleNames = buildVerifiedRoleNames({
    committeeType: member.committee_type,
    position: member.position,
    team: member.team,
  });
  const roleIds = roleNames.map((name) => env[roleNameToEnvKey[name]]).filter(Boolean);
  await removeRole(session.userId, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, "S-GATE email verified");
  for (const roleId of roleIds) {
    await addRole(session.userId, roleId, env, "S-GATE email verified");
  }

  await env.DB.prepare(`DELETE FROM email_verification_codes WHERE email = ?`).bind(email).run();
  return json({
    ok: true,
    member: {
      memberNo: member.member_no,
      name: member.name,
      committeeType: member.committee_type,
      team: member.team,
    },
    roles: roleNames,
  }, 200, request, env);
}

async function confirmEmailVerificationByToken(request, env) {
  assertEmailEnv(env);
  const body = await request.json();
  const token = String(body.token ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!token || !/^\d{6}$/.test(code)) {
    return json({ error: "invalid_code" }, 400, request, env);
  }

  const tokenHash = await hashVerificationToken(token, env);
  const stored = await env.DB.prepare(`
    SELECT email, discord_user_id, code_hash, expires_at, attempts
    FROM email_verification_codes
    WHERE token_hash = ?
  `).bind(tokenHash).first();

  if (!stored || stored.expires_at < Date.now() || stored.attempts >= 5) {
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const expectedHash = await hashVerificationCode(stored.email, code, env);
  if (stored.code_hash !== expectedHash) {
    await env.DB.prepare(`
      UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?
    `).bind(stored.email).run();
    return json({ error: "invalid_or_expired_code" }, 400, request, env);
  }

  const result = await completeMemberVerification(stored.email, stored.discord_user_id, env);
  await env.DB.prepare(`DELETE FROM email_verification_codes WHERE email = ?`).bind(stored.email).run();
  return json(result, 200, request, env);
}

async function completeMemberVerification(email, discordUserId, env) {
  const member = await findMemberForEmail(email, "", env);
  if (!member) {
    throw httpError("member_not_found", 404);
  }

  await env.DB.prepare(`
    UPDATE members
    SET discord_user_id = ?, verified_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(discordUserId, new Date().toISOString(), member.id).run();

  const roleNames = buildVerifiedRoleNames({
    committeeType: member.committee_type,
    position: member.position,
    team: member.team,
  });
  const roleIds = roleNames.map((name) => env[roleNameToEnvKey[name]]).filter(Boolean);
  await removeRole(discordUserId, env.DISCORD_ROLE_S_GATE_UNVERIFIED, env, "S-GATE email verified");
  for (const roleId of roleIds) {
    await addRole(discordUserId, roleId, env, "S-GATE email verified");
  }

  return {
    ok: true,
    member: {
      memberNo: member.member_no,
      name: member.name,
      committeeType: member.committee_type,
      team: member.team,
    },
    roles: roleNames,
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
  const body = await request.json();
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
      verified_at
    FROM members
    WHERE discord_user_id = ?
  `).bind(discordUserId).first();
}

function getAccessLevel(session, member, env) {
  if (isAdminDiscordUser(session.userId, env) || String(member?.position ?? "").includes("部長")) {
    return "admin";
  }
  const committeeType = String(member?.committee_type ?? "");
  if (committeeType === "RC" || committeeType === "SV") {
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

  const body = await request.json();
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
  if (isAdminDiscordUser(session.userId, env)) {
    return true;
  }
  const member = await findMemberByDiscordUserId(session.userId, env);
  return String(member?.position ?? "").includes("部長");
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
    email: normalizeEmail(member.email),
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
  if (!member.memberNo) fields.push("部員No.");
  if (!member.name) fields.push("氏名");
  if (!/^[0-9A-Z]{8}$/.test(member.studentId)) fields.push("学籍番号");
  if (!isValidEmail(member.email)) fields.push("大学メール");
  if (!member.faculty || member.faculty === "不明") fields.push("学部");
  if (!member.department || member.department === "不明") fields.push("学科");
  return fields.length ? { rowNumber, fields } : null;
}

function buildVerifiedRoleNames(member) {
  const roleNames = ["[S-GATE] 認証済"];
  const committeeType = normalizeCommitteeType(member.committeeType);
  roleNames.push(committeeType);

  if (String(member.position ?? "").includes("部長")) {
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
  return value === "RC" || value === "SV" || value === "JC" ? value : "JC";
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
  } catch (error) {
    console.warn(`Skipping optional guild member add: ${error.message}`);
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
  } catch (error) {
    console.warn(`Skipping optional role assignment: ${error.message}`);
  }
}

async function removeRole(userId, roleId, env, reason) {
  if (!roleId) return;
  await discordFetch(`/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    headers: botHeaders(env, reason),
  }, [204, 404]);
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
    throw new Error(`Discord API error ${response.status}: ${detail}`);
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
  const value = readCookie(request, SESSION_COOKIE);
  if (!value || !value.includes(".")) {
    return null;
  }
  const [body, signature] = value.split(".", 2);
  const expected = await hmac(body, getSessionSecret(env));
  if (signature !== expected) {
    return null;
  }
  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload.userId || Date.now() - payload.issuedAt > 60 * 60 * 12 * 1000) {
    return null;
  }
  return payload;
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

function getLoginReturnUrl(request, env) {
  const stored = readCookie(request, RETURN_TO_COOKIE);
  if (!stored) {
    return getFrontendUrl(request, env);
  }
  try {
    const decoded = decodeURIComponent(stored);
    return sanitizeReturnTo(decoded, env) || getFrontendUrl(request, env);
  } catch {
    return getFrontendUrl(request, env);
  }
}

function sanitizeReturnTo(value, env) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const allowedOrigins = [
      env.JAMS_FRONTEND_ORIGIN,
      env.JAMS_FRONTEND_URL ? new URL(env.JAMS_FRONTEND_URL).origin : "",
    ].filter(Boolean);
    if (!allowedOrigins.includes(url.origin)) {
      return "";
    }
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

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function corsPreflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.JAMS_FRONTEND_ORIGIN || origin || "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
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
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
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
