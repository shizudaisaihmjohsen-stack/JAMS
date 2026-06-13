const CURRENT_YEAR = 2026;
const STORAGE_KEY = "jams.members.v2";
const DATA_SOURCE_KEY = "jams.dataSource.v2";
const MEETING_LABELS = ["新歓", "第1回", "第2回", "第3回", "第4回", "第5回"];

const ROLE_NAMES = {
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

const sampleCsv = `氏名,フリガナ,LINEの名前,学籍番号,大学メール,区分,役職,配属先,認証状態,新歓,第1回,第2回,第3回,第4回,第5回
情報 太郎,ジョウホウ タロウ,Taro,525A1001,taro@example.ac.jp,RC,部長,ウェブサイト広報課,認証済,出席,出席,出席,出席,出席,出席
宣伝 花子,センデン ハナコ,Hana,725A0002,hana@example.ac.jp,RC,課長,SNS広報課,認証済,出席,出席,欠席,出席,出席,未定
補佐 三郎,ホサ サブロウ,Saburo,525A1502,saburo@example.ac.jp,SV,,パンフレット課,認証済,出席,出席,出席,未定,未定,未定
広報 次郎,コウホウ ジロウ,Jiro,525A2003,jiro@example.ac.jp,JC,,ポスター課,未認証,欠席,出席,出席,未定,未定,未定`;

let members = [];

const $ = (id) => document.getElementById(id);
const sGateBaseUrl = window.JAMS_CONFIG?.sGateBaseUrl;

const elements = {
  csvFileInput: $("csvFileInput"),
  loadSampleButton: $("loadSampleButton"),
  loadMembersButton: $("loadMembersButton"),
  exportButton: $("exportButton"),
  saveMembersButton: $("saveMembersButton"),
  discordLoginLink: $("discordLoginLink"),
  adminStatusText: $("adminStatusText"),
  tableBody: $("memberTableBody"),
  totalCount: $("totalCount"),
  rcCount: $("rcCount"),
  svCount: $("svCount"),
  jcCount: $("jcCount"),
  adminCount: $("adminCount"),
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((entry) => normalize(entry))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((entry) => normalize(entry))) rows.push(row);
  return rows;
}

function normalizeCommitteeType(value, position) {
  const raw = normalize(value).toUpperCase();
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
    "パンフレット課": "パンフレット",
    "ウェブサイト広報課": "Webサイト",
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
  let rcIndex = 0;
  let svIndex = 0;
  let jcIndex = 0;

  sorted.forEach((member) => {
    if (member.committeeType === "RC") {
      rcIndex += 1;
      member.memberNo = `R${rcIndex}`;
    } else if (member.committeeType === "SV") {
      svIndex += 1;
      member.memberNo = `S${svIndex}`;
    } else {
      jcIndex += 1;
      member.memberNo = `J${jcIndex}`;
    }
  });

  return sorted;
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

function makeMembersFromCsv(text) {
  const rows = parseCsv(text);
  const headers = rows.shift()?.map(normalize) ?? [];
  const records = rows.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = normalize(row[index]);
    });
    return record;
  });

  return assignMemberNumbers(records.map((record) => {
    const parsedId = parseStudentId(record["学籍番号"]);
    return {
      name: record["氏名"],
      kana: record["フリガナ"],
      lineName: record["LINEの名前"] || record["LINE名"],
      studentId: parsedId.normalized,
      email: record["大学メール"],
      committeeType: normalizeCommitteeType(record["区分"], record["役職"]),
      position: record["役職"],
      team: record["配属先"] || record["所属の課"],
      authStatus: normalizeAuthStatus(record["認証状態"]),
      grade: parsedId.grade,
      faculty: parsedId.faculty,
      department: parsedId.department,
      parseError: parsedId.error,
      meetings: Object.fromEntries(MEETING_LABELS.map((label) => [label, normalizeMeetingValue(record[label])])),
      updatedAt: new Date().toISOString(),
    };
  }));
}

function makeMembersFromDatabaseRows(rows) {
  return assignMemberNumbers((rows || []).map((row) => ({
    memberNo: row.member_no,
    name: row.name,
    kana: row.kana,
    lineName: row.line_name,
    studentId: row.student_id,
    email: row.email,
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

function updateDataSourceDisplay(text) {
  const target = $("dataSourceInfo");
  if (!target) return;
  const stored = text || localStorage.getItem(DATA_SOURCE_KEY) || "未読込";
  target.innerHTML = `現在の読込データ：<strong>${escapeHtml(stored)}</strong>`;
}

function assignmentGridForList(assignments = []) {
  if (!assignments.length) return '<div class="assignment-grid assignment-grid-empty"><span class="small">未設定</span></div>';
  return `<div class="assignment-grid">${assignments.map((assignment) => `<span class="pill assignment-pill ${assignmentClassName(assignment)}">${escapeHtml(assignmentDisplayNameForList(assignment))}</span>`).join("")}</div>`;
}

function memberToRow(member) {
  const assignments = assignmentGridForList(getAssignmentsFromTeam(member.team));
  return `<tr>
    <td>${escapeHtml(member.memberNo)}</td>
    <td>${escapeHtml(member.name)}</td>
    <td>${escapeHtml(member.lineName)}</td>
    <td>${escapeHtml(member.studentId)}</td>
    <td>${assignments}</td>
    <td><button class="ghost" onclick="showProfileByNumber('${escapeHtml(member.memberNo)}')">詳細</button> <button class="secondary" onclick="editMember('${escapeHtml(member.memberNo)}')">編集</button> <button class="danger" onclick="deleteMember('${escapeHtml(member.memberNo)}')">削除</button></td>
  </tr>`;
}

function renderList() {
  let displayMembers = [...getMembers()];
  const q = normalize($("listFilter")?.value).toLowerCase();
  if (q) {
    displayMembers = displayMembers.filter((member) => [
      member.memberNo,
      member.name,
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
    if (sortBy === "number") return a.memberNo.localeCompare(b.memberNo, "ja", { numeric: true });
    if (sortBy === "assignment") return (a.team || "").localeCompare(b.team || "", "ja");
    return String(a[sortBy] || "").localeCompare(String(b[sortBy] || ""), "ja");
  });

  if (!displayMembers.length) {
    $("memberList").innerHTML = '<div class="empty">表示できる部員データがありません。</div>';
    return;
  }

  $("memberList").innerHTML = `<div class="table-wrap"><table><thead><tr><th>部員No.</th><th>氏名</th><th>LINE名</th><th>学籍番号</th><th>所属の課</th><th>操作</th></tr></thead><tbody>${displayMembers.map(memberToRow).join("")}</tbody></table></div>`;
}

function meetingSummary(member) {
  const attended = MEETING_LABELS.filter((label) => member.meetings[label] === "出席").length;
  return `${attended}/6`;
}

function renderManagementTable() {
  if (!elements.tableBody) return;
  if (!members.length) {
    elements.tableBody.innerHTML = '<tr><td colspan="13">表示できる部員がいません。</td></tr>';
    return;
  }
  elements.tableBody.innerHTML = members.map((member) => `
    <tr>
      <td><strong>${escapeHtml(member.memberNo)}</strong></td>
      <td>${escapeHtml(member.committeeType)}</td>
      <td>${escapeHtml(member.name)}</td>
      <td>${escapeHtml(member.studentId)}</td>
      <td>${escapeHtml(member.email || "-")}</td>
      <td>${escapeHtml(member.grade)}</td>
      <td>${escapeHtml(member.faculty)}</td>
      <td>${escapeHtml(member.department)}</td>
      <td>${escapeHtml(member.position || "-")}</td>
      <td>${escapeHtml(member.team || "-")}</td>
      <td>${escapeHtml(member.authStatus)}</td>
      <td>${member.discordRoles.map((role) => `<span class="pill">${escapeHtml(role)}</span>`).join("")}</td>
      <td>${escapeHtml(meetingSummary(member))}</td>
    </tr>
  `).join("");
}

function renderStats() {
  elements.totalCount.textContent = String(members.length);
  elements.rcCount.textContent = String(members.filter((member) => member.committeeType === "RC").length);
  elements.svCount.textContent = String(members.filter((member) => member.committeeType === "SV").length);
  elements.jcCount.textContent = String(members.filter((member) => member.committeeType === "JC").length);
  elements.adminCount.textContent = String(members.filter((member) => member.discordRoles.includes(ROLE_NAMES.sGateAdmin)).length);
}

function profileHtml(member) {
  const info = parseStudentId(member.studentId);
  const assignmentsText = getAssignmentsFromTeam(member.team).length
    ? getAssignmentsFromTeam(member.team).map((assignment) => `<span class="id-assignment-text">${escapeHtml(assignment)}</span>`).join('<span class="id-separator">／</span>')
    : '<span class="id-muted">未設定</span>';
  const attendedLabels = MEETING_LABELS.filter((label) => member.meetings[label] === "出席");
  const attendanceText = attendedLabels.length ? escapeHtml(attendedLabels.join("・")) : '<span class="id-muted">未参加</span>';
  const code = member.committeeType || "JC";
  return `<div class="id-card-save-wrapper">
  <div class="id-card-image-area">
    <article class="id-card-profile">
      <div class="id-card-topbar">
        <div class="id-card-code">${escapeHtml(code)}</div>
        <div class="id-card-dept">情報宣伝部 部員</div>
        <div class="id-card-no">${escapeHtml(member.memberNo)}</div>
      </div>
      <div class="id-card-main">
        <div class="id-card-name-row">
          <h2 class="id-card-name">${escapeHtml(member.name)}</h2>
          <div class="id-card-head-right"><div class="id-card-line">LINE名：${escapeHtml(member.lineName)}</div></div>
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
          <div class="id-card-attendance-meta">全体会　<span class="id-attendance-text">${attendanceText}</span></div>
        </div>
        <div class="id-card-action-buttons">
          <button class="secondary" onclick="editMember('${escapeHtml(member.memberNo)}')">編集</button>
          <button class="danger" onclick="deleteMember('${escapeHtml(member.memberNo)}')">削除</button>
        </div>
      </div>
    </article>
  </div>
</div>`;
}

function renderAllProfiles() {
  const target = $("searchResult");
  if (!target) return;
  target.innerHTML = members.length ? members.map(profileHtml).join("") : '<div class="empty">登録されている部員がいません。</div>';
}

function searchMembers() {
  const key = normalize($("searchKey")?.value).toLowerCase();
  if (!key) {
    renderAllProfiles();
    return;
  }
  const found = members.filter((member) =>
    member.memberNo.toLowerCase() === key ||
    member.name.toLowerCase().includes(key) ||
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
  const member = members.find((entry) => entry.memberNo === memberNo);
  if (!member) return;
  switchView("register");
  $("editingId").value = member.memberNo;
  $("name").value = member.name;
  $("kana").value = member.kana;
  $("lineName").value = member.lineName;
  $("studentId").value = member.studentId;
  $("email").value = member.email;
  setSelectedAssignments(getAssignmentsFromTeam(member.team));
  MEETING_LABELS.forEach((label, index) => {
    const input = $(`meet${index + 1}`);
    if (input) input.checked = member.meetings[label] === "出席";
  });
  $("saveBtn").textContent = "更新する";
  updateDerivedPreview();
  showMessage("formMessage", `${member.memberNo}を編集中です。`, "ok");
}

function deleteMember(memberNo) {
  const member = members.find((entry) => entry.memberNo === memberNo);
  if (!member) return;
  if (!confirm(`${member.memberNo} ${member.name} さんを削除しますか？`)) return;
  saveMembers(members.filter((entry) => entry.memberNo !== memberNo));
  $("searchResult").innerHTML = "";
}

function resetForm() {
  $("memberForm").reset();
  $("editingId").value = "";
  $("saveBtn").textContent = "登録する";
  showMessage("formMessage", "");
  updateDerivedPreview();
}

function renderAll() {
  renderStats();
  renderManagementTable();
  renderList();
  updateDataSourceDisplay();
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((target) => target.classList.add("hidden"));
  $(`view-${view}`)?.classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  if (view === "list") renderList();
  if (view === "search") renderAllProfiles();
  if (view === "settings") renderManagementTable();
  const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
  const mainTop = document.querySelector("main.wrap")?.offsetTop || 0;
  window.scrollTo({ top: Math.max(0, mainTop - headerHeight - 8), behavior: "auto" });
}

function exportCsv() {
  const headers = ["部員No.", "区分", "氏名", "フリガナ", "LINEの名前", "学籍番号", "大学メール", "学年", "学部", "学科", "役職", "配属先", "認証状態", "S-GATEロール", ...MEETING_LABELS];
  const rows = members.map((member) => [
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
    member.authStatus,
    member.discordRoles.join(" / "),
    ...MEETING_LABELS.map((label) => member.meetings[label]),
  ]);
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${normalize(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jams-members.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function saveMembersToDatabase() {
  if (!sGateBaseUrl) {
    showMessage("dataMessage", "config.js に sGateBaseUrl を設定してください。", "error");
    return;
  }
  if (!members.length) {
    showMessage("dataMessage", "保存する部員データがありません。", "error");
    return;
  }

  elements.saveMembersButton.disabled = true;
  elements.saveMembersButton.textContent = "保存中";
  try {
    const response = await fetch(`${sGateBaseUrl.replace(/\/$/, "")}/api/admin/members/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "保存に失敗しました。");
    showMessage("dataMessage", `${data.imported}件をD1へ保存しました。`, "ok");
  } catch (error) {
    showMessage("dataMessage", `DB保存エラー: ${error.message}`, "error");
  } finally {
    elements.saveMembersButton.disabled = false;
    elements.saveMembersButton.textContent = "DB保存";
  }
}

async function loadMembersFromDatabase() {
  if (!sGateBaseUrl) {
    showMessage("dataMessage", "config.js に sGateBaseUrl を設定してください。", "error");
    return;
  }

  elements.loadMembersButton.disabled = true;
  elements.loadMembersButton.textContent = "読込中";
  try {
    const response = await fetch(`${sGateBaseUrl.replace(/\/$/, "")}/api/admin/members`, {
      method: "GET",
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "読み込みに失敗しました。");
    saveMembers(makeMembersFromDatabaseRows(data.members ?? []));
    localStorage.setItem(DATA_SOURCE_KEY, "D1データベース");
    showMessage("dataMessage", `${members.length}件をD1から読み込みました。`, "ok");
  } catch (error) {
    showMessage("dataMessage", `DB読込エラー: ${error.message}`, "error");
  } finally {
    elements.loadMembersButton.disabled = false;
    elements.loadMembersButton.textContent = "DB読込";
  }
}

async function refreshAdminStatus() {
  if (!sGateBaseUrl) {
    elements.adminStatusText.textContent = "config.js に sGateBaseUrl を設定すると、S-GATE管理者状態を確認できます。";
    return;
  }

  try {
    const response = await fetch(`${sGateBaseUrl.replace(/\/$/, "")}/api/admin/me`, { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "admin_status_failed");
    if (!data.authenticated) {
      elements.adminStatusText.textContent = "Discord認証後、管理者IDに登録されている場合のみDB保存・読込できます。";
      return;
    }
    elements.adminStatusText.textContent = data.admin
      ? `${data.username ?? "Discordユーザー"} として管理者ログイン中です。`
      : `${data.username ?? "Discordユーザー"} としてログイン中ですが、管理者権限がありません。`;
    elements.saveMembersButton.disabled = !data.admin;
    elements.loadMembersButton.disabled = !data.admin;
  } catch (error) {
    elements.adminStatusText.textContent = `S-GATE管理者状態を確認できませんでした: ${error.message}`;
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
  $("memberForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const studentId = normalizeStudentId($("studentId").value);
    const info = parseStudentId(studentId);
    if (info.error && !confirm("学籍番号から一部情報を判定できません。このまま登録しますか？")) return;
    const editingId = normalize($("editingId").value);
    const duplicate = members.find((member) => member.studentId === studentId && member.memberNo !== editingId);
    if (duplicate) {
      showMessage("formMessage", `同じ学籍番号の部員（${duplicate.memberNo}）が既に登録されています。`, "error");
      return;
    }

    const base = {
      memberNo: editingId,
      name: $("name").value,
      kana: $("kana").value,
      lineName: $("lineName").value,
      studentId,
      email: $("email").value,
      committeeType: editingId ? members.find((member) => member.memberNo === editingId)?.committeeType : "JC",
      team: getTeamFromAssignments(getSelectedAssignments()),
      authStatus: editingId ? members.find((member) => member.memberNo === editingId)?.authStatus : "未認証",
      meetings: Object.fromEntries(MEETING_LABELS.map((label, index) => [label, $(`meet${index + 1}`).checked ? "出席" : "欠席"])),
      updatedAt: new Date().toISOString(),
    };

    if (editingId) {
      saveMembers(members.map((member) => member.memberNo === editingId ? { ...member, ...base } : member));
      showMessage("formMessage", `${editingId}を更新しました。`, "ok");
    } else {
      saveMembers([...members, base]);
      showMessage("formMessage", "登録しました。", "ok");
    }
    resetForm();
  });

  ["listFilter", "assignmentFilter", "sortBy"].forEach((id) => $(id)?.addEventListener("input", renderList));
  document.querySelectorAll('input[name="absenceFilter"], input[name="presenceFilter"]').forEach((input) => input.addEventListener("change", renderList));
  $("searchBtn")?.addEventListener("click", searchMembers);
  $("showAllProfiles")?.addEventListener("click", renderAllProfiles);
  $("searchKey")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchMembers();
  });

  elements.csvFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    saveMembers(makeMembersFromCsv(text));
    localStorage.setItem(DATA_SOURCE_KEY, file.name);
    showMessage("dataMessage", `${members.length}件をCSVから読み込みました。`, "ok");
  });
  elements.loadSampleButton?.addEventListener("click", () => {
    saveMembers(makeMembersFromCsv(sampleCsv));
    localStorage.setItem(DATA_SOURCE_KEY, "サンプルデータ");
    showMessage("dataMessage", "サンプルデータを読み込みました。", "ok");
  });
  elements.exportButton?.addEventListener("click", exportCsv);
  elements.saveMembersButton?.addEventListener("click", saveMembersToDatabase);
  elements.loadMembersButton?.addEventListener("click", loadMembersFromDatabase);
  $("deleteAllBtn")?.addEventListener("click", () => {
    if (!confirm("ブラウザ上の部員データをすべて削除しますか？")) return;
    saveMembers([]);
    localStorage.removeItem(DATA_SOURCE_KEY);
    showMessage("dataMessage", "ブラウザ上の部員データを削除しました。", "ok");
  });
}

window.showProfileByNumber = showProfileByNumber;
window.editMember = editMember;
window.deleteMember = deleteMember;

if (sGateBaseUrl) {
  elements.discordLoginLink.href = `${sGateBaseUrl.replace(/\/$/, "")}/sgate/login`;
  elements.discordLoginLink.removeAttribute("aria-disabled");
} else {
  elements.discordLoginLink.title = "config.js に sGateBaseUrl を設定してください。";
}

loadStoredMembers();
wireEvents();
updateDerivedPreview();
renderAll();
refreshAdminStatus();
