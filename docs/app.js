const CURRENT_YEAR = 2026;
const STORAGE_KEY = "jams.members.v2";
const APP_SESSION_KEY = "jams.sgateAppSession.v2";
const LEGACY_APP_SESSION_KEY = "jams.sgateAppSession.v1";
const DEFAULT_APP_SESSION_TTL_SECONDS = 60 * 60 * 12;
const PENDING_APP_TOKEN_KEY = "jams.sgatePendingAppToken.v2";
const LOGIN_ATTEMPT_KEY = "jams.sgateLoginAttempt.v1";
const LOGIN_EVENT_KEY = "jams.sgateLoginEvent.v1";
const LOGIN_ATTEMPT_TTL_MS = 2 * 60 * 1000;
const APP_TOKEN_PARAM = "sgate_app_token";
const PUBLIC_JAMS_URL = "https://shizudaisaihmjohsen-stack.github.io/JAMS/";
const MEETING_LABELS = ["新歓", "第1回", "第2回", "第3回", "第4回", "第5回"];

const ROLE_NAMES = {
  chairperson: "委員長",
  director: "部長",
  manager: "課長",
  sGateAdmin: "[S-GATE] 管理者",
  sGateVerified: "[S-GATE] 認証済",
  sGateUnverified: "[S-GATE] 未認証",
};

const ASSIGNMENT_ORDER = [
  "ポスター課",
  "パンフレット課",
  "ウェブサイト広報課",
  "学内情報宣伝課",
  "学外情報宣伝課",
  "マスコット課",
  "SNS広報課",
];

const TEAM_ROLE_MAP = new Map([
  ["ポスター課", "ポスター"],
  ["ポスター", "ポスター"],
  ["パンフレット課", "パンフレット"],
  ["パンフレット", "パンフレット"],
  ["ウェブサイト広報課", "Webサイト"],
  ["Webサイト", "Webサイト"],
  ["ウェブサイト", "Webサイト"],
  ["学内情報宣伝課", "学内宣"],
  ["学内宣", "学内宣"],
  ["学外情報宣伝課", "学外宣"],
  ["学外宣", "学外宣"],
  ["マスコット課", "マスコット"],
  ["マスコット", "マスコット"],
  ["SNS広報課", "SNS"],
  ["SNS", "SNS"],
]);

const FACULTY_MAP = new Map([
  ["5", "工学部"],
  ["7", "情報学部"],
]);

const DEPARTMENT_MAP = {
  "5": new Map([
    ["1", "機械工学科"],
    ["2", "電気電子工学科"],
    ["3", "電子物質科学科"],
    ["4", "化学バイオ工学科"],
    ["5", "数理システム工学科"],
  ]),
  "7": new Map([
    ["0", "情報科学科"],
    ["1", "情報社会学科"],
    ["2", "行動情報学科"],
  ]),
};

let members = [];
let appAccess = "guest";
let currentMemberNo = "";
let canEditMembers = false;
let directAuthEmail = "";
let loginBroadcastChannel = null;
let loginRefreshInProgress = false;
let loginAttemptTimer = null;

const TAB_INSTANCE_ID = typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const $ = (id) => document.getElementById(id);
const sGateBaseUrl = window.JAMS_CONFIG?.sGateBaseUrl;

function getAppSessionToken() {
  try {
    const stored = localStorage.getItem(APP_SESSION_KEY);
    if (stored) {
      const session = JSON.parse(stored);
      if (session?.token && Number(session.expiresAt) > Date.now()) {
        return session.token;
      }
      localStorage.removeItem(APP_SESSION_KEY);
    }
  } catch {
    // 保存データが壊れている場合やlocalStorageが使えない場合は旧方式を確認します。
  }

  try {
    const legacyToken = sessionStorage.getItem(LEGACY_APP_SESSION_KEY) || "";
    if (legacyToken) {
      setAppSessionToken(legacyToken);
      return legacyToken;
    }
  } catch {
    // Web Storageが使えない環境ではCookie方式へフォールバックします。
  }
  return "";
}

function setAppSessionToken(token, expiresInSeconds = DEFAULT_APP_SESSION_TTL_SECONDS) {
  try {
    if (token) {
      const ttlSeconds = Number(expiresInSeconds);
      const expiresAt = Date.now()
        + (Number.isFinite(ttlSeconds) && ttlSeconds > 0
          ? ttlSeconds
          : DEFAULT_APP_SESSION_TTL_SECONDS) * 1000;
      localStorage.setItem(APP_SESSION_KEY, JSON.stringify({ token, expiresAt }));
    } else {
      localStorage.removeItem(APP_SESSION_KEY);
    }
  } catch {
    // localStorageが使えない環境ではCookie方式へフォールバックします。
  }
  try {
    sessionStorage.removeItem(LEGACY_APP_SESSION_KEY);
    sessionStorage.removeItem(APP_SESSION_KEY);
  } catch {
    // 旧形式の削除に失敗しても認証処理は続行します。
  }
}

function consumeAppExchangeToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(APP_TOKEN_PARAM) || "";
  if (token) {
    try {
      sessionStorage.setItem(PENDING_APP_TOKEN_KEY, token);
    } catch {
      // sessionStorageが使えない場合も、この読み込み中の交換は続行できます。
    }
    url.searchParams.delete(APP_TOKEN_PARAM);
    window.history.replaceState({}, document.title, url.toString());
    return token;
  }
  try {
    return sessionStorage.getItem(PENDING_APP_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function clearPendingAppExchangeToken() {
  try {
    sessionStorage.removeItem(PENDING_APP_TOKEN_KEY);
  } catch {
    // sessionStorageが使えない環境では何もしません。
  }
}

function getActiveLoginAttempt() {
  try {
    const attempt = JSON.parse(localStorage.getItem(LOGIN_ATTEMPT_KEY) || "null");
    if (!attempt?.tabId || !Number.isFinite(Number(attempt.startedAt))) {
      localStorage.removeItem(LOGIN_ATTEMPT_KEY);
      return null;
    }
    if (Date.now() - Number(attempt.startedAt) >= LOGIN_ATTEMPT_TTL_MS) {
      localStorage.removeItem(LOGIN_ATTEMPT_KEY);
      return null;
    }
    return attempt;
  } catch {
    return null;
  }
}

function releaseLoginAttempt(force = false) {
  try {
    const attempt = getActiveLoginAttempt();
    if (force || !attempt || attempt.tabId === TAB_INSTANCE_ID) {
      localStorage.removeItem(LOGIN_ATTEMPT_KEY);
    }
  } catch {
    // localStorageが利用できなくても、このタブのログイン処理は続行します。
  }
  updateLoginLinkState();
}

function updateLoginLinkState() {
  const link = elements?.appLoginLink;
  if (!link || !sGateBaseUrl) return;
  const attempt = getActiveLoginAttempt();
  const inProgress = Boolean(attempt);
  link.setAttribute("aria-disabled", String(inProgress));
  link.textContent = inProgress ? "Discord認証を進行中" : "Discordでログイン";
  link.classList.toggle("login-in-progress", inProgress);
  if (loginAttemptTimer) clearTimeout(loginAttemptTimer);
  loginAttemptTimer = attempt
    ? setTimeout(updateLoginLinkState, Math.max(0, LOGIN_ATTEMPT_TTL_MS - (Date.now() - Number(attempt.startedAt))) + 50)
    : null;
}

function beginDiscordLogin(event) {
  const activeAttempt = getActiveLoginAttempt();
  if (activeAttempt) {
    event.preventDefault();
    setLoginMessage("別の画面でDiscord認証を進めています。完了すると、この画面も自動で更新されます。");
    updateLoginLinkState();
    return;
  }
  try {
    localStorage.setItem(LOGIN_ATTEMPT_KEY, JSON.stringify({
      tabId: TAB_INSTANCE_ID,
      startedAt: Date.now(),
    }));
  } catch {
    // 保存できない環境では、このタブ内の通常ログインとして続行します。
  }
  updateLoginLinkState();
}

function announceLoginSuccess() {
  const event = { type: "login_success", at: Date.now() };
  releaseLoginAttempt(true);
  try {
    localStorage.setItem(LOGIN_EVENT_KEY, JSON.stringify(event));
  } catch {
    // BroadcastChannelが使える場合はそちらだけで通知します。
  }
  loginBroadcastChannel?.postMessage(event);
}

async function handleLoginCoordinatorEvent(event) {
  if (event?.type !== "login_success" || loginRefreshInProgress || appAccess === "admin" || appAccess === "self") return;
  loginRefreshInProgress = true;
  try {
    setLoginMessage("別の画面でログインが完了しました。ログイン状態を更新しています。");
    await loadAppBootstrap();
  } finally {
    loginRefreshInProgress = false;
  }
}

function initializeLoginCoordination() {
  if ("BroadcastChannel" in window) {
    loginBroadcastChannel = new BroadcastChannel("jams-sgate-login");
    loginBroadcastChannel.addEventListener("message", (event) => {
      void handleLoginCoordinatorEvent(event.data);
    });
  }
  window.addEventListener("storage", (event) => {
    if (event.key === LOGIN_ATTEMPT_KEY) updateLoginLinkState();
    if (event.key === LOGIN_EVENT_KEY && event.newValue) {
      try {
        void handleLoginCoordinatorEvent(JSON.parse(event.newValue));
      } catch {
        // 他タブからの壊れた通知は無視します。
      }
    }
  });
  updateLoginLinkState();
}

function sgateApiUrl(path) {
  return `${sGateBaseUrl.replace(/\/$/, "")}${path}`;
}

async function sgateFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const appSession = getAppSessionToken();
  if (appSession && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${appSession}`);
  }
  return fetch(sgateApiUrl(path), {
    ...options,
    credentials: "include",
    headers,
  });
}

async function establishAppSessionFromUrl() {
  const exchangeToken = consumeAppExchangeToken();
  if (!exchangeToken || !sGateBaseUrl) return;

  const response = await fetch(sgateApiUrl("/api/app/session"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: exchangeToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session) {
    if (response.status === 401 || data.error === "invalid_app_token") {
      clearPendingAppExchangeToken();
      releaseLoginAttempt(true);
    }
    const error = new Error("ログイン情報の有効期限が切れたか、別の画面ですでに使用されました。Discordログインからやり直してください。");
    error.code = data.error || "app_session_exchange_failed";
    throw error;
  }
  setAppSessionToken(data.session, data.expiresIn);
  clearPendingAppExchangeToken();
  announceLoginSuccess();
}

const elements = {
  mainNav: $("mainNav"),
  appLoginLink: $("appLoginLink"),
  loginActionBox: $("loginActionBox"),
  directAuthForm: $("directAuthForm"),
  directCodeForm: $("directCodeForm"),
  directStudentId: $("directStudentId"),
  directEmail: $("directEmail"),
  directCode: $("directCode"),
  directAuthMessage: $("directAuthMessage"),
  directAuthStartButton: $("directAuthStartButton"),
  directAuthConfirmButton: $("directAuthConfirmButton"),
  logoutButton: $("logoutButton"),
  loginMessage: $("loginMessage"),
  sGateInviteLink: $("sGateInviteLink"),
  managementPageLink: $("managementPageLink"),
  copySgateLinkButton: $("copySgateLinkButton"),
  copyManagementLinkButton: $("copyManagementLinkButton"),
  discordLoginLink: $("discordLoginLink"),
  previewDmButton: $("previewDmButton"),
  sendDmButton: $("sendDmButton"),
  adminStatusText: $("adminStatusText"),
  tableBody: $("memberTableBody"),
  totalCount: $("totalCount"),
  chairCount: $("chairCount"),
  rcCount: $("rcCount"),
  svCount: $("svCount"),
  jcCount: $("jcCount"),
  verifiedCount: $("verifiedCount"),
  unverifiedCount: $("unverifiedCount"),
};

function normalize(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return normalize(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
}

function normalizeStudentId(value) {
  return normalize(value).toUpperCase();
}

function parseStudentId(studentId) {
  const normalized = normalizeStudentId(studentId);
  const isValid = /^[0-9A-Z]{8}$/.test(normalized);
  if (!isValid) {
    return { normalized, faculty: "判定不可", department: "判定不可", grade: "判定不可", admissionYear: "", error: "学籍番号は8桁の英数字で入力してください。" };
  }

  const facultyCode = normalized[0];
  const yearCode = Number(normalized.slice(1, 3));
  const departmentCode = normalized[4];
  const admissionYear = 2000 + yearCode;
  const gradeNumber = Math.max(1, CURRENT_YEAR - admissionYear + 1);
  const faculty = FACULTY_MAP.get(facultyCode) ?? "判定不可";
  const department = DEPARTMENT_MAP[facultyCode]?.get(departmentCode) ?? "判定不可";
  return {
    normalized,
    faculty,
    department,
    grade: `${gradeNumber}年`,
    admissionYear,
    error: faculty === "判定不可" || department === "判定不可" ? "学部または学科の判定に失敗しました。" : "",
  };
}

function updateDerivedPreview() {
  const info = parseStudentId($("studentId")?.value);
  $("derivedGrade").textContent = info.grade;
  $("derivedFaculty").textContent = info.faculty;
  $("derivedDepartment").textContent = info.department;
}

function normalizeCommitteeType(value, position) {
  const normalized = normalize(value);
  if (normalized === ROLE_NAMES.chairperson) return ROLE_NAMES.chairperson;
  const raw = normalized.toUpperCase();
  if (raw === "RC" || raw === "SV" || raw === "JC") return raw;
  const role = normalize(position);
  if (role === ROLE_NAMES.director || role === ROLE_NAMES.manager || role.includes("課長")) return "RC";
  return "JC";
}

function normalizeAuthStatus(value) {
  const raw = normalize(value);
  return ["認証済", "認証済み", "verified", "VERIFIED"].includes(raw) ? "認証済" : "未認証";
}

function normalizeTeamRoles(team) {
  return normalize(team)
    .split(/[・、,／/]+/)
    .map((part) => TEAM_ROLE_MAP.get(normalize(part)))
    .filter(Boolean);
}

function buildDiscordRoles(member) {
  if (member.authStatus !== "認証済") return [ROLE_NAMES.sGateUnverified];
  const roles = [ROLE_NAMES.sGateVerified, member.committeeType];
  if (member.position.includes(ROLE_NAMES.director)) roles.push(ROLE_NAMES.sGateAdmin);
  normalizeTeamRoles(member.team).forEach((role) => roles.push(role));
  return [...new Set(roles)];
}

function assignmentClassName(assignment) {
  const map = {
    "ポスター課": "assignment-poster",
    "パンフレット課": "assignment-pamphlet",
    "ウェブサイト広報課": "assignment-web",
    "学内情報宣伝課": "assignment-campus-pr",
    "学外情報宣伝課": "assignment-external-pr",
    "マスコット課": "assignment-mascot",
    "SNS広報課": "assignment-sns",
  };
  return map[assignment] || "assignment-default";
}

function assignmentDisplayNameForList(assignment) {
  const map = {
    "ポスター課": "ポスター",
    "パンフレット課": "パンフ",
    "ウェブサイト広報課": "ウェブ",
    "学内情報宣伝課": "学内宣",
    "学外情報宣伝課": "学外宣",
    "マスコット課": "マスコット",
    "SNS広報課": "SNS",
  };
  return map[assignment] || assignment;
}

function getAssignmentsFromTeam(team) {
  return normalize(team).split(/[・、,／/]+/).map(normalize).filter(Boolean);
}

function getTeamFromAssignments(assignments) {
  return (assignments || []).join("・");
}

function getSelectedAssignments() {
  return Array.from(document.querySelectorAll('input[name="assignment"]:checked')).map((input) => input.value);
}

function setSelectedAssignments(assignments) {
  const selected = new Set(assignments || []);
  document.querySelectorAll('input[name="assignment"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function normalizeMeetingValue(value) {
  const raw = normalize(value);
  if (raw === "出席" || raw === "参加" || raw === "1" || raw.toLowerCase() === "true") return "出席";
  if (raw === "欠席" || raw === "未参加" || raw === "0" || raw.toLowerCase() === "false") return "欠席";
  return raw || "未定";
}

function attendanceToMeetings(attendance = []) {
  const meetings = {};
  MEETING_LABELS.forEach((label, index) => {
    meetings[label] = attendance[index] ? "出席" : "欠席";
  });
  return meetings;
}

function meetingsToAttendance(meetings = {}) {
  return MEETING_LABELS.map((label) => meetings[label] === "出席");
}

function normalizeMember(member) {
  const parsedId = parseStudentId(member.studentId ?? member.student_id);
  const assignments = Array.isArray(member.assignments)
    ? member.assignments
    : getAssignmentsFromTeam(member.team ?? member.assignment);
  const meetings = member.meetings ?? attendanceToMeetings(member.attendance);
  const normalized = {
    memberNo: normalize(member.memberNo ?? member.member_no ?? member.number),
    name: normalize(member.name),
    kana: normalize(member.kana),
    lineName: normalize(member.lineName ?? member.line_name),
    studentId: parsedId.normalized,
    email: normalize(member.email).toLowerCase(),
    discordUserId: normalize(member.discordUserId ?? member.discord_user_id ?? member.discordId ?? member.discord_id),
    sGateUserId: normalize(member.sGateUserId ?? member.s_gate_user_id ?? member.discordUsername ?? member.discord_username),
    committeeType: normalizeCommitteeType(member.committeeType ?? member.committee_type, member.position),
    position: normalize(member.position),
    team: getTeamFromAssignments(assignments),
    authStatus: normalizeAuthStatus(member.authStatus ?? member.auth_status ?? (member.verified_at ? "認証済" : "未認証")),
    grade: normalize(member.grade) || parsedId.grade,
    faculty: normalize(member.faculty) || parsedId.faculty,
    department: normalize(member.department) || parsedId.department,
    parseError: parsedId.error,
    meetings: Object.fromEntries(MEETING_LABELS.map((label) => [label, normalizeMeetingValue(meetings[label])])),
    updatedAt: member.updatedAt ?? member.updated_at ?? "",
    discordRoles: [],
  };
  normalized.discordRoles = buildDiscordRoles(normalized);
  return normalized;
}

function assignMemberNumbers(sourceMembers) {
  const sorted = sourceMembers.map(normalizeMember).sort((a, b) => a.studentId.localeCompare(b.studentId, "en"));
  const usedNumbers = new Map([
    ["C", new Set()],
    ["R", new Set()],
    ["S", new Set()],
    ["J", new Set()],
  ]);

  const prefixFor = (member) => {
    if (member.committeeType === ROLE_NAMES.chairperson) return "C";
    if (member.committeeType === "RC") return "R";
    if (member.committeeType === "SV") return "S";
    return "J";
  };

  // Keep issued numbers stable. Only missing, invalid, or duplicate numbers are allocated again.
  sorted.forEach((member) => {
    const prefix = prefixFor(member);
    const match = String(member.memberNo || "").match(/^([CRSJ])(\d+)$/i);
    const number = match && match[1].toUpperCase() === prefix ? Number(match[2]) : 0;
    if (number > 0 && !usedNumbers.get(prefix).has(number)) {
      usedNumbers.get(prefix).add(number);
      member.memberNo = `${prefix}${number}`;
      return;
    }
    member.memberNo = "";
  });

  sorted.forEach((member) => {
    if (member.memberNo) return;
    const prefix = prefixFor(member);
    const used = usedNumbers.get(prefix);
    let number = 1;
    while (used.has(number)) number += 1;
    used.add(number);
    member.memberNo = `${prefix}${number}`;
  });

  return sorted;
}

function memberNumberHtml(value) {
  const memberNumber = normalize(value);
  const match = memberNumber.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return escapeHtml(memberNumber);
  return `<span>${escapeHtml(match[1])}</span><span>${escapeHtml(match[2])}</span>`;
}

function compareMemberNo(a, b) {
  const parse = (value) => {
    const match = String(value || "").match(/^([A-Z])(\d+)$/i);
    const prefixOrder = { J: 0, S: 1, R: 2, C: 3 };
    if (!match) return { group: 99, number: Number.MAX_SAFE_INTEGER, raw: String(value || "") };
    const prefix = match[1].toUpperCase();
    return {
      group: prefixOrder[prefix] ?? 98,
      number: Number(match[2]),
      raw: String(value || ""),
    };
  };
  const left = parse(a?.memberNo);
  const right = parse(b?.memberNo);
  if (left.group !== right.group) return left.group - right.group;
  if (left.number !== right.number) return left.number - right.number;
  return left.raw.localeCompare(right.raw, "ja", { numeric: true });
}

function sortMembersByMemberNo(sourceMembers) {
  return [...sourceMembers].sort(compareMemberNo);
}

function getMembers() {
  return members;
}

function saveMembers(sourceMembers) {
  members = assignMemberNumbers(sourceMembers);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
  renderAll();
}

function loadStoredMembers() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    members = assignMemberNumbers(Array.isArray(stored) ? stored : []);
  } catch {
    members = [];
  }
}

function makeMembersFromDatabaseRows(rows) {
  return assignMemberNumbers((rows || []).map((row) => ({
    memberNo: row.member_no,
    name: row.name,
    kana: row.kana,
    lineName: row.line_name,
    studentId: row.student_id,
    email: row.email,
    discordUserId: row.discord_user_id,
    sGateUserId: row.discord_username,
    committeeType: row.committee_type,
    position: row.position,
    team: row.team,
    authStatus: row.verified_at ? "認証済" : "未認証",
    grade: row.grade,
    faculty: row.faculty,
    department: row.department,
    meetings: {
      "新歓": row.meeting_welcome,
      "第1回": row.meeting_1,
      "第2回": row.meeting_2,
      "第3回": row.meeting_3,
      "第4回": row.meeting_4,
      "第5回": row.meeting_5,
    },
  })));
}

function showMessage(targetId, text, type = "ok") {
  const target = $(targetId);
  if (!target) return;
  target.innerHTML = text ? `<div class="notice ${type}">${escapeHtml(text)}</div>` : "";
}

function assignmentGridForList(assignments = []) {
  if (!assignments.length) return '<div class="assignment-grid assignment-grid-empty"><span class="small">未設定</span></div>';
  return `<div class="assignment-grid">${assignments.map((assignment) => `<span class="pill assignment-pill ${assignmentClassName(assignment)}">${escapeHtml(assignmentDisplayNameForList(assignment))}</span>`).join("")}</div>`;
}

function memberToRow(member) {
  const assignments = assignmentGridForList(getAssignmentsFromTeam(member.team));
  const actions = canEditMembers
    ? `<button class="ghost" onclick="showProfileByNumber('${escapeHtml(member.memberNo)}')">詳細</button> <button class="secondary" onclick="editMember('${escapeHtml(member.memberNo)}')">編集</button> <button class="danger" onclick="deleteMember('${escapeHtml(member.memberNo)}')">削除</button>`
    : `<button class="ghost" onclick="showProfileByNumber('${escapeHtml(member.memberNo)}')">詳細</button>`;
  return `<tr>
    <td>${escapeHtml(member.memberNo)}</td>
    <td>${escapeHtml(member.name)}</td>
    <td>${escapeHtml(member.kana || "-")}</td>
    <td>${escapeHtml(member.studentId)}</td>
    <td>${assignments}</td>
    <td>${actions}</td>
  </tr>`;
}

function memberListTableHtml(groupLabel, groupMembers) {
  if (!groupMembers.length) return "";
  return `<section class="member-list-group">
    <div class="member-list-group-head">
      <h3>${escapeHtml(groupLabel)}</h3>
      <span>${groupMembers.length}名</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>部員No.</th><th>氏名</th><th>フリガナ</th><th>学籍番号</th><th>所属の課</th><th>操作</th></tr>
        </thead>
        <tbody>${groupMembers.map(memberToRow).join("")}</tbody>
      </table>
    </div>
  </section>`;
}

function renderList() {
  let displayMembers = [...getMembers()];
  const q = normalize($("listFilter")?.value).toLowerCase();
  if (q) {
    displayMembers = displayMembers.filter((member) => [
      member.memberNo,
      member.name,
      member.kana,
      member.lineName,
      member.studentId,
      member.team,
    ].join(" ").toLowerCase().includes(q));
  }

  const assignmentFilter = $("assignmentFilter")?.value || "";
  if (assignmentFilter) {
    displayMembers = displayMembers.filter((member) => {
      const assignments = getAssignmentsFromTeam(member.team);
      if (assignmentFilter === "__unassigned__") return assignments.length === 0;
      return assignments.includes(assignmentFilter);
    });
  }

  const absenceFilters = Array.from(document.querySelectorAll('input[name="absenceFilter"]:checked')).map((input) => Number(input.value));
  if (absenceFilters.length) {
    displayMembers = displayMembers.filter((member) => absenceFilters.every((index) => member.meetings[MEETING_LABELS[index]] !== "出席"));
  }

  const presenceFilters = Array.from(document.querySelectorAll('input[name="presenceFilter"]:checked')).map((input) => Number(input.value));
  if (presenceFilters.length) {
    displayMembers = displayMembers.filter((member) => presenceFilters.every((index) => member.meetings[MEETING_LABELS[index]] === "出席"));
  }

  const sortBy = $("sortBy")?.value || "number";
  displayMembers.sort((a, b) => {
    if (sortBy === "number") return compareMemberNo(a, b);
    if (sortBy === "assignment") return (a.team || "").localeCompare(b.team || "", "ja");
    return String(a[sortBy] || "").localeCompare(String(b[sortBy] || ""), "ja");
  });

  if (!displayMembers.length) {
    $("memberList").innerHTML = '<div class="empty">表示できる部員データがありません。</div>';
    return;
  }

  const groupOrder = ["JC", "SV", "RC", ROLE_NAMES.chairperson];
  $("memberList").innerHTML = groupOrder
    .map((groupLabel) => memberListTableHtml(groupLabel, displayMembers.filter((member) => member.committeeType === groupLabel)))
    .join("");
}

function meetingSummary(member) {
  const attended = MEETING_LABELS.filter((label) => member.meetings[label] === "出席").length;
  return `${attended}/6`;
}

function renderManagementTable() {
  if (!elements.tableBody) return;
  if (!members.length) {
    elements.tableBody.innerHTML = '<tr><td colspan="6">表示できる部員がいません。</td></tr>';
    return;
  }
  elements.tableBody.innerHTML = sortMembersByMemberNo(members).map((member) => `
    <tr>
      <td>${escapeHtml(member.memberNo)}</td>
      <td>${escapeHtml(member.name)}</td>
      <td>${escapeHtml(member.kana || "-")}</td>
      <td class="discord-id-cell">${escapeHtml(member.sGateUserId || "-")}</td>
      <td class="discord-id-cell">${escapeHtml(member.discordUserId || "-")}</td>
      <td><span class="pill sgate-status ${member.authStatus === "認証済" ? "green" : "gray"}">${escapeHtml(member.authStatus === "認証済" ? ROLE_NAMES.sGateVerified : ROLE_NAMES.sGateUnverified)}</span></td>
    </tr>
  `).join("");
}

function renderStats() {
  elements.totalCount.textContent = String(members.length);
  elements.chairCount.textContent = String(members.filter((member) => member.committeeType === ROLE_NAMES.chairperson).length);
  elements.rcCount.textContent = String(members.filter((member) => member.committeeType === "RC").length);
  elements.svCount.textContent = String(members.filter((member) => member.committeeType === "SV").length);
  elements.jcCount.textContent = String(members.filter((member) => member.committeeType === "JC").length);
  elements.verifiedCount.textContent = String(members.filter((member) => member.authStatus === "認証済").length);
  elements.unverifiedCount.textContent = String(members.filter((member) => member.authStatus !== "認証済").length);
}

function profileHtml(member) {
  const info = parseStudentId(member.studentId);
  const assignmentsText = getAssignmentsFromTeam(member.team).length
    ? getAssignmentsFromTeam(member.team).map((assignment) => `<span class="id-assignment-text">${escapeHtml(assignment)}</span>`).join('<span class="id-separator">／</span>')
    : '<span class="id-muted">未設定</span>';
  const code = member.committeeType || "JC";
  const committeeLabel = code === ROLE_NAMES.chairperson || code === "RC" ? "常任委員" : code === "JC" ? "非常任委員" : "補佐役員";
  return `<div class="id-card-save-wrapper">
  <div class="id-card-image-area">
    <article class="id-card-profile">
      <div class="id-card-topbar">
        <div class="id-card-code">${escapeHtml(code)}</div>
        <div class="id-card-dept">情報宣伝部 ${escapeHtml(committeeLabel)}</div>
        <div class="id-card-no">${memberNumberHtml(member.memberNo)}</div>
      </div>
      <div class="id-card-main">
        <div class="id-card-name-row">
          <h2 class="id-card-name">${escapeHtml(member.name)}</h2>
          <div class="id-card-head-right"><div class="id-card-line">${escapeHtml(member.kana || "-")}</div></div>
        </div>
        <div class="id-card-divider"></div>
        <div class="id-card-assignment-plain">
          <span class="id-card-assignment-label">配属</span>
          <span class="id-card-assignment-value">${assignmentsText}</span>
        </div>
        <div class="id-card-info-grid">
          <div class="id-field id-grade-field"><span class="id-label">学年</span><span class="id-value">${escapeHtml(info.grade)}</span></div>
          <div class="id-field id-student"><span class="id-label">学籍番号</span><span class="id-value id-mono">${escapeHtml(member.studentId)}</span></div>
          <div class="id-field id-department-field"><span class="id-label">学部・学科</span><span class="id-value">${escapeHtml(info.faculty)} ${escapeHtml(info.department)}</span></div>
        </div>
      </div>
      <div class="id-card-actions">
        <div class="id-card-footer-meta">
          <div class="id-card-attendance-meta">LINE名：${escapeHtml(member.lineName || "-")}</div>
          <div class="id-card-attendance-meta">${escapeHtml(member.email || "-")}</div>
        </div>
        ${canEditMembers ? `<div class="id-card-action-buttons">
          <button class="secondary" onclick="editMember('${escapeHtml(member.memberNo)}')">編集</button>
          <button class="danger" onclick="deleteMember('${escapeHtml(member.memberNo)}')">削除</button>
        </div>` : ""}
      </div>
    </article>
  </div>
</div>`;
}

function renderAllProfiles() {
  const target = $("searchResult");
  if (!target) return;
  const displayMembers = sortMembersByMemberNo(members);
  target.innerHTML = displayMembers.length ? displayMembers.map(profileHtml).join("") : '<div class="empty">登録されている部員がいません。</div>';
}

function searchMembers() {
  const key = normalize($("searchKey")?.value).toLowerCase();
  if (!key) {
    renderAllProfiles();
    return;
  }
  const found = sortMembersByMemberNo(members).filter((member) =>
    member.memberNo.toLowerCase() === key ||
    member.name.toLowerCase().includes(key) ||
    member.kana.toLowerCase().includes(key) ||
    member.lineName.toLowerCase().includes(key) ||
    member.studentId.toLowerCase() === key
  );
  $("searchResult").innerHTML = found.length ? found.map(profileHtml).join("") : '<div class="empty">該当する部員が見つかりません。</div>';
}

function showProfileByNumber(memberNo) {
  switchView("search");
  const member = members.find((entry) => entry.memberNo === memberNo);
  $("searchResult").innerHTML = member ? profileHtml(member) : '<div class="empty">該当する部員が見つかりません。</div>';
}

function editMember(memberNo) {
  if (!canEditMembers) return;
  const member = members.find((entry) => entry.memberNo === memberNo);
  if (!member) return;
  switchView("register");
  $("editingId").value = member.memberNo;
  $("name").value = member.name;
  $("kana").value = member.kana;
  $("lineName").value = member.lineName;
  $("studentId").value = member.studentId;
  $("email").value = member.email;
  $("committeeType").value = member.committeeType || "JC";
  $("position").value = member.position || "";
  setSelectedAssignments(getAssignmentsFromTeam(member.team));
  MEETING_LABELS.forEach((label, index) => {
    const input = $(`meet${index + 1}`);
    if (input) input.checked = member.meetings[label] === "出席";
  });
  $("saveBtn").textContent = "更新する";
  updateDerivedPreview();
  showMessage("formMessage", `${member.memberNo}を編集中です。`, "ok");
}

async function deleteMember(memberNo) {
  if (!canEditMembers) return;
  const member = members.find((entry) => entry.memberNo === memberNo);
  if (!member) return;
  if (!confirm(`${member.memberNo} ${member.name} さんを削除しますか？`)) return;
  const deleted = await deleteMemberFromDatabase(member);
  if (!deleted) return;
  saveMembers(members.filter((entry) => entry.memberNo !== memberNo));
  $("searchResult").innerHTML = "";
  showMessage("dataMessage", `${member.memberNo} ${member.name} さんをD1から削除しました。`, "ok");
}

function resetForm(clearMessage = true) {
  $("memberForm").reset();
  $("editingId").value = "";
  $("saveBtn").disabled = false;
  $("saveBtn").textContent = "登録する";
  if (clearMessage) showMessage("formMessage", "");
  updateDerivedPreview();
}

function renderAll() {
  renderStats();
  renderManagementTable();
  renderList();
}

function getDefaultViewForAccess() {
  if (appAccess === "admin") return "register";
  if (appAccess === "staff") return "list";
  if (appAccess === "self") return "search";
  return "login";
}

function isViewAllowed(view) {
  if (view === "login") return appAccess === "guest" || appAccess === "none";
  if (appAccess === "admin") return ["register", "list", "search", "settings"].includes(view);
  if (appAccess === "staff") return ["list", "search"].includes(view);
  if (appAccess === "self") return view === "search";
  return false;
}

function applyAccessUi() {
  canEditMembers = appAccess === "admin";
  document.body.dataset.access = appAccess;
  if (elements.logoutButton) {
    elements.logoutButton.hidden = appAccess === "guest" || appAccess === "none";
  }
  document.querySelectorAll(".tab").forEach((tab) => {
    const allowed = isViewAllowed(tab.dataset.view);
    tab.hidden = !allowed;
    tab.disabled = !allowed;
  });
  if (elements.mainNav) {
    elements.mainNav.hidden = appAccess === "guest" || appAccess === "none" || appAccess === "self";
  }
  document.querySelector(".search-control-panel")?.classList.toggle("hidden", appAccess === "self");
  document.querySelectorAll("#view-list .list-control-panel").forEach((panel) => {
    panel.classList.toggle("hidden", appAccess === "self");
  });
}

async function logout() {
  if (!sGateBaseUrl) {
    appAccess = "guest";
    currentMemberNo = "";
    canEditMembers = false;
    members = [];
    applyAccessUi();
    setLoginMessage("ログアウトしました。");
    switchView("login");
    return;
  }

  if (elements.logoutButton) {
    elements.logoutButton.disabled = true;
    elements.logoutButton.textContent = "ログアウト中";
  }
  try {
    await sgateFetch("/sgate/logout", {
      method: "POST",
    });
  } catch {
    // Cookie削除に失敗しても、画面側はログイン画面へ戻します。
  } finally {
    setAppSessionToken("");
    clearPendingAppExchangeToken();
    releaseLoginAttempt(true);
    appAccess = "guest";
    currentMemberNo = "";
    canEditMembers = false;
    members = [];
    localStorage.removeItem(STORAGE_KEY);
    applyAccessUi();
    setLoginMessage("ログアウトしました。");
    if (elements.logoutButton) {
      elements.logoutButton.disabled = false;
      elements.logoutButton.textContent = "ログアウト";
    }
    switchView("login");
  }
}

function switchView(view) {
  const targetView = isViewAllowed(view) ? view : getDefaultViewForAccess();
  document.querySelectorAll(".view").forEach((target) => target.classList.add("hidden"));
  $(`view-${targetView}`)?.classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === targetView));
  if (targetView === "list") renderList();
  if (targetView === "search") renderAllProfiles();
  if (targetView === "settings") renderManagementTable();
  const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
  const mainTop = document.querySelector("main.wrap")?.offsetTop || 0;
  window.scrollTo({ top: Math.max(0, mainTop - headerHeight - 8), behavior: "auto" });
}

async function persistMemberToDatabase(member) {
  if (!sGateBaseUrl) {
    showMessage("formMessage", "config.js に sGateBaseUrl を設定してください。", "error");
    return false;
  }
  try {
    const response = await sgateFetch("/api/admin/members/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members: [member] }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "保存に失敗しました。");
    return true;
  } catch (error) {
    showMessage("formMessage", `D1保存エラー: ${error.message}`, "error");
    return false;
  }
}

async function deleteMemberFromDatabase(member) {
  if (!sGateBaseUrl) {
    showMessage("dataMessage", "config.js に sGateBaseUrl を設定してください。", "error");
    return false;
  }
  try {
    const response = await sgateFetch("/api/admin/members/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberNo: member.memberNo, studentId: member.studentId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "削除に失敗しました。");
    return true;
  } catch (error) {
    showMessage("dataMessage", `D1削除エラー: ${error.message}`, "error");
    alert(`D1削除エラー: ${error.message}`);
    return false;
  }
}

function setLoginMessage(text) {
  if (!elements.loginMessage) return;
  elements.loginMessage.textContent = text;
  elements.loginMessage.hidden = !text;
}

function setDirectAuthMessage(text, type = "") {
  if (!elements.directAuthMessage) return;
  elements.directAuthMessage.textContent = text;
  elements.directAuthMessage.className = `form-status${type ? ` ${type}` : ""}`;
}

function setDirectAuthMode(enabled) {
  if (elements.loginActionBox) elements.loginActionBox.hidden = enabled;
  if (elements.directAuthForm) elements.directAuthForm.hidden = !enabled;
  if (elements.directCodeForm) elements.directCodeForm.hidden = true;
  setDirectAuthMessage("");
}

function setDirectCodeMode(enabled) {
  if (elements.directAuthForm) elements.directAuthForm.hidden = enabled;
  if (elements.directCodeForm) elements.directCodeForm.hidden = !enabled;
}

function buildSgateInviteLink() {
  if (!sGateBaseUrl) return "";
  return `${sGateBaseUrl.replace(/\/$/, "")}/sgate/auth`;
}

function updateSgateInviteLink() {
  if (!elements.sGateInviteLink) return;
  elements.sGateInviteLink.value = buildSgateInviteLink();
}

async function copyUrl(link, label) {
  if (!link) {
    showMessage("dataMessage", "config.js に sGateBaseUrl を設定してください。", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    showMessage("dataMessage", `${label}をコピーしました。`, "ok");
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = link;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    showMessage("dataMessage", copied ? `${label}をコピーしました。` : `${label}をコピーできませんでした。`, copied ? "ok" : "error");
  }
}

function copySgateInviteLink() {
  return copyUrl(elements.sGateInviteLink?.value || buildSgateInviteLink(), "認証URL");
}

function copyManagementPageLink() {
  return copyUrl(elements.managementPageLink?.value || PUBLIC_JAMS_URL, "管理画面URL");
}

function consumeLoginStatus() {
  const url = new URL(window.location.href);
  const status = url.searchParams.get("status");
  if (!status) return "";

  releaseLoginAttempt(true);

  url.searchParams.delete("status");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

  const messages = {
    login_ok: "",
    state_error: "ログイン情報の有効期限が切れたか、すでに使用されています。この画面からDiscordログインをやり直してください。",
    discord_error: "Discord認証がキャンセルされました。もう一度Discordログインを実行してください。",
    oauth_exchange_failed: "Discordとのログイン情報交換に失敗しました。認証リンクを開き直してください。",
    discord_user_failed: "Discordアカウント情報を確認できませんでした。時間を置いて認証リンクを開き直してください。",
    login_service_failed: "認証サービスで一時的なエラーが発生しました。時間を置いて認証リンクを開き直してください。",
    server_join_failed: "Discordログインは完了しましたが、サーバー参加に失敗しました。Discordアカウントのメール認証・電話番号認証、参加制限、BANの有無を確認してください。",
    discord_account_verification_required: "Discordアカウントのメール認証または電話番号認証が必要です。Discord側で認証を完了してから、もう一度お試しください。",
    discord_guild_limit: "参加できるDiscordサーバー数の上限に達しています。不要なサーバーから退出して、もう一度お試しください。",
    discord_user_banned: "このDiscordアカウントはサーバーからBANされているため参加できません。サーバー管理者へ連絡してください。",
    discord_join_bot_permission: "S-GATE Botにサーバー参加処理の権限がありません。サーバー管理者へ連絡してください。",
    discord_join_scope_missing: "Discordのサーバー参加許可を取得できませんでした。認証リンクを開き直し、表示される権限を許可してください。",
    discord_bot_access_error: "現在、S-GATE BotがDiscordサーバーへ接続できないため、認証を完了できません。サーバー管理者へ連絡してください。",
  };
  return messages[status] ?? "認証処理でエラーが発生しました。時間をおいて、もう一度実行してください。";
}

async function loadAppBootstrap() {
  const loginStatusMessage = consumeLoginStatus();
  if (!sGateBaseUrl) {
    appAccess = "guest";
    members = [];
    applyAccessUi();
    setLoginMessage(loginStatusMessage || "config.js に sGateBaseUrl を設定してください。");
    switchView("login");
    return;
  }

  try {
    await establishAppSessionFromUrl();
    const response = await sgateFetch("/api/app/bootstrap", {
      method: "GET",
    });
    const data = await response.json();
    if (!data.authenticated) {
      setAppSessionToken("");
      appAccess = "guest";
      members = [];
      applyAccessUi();
      setDirectAuthMode(false);
      setLoginMessage(loginStatusMessage);
      switchView("login");
      return;
    }
    if (!response.ok || data.access === "none") {
      appAccess = "none";
      members = [];
      applyAccessUi();
      setLoginMessage(loginStatusMessage);
      setDirectAuthMode(true);
      switchView("login");
      return;
    }

    appAccess = data.access;
    currentMemberNo = data.member?.member_no ?? "";
    canEditMembers = Boolean(data.canEdit);
    members = makeMembersFromDatabaseRows(data.members ?? []);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
    applyAccessUi();
    renderAll();
    if (appAccess === "admin") {
      await refreshAdminStatus();
    }
    switchView(getDefaultViewForAccess());
  } catch (error) {
    if (error?.code === "invalid_app_token" || error?.code === "app_session_exchange_failed") {
      clearPendingAppExchangeToken();
      releaseLoginAttempt(true);
    }
    appAccess = "guest";
    members = [];
    applyAccessUi();
    setDirectAuthMode(false);
    setLoginMessage(loginStatusMessage || error.message || "ログイン状態を確認できませんでした。再読み込みして、もう一度ログインしてください。");
    switchView("login");
  }
}

function directAuthErrorMessage(errorCode) {
  const messages = {
    not_authenticated: "Discordログインからやり直してください。",
    invalid_email_domain: "大学メールアドレスを入力してください。",
    invalid_code: "認証コードを確認してください。",
    invalid_or_expired_code: "認証コードが違うか、有効期限が切れています。",
    member_not_found: "入力内容と一致する部員データが見つかりませんでした。",
    discord_server_join_required: "Discordサーバーへの参加が確認できませんでした。Discordアカウントの認証状態を確認し、もう一度S-GATE認証リンクからログインしてください。",
    discord_bot_access_error: "現在、S-GATE BotがDiscordサーバーへ接続できません。サーバー管理者へ連絡してください。",
    discord_role_sync_failed: "Discordロールの付与を確認できなかったため、認証済みにはしていません。時間を置いてもう一度お試しいただくか、サーバー管理者へ連絡してください。",
    discord_account_already_linked: "このDiscordアカウントは別の部員情報に認証済みです。サーバー管理者へ連絡してください。",
    member_already_linked: "この部員情報は別のDiscordアカウントに認証済みです。サーバー管理者へ連絡してください。",
  };
  return messages[errorCode] ?? "認証処理に失敗しました。時間を置いてもう一度お試しください。";
}

async function startDirectAuth(event) {
  event?.preventDefault();
  if (!sGateBaseUrl) {
    setDirectAuthMessage("config.js に sGateBaseUrl を設定してください。", "error");
    return;
  }
  const studentId = String(elements.directStudentId?.value ?? "").trim().toUpperCase();
  const email = String(elements.directEmail?.value ?? "").trim().toLowerCase();
  if (!/^[0-9A-Z]{8}$/.test(studentId) || !email) {
    setDirectAuthMessage("学籍番号と大学メールアドレスを入力してください。", "error");
    return;
  }

  elements.directAuthStartButton.disabled = true;
  elements.directAuthStartButton.textContent = "送信中";
  setDirectAuthMessage("");
  try {
    const response = await sgateFetch("/api/sgate/email/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(directAuthErrorMessage(data.error));
    directAuthEmail = email;
    setDirectCodeMode(true);
    setDirectAuthMessage("大学メールに認証コードを送信しました。", "ok");
    elements.directCode?.focus();
  } catch (error) {
    setDirectAuthMessage(error.message, "error");
  } finally {
    elements.directAuthStartButton.disabled = false;
    elements.directAuthStartButton.textContent = "認証コードを送信";
  }
}

async function confirmDirectAuth(event) {
  event?.preventDefault();
  const code = String(elements.directCode?.value ?? "").trim();
  if (!directAuthEmail || !/^\d{6}$/.test(code)) {
    setDirectAuthMessage("6桁の認証コードを入力してください。", "error");
    return;
  }

  elements.directAuthConfirmButton.disabled = true;
  elements.directAuthConfirmButton.textContent = "確認中";
  setDirectAuthMessage("");
  try {
    const response = await sgateFetch("/api/sgate/email/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: directAuthEmail, code }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(directAuthErrorMessage(data.error));
    setDirectAuthMessage("認証が完了しました。Discordに戻ってください。", "ok");
    if (elements.directCodeForm) elements.directCodeForm.hidden = true;
  } catch (error) {
    setDirectAuthMessage(error.message, "error");
  } finally {
    elements.directAuthConfirmButton.disabled = false;
    elements.directAuthConfirmButton.textContent = "認証を完了";
  }
}

function getDmTargetPreview() {
  const meeting = $("dmMeetingSelect")?.value || MEETING_LABELS[0];
  const absentMembers = members.filter((member) => member.meetings?.[meeting] !== "出席");
  const sendableMembers = absentMembers.filter((member) => member.discordUserId);
  const missingDiscordMembers = absentMembers.filter((member) => !member.discordUserId);
  return { meeting, absentMembers, sendableMembers, missingDiscordMembers };
}

function previewAbsenceDmTargets() {
  const { meeting, absentMembers, sendableMembers, missingDiscordMembers } = getDmTargetPreview();
  const missingText = missingDiscordMembers.length
    ? ` Discord ID未取得のため送信できない部員が${missingDiscordMembers.length}人います。`
    : "";
  const names = sendableMembers.slice(0, 8).map((member) => `${member.memberNo} ${member.name}`).join("、");
  $("dmPreview").hidden = false;
  $("dmPreview").textContent = `${meeting}の未参加者は${absentMembers.length}人、DM送信対象は${sendableMembers.length}人です。${missingText}${names ? ` 送信対象例：${names}` : ""}`;
}

async function sendAbsenceDm() {
  if (!sGateBaseUrl) {
    showMessage("dataMessage", "config.js に sGateBaseUrl を設定してください。", "error");
    return;
  }
  const meeting = $("dmMeetingSelect")?.value || MEETING_LABELS[0];
  const message = normalize($("dmMessage")?.value);
  if (!message) {
    $("dmPreview").textContent = "送信メッセージを入力してください。";
    $("dmPreview").hidden = false;
    return;
  }
  const { sendableMembers, missingDiscordMembers } = getDmTargetPreview();
  const confirmText = [
    `${meeting}の未参加者へDiscord DMを送信します。`,
    `画面上の送信対象: ${sendableMembers.length}人`,
    missingDiscordMembers.length ? `Discord ID未取得: ${missingDiscordMembers.length}人` : "",
    "",
    "送信後は取り消せません。実行しますか？",
  ].filter(Boolean).join("\n");
  if (!confirm(confirmText)) return;

  elements.sendDmButton.disabled = true;
  elements.sendDmButton.textContent = "送信中";
  $("dmPreview").textContent = "DMを送信しています。画面を閉じずにお待ちください。";
  $("dmPreview").hidden = false;
  try {
    const response = await sgateFetch("/api/admin/meetings/absentees/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting, message }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "DM送信に失敗しました。");
    $("dmPreview").textContent = `${data.meeting}の未参加者${data.targeted}人中、${data.sent}人へDMを送信しました。Discord ID未取得: ${data.skippedNoDiscord}人、送信失敗: ${data.failed}人。`;
  } catch (error) {
    $("dmPreview").textContent = `DM送信エラー: ${error.message}`;
  } finally {
    elements.sendDmButton.disabled = false;
    elements.sendDmButton.textContent = "未参加者へDM送信";
    await refreshAdminStatus();
  }
}

async function refreshAdminStatus() {
  if (!sGateBaseUrl) {
    elements.adminStatusText.textContent = "config.js に sGateBaseUrl を設定すると、S-GATE管理者状態を確認できます。";
    if (elements.sendDmButton) elements.sendDmButton.disabled = true;
    return;
  }

  try {
    const response = await sgateFetch("/api/admin/me");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "admin_status_failed");
    if (!data.authenticated) {
      elements.adminStatusText.textContent = "未ログイン";
      if (elements.sendDmButton) elements.sendDmButton.disabled = true;
      return;
    }
    elements.adminStatusText.textContent = data.admin
      ? `管理者: ${data.username ?? "Discordユーザー"}`
      : `閲覧のみ: ${data.username ?? "Discordユーザー"}`;
    if (elements.sendDmButton) elements.sendDmButton.disabled = !data.admin;
  } catch (error) {
    elements.adminStatusText.textContent = `S-GATE管理者状態を確認できませんでした: ${error.message}`;
    if (elements.sendDmButton) elements.sendDmButton.disabled = true;
  }
}

function wireEvents() {
  const menuToggle = $("menuToggle");
  const setMenuOpen = (open) => {
    document.body.classList.toggle("menu-open", open);
    menuToggle?.setAttribute("aria-expanded", String(open));
  };
  menuToggle?.addEventListener("click", () => setMenuOpen(!document.body.classList.contains("menu-open")));
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
    switchView(button.dataset.view);
    setMenuOpen(false);
  }));

  $("studentId")?.addEventListener("input", updateDerivedPreview);
  $("clearBtn")?.addEventListener("click", resetForm);
  $("memberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = $("saveBtn");
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "保存中";
    }
    const studentId = normalizeStudentId($("studentId").value);
    const info = parseStudentId(studentId);
    if (info.error && !confirm("学籍番号から一部情報を判定できません。このまま登録しますか？")) {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = normalize($("editingId").value) ? "更新する" : "登録する";
      }
      return;
    }
    const editingId = normalize($("editingId").value);
    const duplicate = members.find((member) => member.studentId === studentId && member.memberNo !== editingId);
    if (duplicate) {
      showMessage("formMessage", `同じ学籍番号の部員（${duplicate.memberNo}）が既に登録されています。`, "error");
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = editingId ? "更新する" : "登録する";
      }
      return;
    }

    const base = {
      memberNo: editingId,
      name: $("name").value,
      kana: $("kana").value,
      lineName: $("lineName").value,
      studentId,
      email: $("email").value,
      committeeType: $("committeeType").value,
      position: $("position").value,
      team: getTeamFromAssignments(getSelectedAssignments()),
      authStatus: editingId ? members.find((member) => member.memberNo === editingId)?.authStatus : "未認証",
      meetings: Object.fromEntries(MEETING_LABELS.map((label, index) => [label, $(`meet${index + 1}`).checked ? "出席" : "欠席"])),
      updatedAt: new Date().toISOString(),
    };

    const nextMembers = assignMemberNumbers(editingId
      ? members.map((member) => member.memberNo === editingId ? { ...member, ...base } : member)
      : [...members, base]);
    const savedMember = nextMembers.find((member) => member.studentId === studentId);
    const savedToDatabase = savedMember ? await persistMemberToDatabase(savedMember) : false;
    if (!savedToDatabase) {
      showMessage("formMessage", `D1への保存に失敗しました。内容を確認して、もう一度${editingId ? "更新" : "登録"}してください。`, "error");
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = editingId ? "更新する" : "登録する";
      }
      return;
    }
    saveMembers(nextMembers);
    showMessage("formMessage", `${editingId ? `${savedMember.memberNo}を更新` : `${savedMember.memberNo}を登録`}し、D1へ自動保存しました。`, "ok");
    resetForm(false);
  });

  ["listFilter", "assignmentFilter", "sortBy"].forEach((id) => $(id)?.addEventListener("input", renderList));
  document.querySelectorAll('input[name="absenceFilter"], input[name="presenceFilter"]').forEach((input) => input.addEventListener("change", renderList));
  $("searchBtn")?.addEventListener("click", searchMembers);
  $("showAllProfiles")?.addEventListener("click", renderAllProfiles);
  $("searchKey")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchMembers();
  });

  elements.previewDmButton?.addEventListener("click", previewAbsenceDmTargets);
  elements.sendDmButton?.addEventListener("click", sendAbsenceDm);
  elements.logoutButton?.addEventListener("click", logout);
  elements.directAuthForm?.addEventListener("submit", startDirectAuth);
  elements.directCodeForm?.addEventListener("submit", confirmDirectAuth);
  elements.copySgateLinkButton?.addEventListener("click", copySgateInviteLink);
  elements.copyManagementLinkButton?.addEventListener("click", copyManagementPageLink);
  elements.appLoginLink?.addEventListener("click", beginDiscordLogin);
  $("dmMeetingSelect")?.addEventListener("change", previewAbsenceDmTargets);
}

window.showProfileByNumber = showProfileByNumber;
window.editMember = editMember;
window.deleteMember = deleteMember;

if (sGateBaseUrl) {
  const appLoginUrl = `${sGateBaseUrl.replace(/\/$/, "")}/sgate/manage`;
  if (elements.discordLoginLink) {
    elements.discordLoginLink.href = appLoginUrl;
    elements.discordLoginLink.removeAttribute("aria-disabled");
  }
  if (elements.appLoginLink) {
    elements.appLoginLink.href = appLoginUrl;
    elements.appLoginLink.removeAttribute("aria-disabled");
  }
} else {
  if (elements.discordLoginLink) elements.discordLoginLink.title = "config.js に sGateBaseUrl を設定してください。";
  if (elements.appLoginLink) elements.appLoginLink.title = "config.js に sGateBaseUrl を設定してください。";
}

wireEvents();
initializeLoginCoordination();
updateDerivedPreview();
updateSgateInviteLink();
loadAppBootstrap();
