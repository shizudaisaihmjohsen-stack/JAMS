const APP_SESSION_KEY = "jams.sgateAppSession.v2";
const APP_TOKEN_PARAM = "sgate_app_token";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;

const sGateBaseUrl = window.JAMS_CONFIG?.sGateBaseUrl?.replace(/\/$/, "") || "";
const elements = {
  title: document.querySelector("#authTitle"),
  discordStep: document.querySelector("#discordStep"),
  discordAuthLink: document.querySelector("#discordAuthLink"),
  memberAuthForm: document.querySelector("#memberAuthForm"),
  codeForm: document.querySelector("#codeForm"),
  studentId: document.querySelector("#studentId"),
  email: document.querySelector("#email"),
  verificationCode: document.querySelector("#verificationCode"),
  sendCodeButton: document.querySelector("#sendCodeButton"),
  confirmButton: document.querySelector("#confirmButton"),
  message: document.querySelector("#authMessage"),
};

let appSession = readSession();
let verificationEmail = "";

function apiUrl(path) {
  return `${sGateBaseUrl}${path}`;
}

function readSession() {
  try {
    const value = JSON.parse(localStorage.getItem(APP_SESSION_KEY) || "null");
    if (value?.token && Number(value.expiresAt) > Date.now()) return value.token;
    localStorage.removeItem(APP_SESSION_KEY);
  } catch {
    localStorage.removeItem(APP_SESSION_KEY);
  }
  return "";
}

function storeSession(token, expiresIn = DEFAULT_SESSION_TTL_SECONDS) {
  appSession = token;
  localStorage.setItem(APP_SESSION_KEY, JSON.stringify({
    token,
    expiresAt: Date.now() + Number(expiresIn || DEFAULT_SESSION_TTL_SECONDS) * 1000,
  }));
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (appSession) headers.set("Authorization", `Bearer ${appSession}`);
  return fetch(apiUrl(path), { ...options, headers, credentials: "include" });
}

function setMessage(text, type = "") {
  elements.message.textContent = text;
  elements.message.className = `form-status${type ? ` ${type}` : ""}`;
}

function showStep(step) {
  elements.discordStep.hidden = step !== "discord";
  elements.memberAuthForm.hidden = step !== "member";
  elements.codeForm.hidden = step !== "code";
}

function showComplete(member) {
  showStep("complete");
  elements.title.textContent = "認証が完了しています";
  setMessage(
    member?.member_no
      ? `${member.member_no} ${member.name}さんの認証とDiscordサーバー参加を確認しました。`
      : "認証とDiscordサーバー参加を確認しました。",
    "ok",
  );
}

function loginErrorMessage(status) {
  const messages = {
    state_error: "認証情報の有効期限が切れています。もう一度お試しください。",
    discord_error: "Discord認証がキャンセルされました。",
    oauth_exchange_failed: "Discordとの認証情報交換に失敗しました。もう一度お試しください。",
    discord_user_failed: "Discordアカウント情報を確認できませんでした。",
    login_service_failed: "認証サービスで一時的なエラーが発生しました。時間を置いてお試しください。",
    server_join_failed: "Discordサーバーへの参加に失敗しました。アカウントの認証状態や参加制限を確認してください。",
    discord_account_verification_required: "Discordアカウントのメール認証または電話番号認証を完了してください。",
    discord_guild_limit: "参加できるDiscordサーバー数の上限に達しています。",
    discord_user_banned: "このDiscordアカウントはサーバーからBANされているため参加できません。",
    discord_join_bot_permission: "S-GATE Botがサーバー参加処理を実行できません。管理者へ連絡してください。",
    discord_join_scope_missing: "Discordのサーバー参加許可を取得できませんでした。",
    discord_bot_access_error: "S-GATE BotがDiscordサーバーへ接続できません。管理者へ連絡してください。",
  };
  return messages[status] || "認証処理でエラーが発生しました。もう一度お試しください。";
}

function verificationErrorMessage(code) {
  const messages = {
    invalid_email_domain: "大学メールアドレスを確認してください。",
    invalid_code: "6桁の認証コードを確認してください。",
    invalid_or_expired_code: "認証コードが違うか、有効期限が切れています。",
    member_not_found: "入力内容と一致する部員情報が見つかりませんでした。",
    discord_server_join_required: "Discordサーバーへの参加を確認できませんでした。認証リンクからやり直してください。",
    discord_bot_access_error: "S-GATE BotがDiscordサーバーへ接続できません。管理者へ連絡してください。",
    discord_role_sync_failed: "Discordロールの付与を確認できませんでした。時間を置いてお試しください。",
    discord_account_already_linked: "このDiscordアカウントは別の部員情報に認証済みです。",
    member_already_linked: "この部員情報は別のDiscordアカウントに認証済みです。",
  };
  return messages[code] || "認証処理に失敗しました。時間を置いてお試しください。";
}

async function exchangeSessionToken(token) {
  const response = await fetch(apiUrl("/api/app/session"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session) throw new Error("認証情報を確認できませんでした。認証リンクからやり直してください。");
  storeSession(data.session, data.expiresIn);
}

async function initialize() {
  if (!sGateBaseUrl) {
    showStep("discord");
    setMessage("認証サービスの設定がありません。", "error");
    return;
  }

  elements.discordAuthLink.href = `${sGateBaseUrl}/sgate/auth`;
  elements.discordAuthLink.removeAttribute("aria-disabled");
  const url = new URL(window.location.href);
  const status = url.searchParams.get("status");
  const exchangeToken = url.searchParams.get(APP_TOKEN_PARAM);
  url.searchParams.delete("status");
  url.searchParams.delete(APP_TOKEN_PARAM);
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

  if (status && status !== "login_ok") {
    showStep("discord");
    setMessage(loginErrorMessage(status), "error");
    return;
  }

  try {
    if (exchangeToken) await exchangeSessionToken(exchangeToken);
    if (!appSession) {
      showStep("discord");
      return;
    }

    const response = await apiFetch("/api/app/bootstrap");
    const data = await response.json();
    if (data.authenticated && data.member?.verified_at) {
      showComplete(data.member);
      return;
    }
    if (data.authenticated) {
      showStep("member");
      elements.title.textContent = "部員情報を確認します";
      setMessage("学籍番号と大学メールアドレスを入力してください。");
      return;
    }
  } catch (error) {
    appSession = "";
    localStorage.removeItem(APP_SESSION_KEY);
    setMessage(error.message, "error");
  }
  showStep("discord");
}

elements.memberAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const studentId = elements.studentId.value.trim().toUpperCase();
  const email = elements.email.value.trim().toLowerCase();
  if (!/^[0-9A-Z]{8}$/.test(studentId) || !email) {
    setMessage("学籍番号と大学メールアドレスを確認してください。", "error");
    return;
  }

  elements.sendCodeButton.disabled = true;
  setMessage("認証コードを送信しています。");
  try {
    const response = await apiFetch("/api/sgate/email/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(verificationErrorMessage(data.error));
    verificationEmail = email;
    showStep("code");
    setMessage("大学メールに6桁の認証コードを送信しました。", "ok");
    elements.verificationCode.focus();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    elements.sendCodeButton.disabled = false;
  }
});

elements.codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = elements.verificationCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    setMessage("6桁の認証コードを入力してください。", "error");
    return;
  }

  elements.confirmButton.disabled = true;
  setMessage("認証状態を確認しています。");
  try {
    const response = await apiFetch("/api/sgate/email/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verificationEmail, code }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(verificationErrorMessage(data.error));
    showComplete(data.member);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    elements.confirmButton.disabled = false;
  }
});

initialize();
