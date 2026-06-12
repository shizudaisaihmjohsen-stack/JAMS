const CURRENT_YEAR = 2026;

const ROLE_NAMES = {
  director: "部長",
  manager: "課長",
  sGate: "S-GATE",
  sGateAdmin: "[S-GATE] 管理者",
  sGateVerified: "[S-GATE] 認証済",
  sGateUnverified: "[S-GATE] 未認証",
  rc: "RC",
  sv: "SV",
  jc: "JC",
};

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
情報 太郎,ジョウホウ タロウ,Taro,525A1001,taro@example.ac.jp,RC,部長,Webサイト,認証済,出席,出席,出席,出席,出席,出席
宣伝 花子,センデン ハナコ,Hana,725A0002,hana@example.ac.jp,RC,課長,SNS,認証済,出席,出席,欠席,出席,出席,未定
補佐 三郎,ホサ サブロウ,Saburo,525A1502,saburo@example.ac.jp,SV,,パンフレット,認証済,出席,出席,出席,未定,未定,未定
広報 次郎,コウホウ ジロウ,Jiro,525A2003,jiro@example.ac.jp,JC,,ポスター,未認証,欠席,出席,出席,未定,未定,未定`;

let members = [];

const elements = {
  csvFileInput: document.querySelector("#csvFileInput"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  loadMembersButton: document.querySelector("#loadMembersButton"),
  exportButton: document.querySelector("#exportButton"),
  saveMembersButton: document.querySelector("#saveMembersButton"),
  discordLoginLink: document.querySelector("#discordLoginLink"),
  adminStatusText: document.querySelector("#adminStatusText"),
  searchInput: document.querySelector("#searchInput"),
  tableBody: document.querySelector("#memberTableBody"),
  statusText: document.querySelector("#statusText"),
  totalCount: document.querySelector("#totalCount"),
  rcCount: document.querySelector("#rcCount"),
  svCount: document.querySelector("#svCount"),
  jcCount: document.querySelector("#jcCount"),
  adminCount: document.querySelector("#adminCount"),
};

function normalize(value) {
  return String(value ?? "").trim();
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
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((entry) => normalize(entry) !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((entry) => normalize(entry) !== "")) {
    rows.push(row);
  }

  return rows;
}

function parseStudentId(studentId) {
  const normalized = normalize(studentId).toUpperCase();
  const isValid = /^[0-9A-Z]{8}$/.test(normalized);

  if (!isValid) {
    return {
      normalized,
      faculty: "不明",
      department: "不明",
      grade: "不明",
      admissionYear: "",
      error: "学籍番号は8桁の英数字で入力してください。",
    };
  }

  const facultyCode = normalized[0];
  const yearCode = Number(normalized.slice(1, 3));
  const departmentCode = normalized[4];
  const admissionYear = 2000 + yearCode;
  const grade = Math.max(1, CURRENT_YEAR - admissionYear + 1);
  const faculty = FACULTY_MAP.get(facultyCode) ?? "不明";
  const department = DEPARTMENT_MAP[facultyCode]?.get(departmentCode) ?? "不明";

  return {
    normalized,
    faculty,
    department,
    grade: `${grade}年`,
    admissionYear,
    error: faculty === "不明" || department === "不明" ? "学部または学科の判定に失敗しました。" : "",
  };
}

function normalizeCommitteeType(value, position) {
  const raw = normalize(value).toUpperCase();
  if (raw === "RC" || raw === "SV" || raw === "JC") {
    return raw;
  }

  const role = normalize(position);
  if (role === ROLE_NAMES.director || role === ROLE_NAMES.manager || role.includes("課長")) {
    return "RC";
  }

  return "JC";
}

function normalizeAuthStatus(value) {
  const raw = normalize(value);
  if (["認証済", "認証済み", "verified", "VERIFIED"].includes(raw)) {
    return "認証済";
  }
  return "未認証";
}

function getMeetingSummary(member) {
  const meetings = ["新歓", "第1回", "第2回", "第3回", "第4回", "第5回"];
  const attended = meetings.filter((meeting) => member.meetings[meeting] === "出席").length;
  return `${attended}/6`;
}

function buildDiscordRoles(member) {
  if (member.authStatus !== "認証済") {
    return [ROLE_NAMES.sGateUnverified];
  }

  const roles = [ROLE_NAMES.sGateVerified, member.committeeType];

  if (member.position.includes(ROLE_NAMES.director)) {
    roles.push(ROLE_NAMES.sGateAdmin);
  }

  for (const teamRole of normalizeTeamRoles(member.team)) {
    if (teamRole) {
      roles.push(teamRole);
    }
  }

  return [...new Set(roles)];
}

function normalizeTeamRoles(team) {
  return normalize(team)
    .split(/[・、,／/]+/)
    .map((part) => TEAM_ROLE_MAP.get(normalize(part)))
    .filter(Boolean);
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

  const enriched = records.map((record) => {
    const parsedId = parseStudentId(record["学籍番号"]);
    const position = normalize(record["役職"]);
    const committeeType = normalizeCommitteeType(record["区分"], position);
    const team = normalize(record["配属先"]);
    const authStatus = normalizeAuthStatus(record["認証状態"]);
    const member = {
      memberNo: "",
      name: normalize(record["氏名"]),
      kana: normalize(record["フリガナ"]),
      lineName: normalize(record["LINEの名前"]),
      studentId: parsedId.normalized,
      email: normalize(record["大学メール"]).toLowerCase(),
      committeeType,
      position,
      team,
      authStatus,
      grade: parsedId.grade,
      faculty: parsedId.faculty,
      department: parsedId.department,
      parseError: parsedId.error,
      meetings: {
        "新歓": normalize(record["新歓"]),
        "第1回": normalize(record["第1回"]),
        "第2回": normalize(record["第2回"]),
        "第3回": normalize(record["第3回"]),
        "第4回": normalize(record["第4回"]),
        "第5回": normalize(record["第5回"]),
      },
      discordRoles: [],
    };
    member.discordRoles = buildDiscordRoles(member);
    return member;
  });

  return assignMemberNumbers(enriched);
}

function makeMembersFromDatabaseRows(rows) {
  return rows.map((row) => {
    const member = {
      memberNo: normalize(row.member_no),
      name: normalize(row.name),
      kana: normalize(row.kana),
      lineName: normalize(row.line_name),
      studentId: normalize(row.student_id),
      email: normalize(row.email).toLowerCase(),
      committeeType: normalizeCommitteeType(row.committee_type, row.position),
      position: normalize(row.position),
      team: normalize(row.team),
      authStatus: row.verified_at ? "認証済" : "未認証",
      grade: normalize(row.grade),
      faculty: normalize(row.faculty),
      department: normalize(row.department),
      parseError: "",
      meetings: {
        "新歓": normalize(row.meeting_welcome),
        "第1回": normalize(row.meeting_1),
        "第2回": normalize(row.meeting_2),
        "第3回": normalize(row.meeting_3),
        "第4回": normalize(row.meeting_4),
        "第5回": normalize(row.meeting_5),
      },
      discordRoles: [],
    };
    member.discordRoles = buildDiscordRoles(member);
    return member;
  });
}

function assignMemberNumbers(sourceMembers) {
  const sorted = [...sourceMembers].sort((a, b) => a.studentId.localeCompare(b.studentId, "en"));
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

function updateStats(displayMembers) {
  elements.totalCount.textContent = String(members.length);
  elements.rcCount.textContent = String(members.filter((member) => member.committeeType === "RC").length);
  elements.svCount.textContent = String(members.filter((member) => member.committeeType === "SV").length);
  elements.jcCount.textContent = String(members.filter((member) => member.committeeType === "JC").length);
  elements.adminCount.textContent = String(members.filter((member) => member.discordRoles.includes(ROLE_NAMES.sGateAdmin)).length);
  elements.statusText.textContent = members.length
    ? `${displayMembers.length}件を表示中 / ${members.length}件登録済み`
    : "CSVを読み込んでください。";
}

function render() {
  const query = normalize(elements.searchInput.value).toLowerCase();
  const displayMembers = members.filter((member) => {
    const haystack = [
      member.memberNo,
      member.committeeType,
      member.name,
      member.kana,
      member.studentId,
      member.email,
      member.faculty,
      member.department,
      member.position,
      member.team,
      member.discordRoles.join(" "),
      member.authStatus,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  updateStats(displayMembers);

  if (!displayMembers.length) {
    elements.tableBody.innerHTML = `<tr class="empty-row"><td colspan="13">表示できる部員がいません。</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = displayMembers.map((member) => `
    <tr>
      <td><strong>${escapeHtml(member.memberNo)}</strong></td>
      <td><span class="badge ${member.committeeType.toLowerCase()}">${escapeHtml(member.committeeType)}</span></td>
      <td>${escapeHtml(member.name)}${member.parseError ? `<br><small>${escapeHtml(member.parseError)}</small>` : ""}</td>
      <td>${escapeHtml(member.studentId)}</td>
      <td>${escapeHtml(member.email || "-")}</td>
      <td>${escapeHtml(member.grade)}</td>
      <td>${escapeHtml(member.faculty)}</td>
      <td>${escapeHtml(member.department)}</td>
      <td>${escapeHtml(member.position || "-")}</td>
      <td>${escapeHtml(member.team || "-")}</td>
      <td><span class="badge ${member.authStatus === "認証済" ? "verified" : ""}">${escapeHtml(member.authStatus)}</span></td>
      <td><div class="badge-list">${member.discordRoles.map(roleToBadge).join("")}</div></td>
      <td>${escapeHtml(getMeetingSummary(member))}</td>
    </tr>
  `).join("");
}

function roleToBadge(role) {
  const className = role === ROLE_NAMES.sGateAdmin ? "admin" : role === ROLE_NAMES.sGateVerified ? "verified" : "";
  return `<span class="badge ${className}">${escapeHtml(role)}</span>`;
}

function escapeHtml(value) {
  return normalize(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function exportCsv() {
  const headers = ["部員No.", "区分", "氏名", "フリガナ", "LINEの名前", "学籍番号", "大学メール", "学年", "学部", "学科", "役職", "配属先", "認証状態", "S-GATEロール", "新歓", "第1回", "第2回", "第3回", "第4回", "第5回"];
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
    member.meetings["新歓"],
    member.meetings["第1回"],
    member.meetings["第2回"],
    member.meetings["第3回"],
    member.meetings["第4回"],
    member.meetings["第5回"],
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${normalize(cell).replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
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
    alert("config.js に sGateBaseUrl を設定してください。");
    return;
  }
  if (!members.length) {
    alert("保存する部員データがありません。");
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
    if (!response.ok) {
      throw new Error(data.message || data.error || "保存に失敗しました。");
    }
    elements.statusText.textContent = `${data.imported}件をD1へ保存しました。`;
  } catch (error) {
    elements.statusText.textContent = `DB保存エラー: ${error.message}`;
  } finally {
    elements.saveMembersButton.disabled = !sGateBaseUrl;
    elements.saveMembersButton.textContent = "DB保存";
  }
}

async function loadMembersFromDatabase() {
  if (!sGateBaseUrl) {
    alert("config.js に sGateBaseUrl を設定してください。");
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
    if (!response.ok) {
      throw new Error(data.message || data.error || "読み込みに失敗しました。");
    }
    members = makeMembersFromDatabaseRows(data.members ?? []);
    render();
    elements.statusText.textContent = `${members.length}件をD1から読み込みました。`;
  } catch (error) {
    elements.statusText.textContent = `DB読込エラー: ${error.message}`;
  } finally {
    elements.loadMembersButton.disabled = !sGateBaseUrl;
    elements.loadMembersButton.textContent = "DB読込";
  }
}

async function refreshAdminStatus() {
  if (!sGateBaseUrl) {
    elements.adminStatusText.textContent = "config.js に sGateBaseUrl を設定すると、S-GATE管理者状態を確認できます。";
    return;
  }

  try {
    const response = await fetch(`${sGateBaseUrl.replace(/\/$/, "")}/api/admin/me`, {
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "admin_status_failed");
    }
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

elements.csvFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  members = makeMembersFromCsv(text);
  render();
});

elements.loadSampleButton.addEventListener("click", () => {
  members = makeMembersFromCsv(sampleCsv);
  render();
});

elements.exportButton.addEventListener("click", exportCsv);
elements.saveMembersButton.addEventListener("click", saveMembersToDatabase);
elements.loadMembersButton.addEventListener("click", loadMembersFromDatabase);
elements.searchInput.addEventListener("input", render);

const sGateBaseUrl = window.JAMS_CONFIG?.sGateBaseUrl;
if (sGateBaseUrl) {
  elements.discordLoginLink.href = `${sGateBaseUrl.replace(/\/$/, "")}/sgate/login`;
  elements.discordLoginLink.removeAttribute("aria-disabled");
} else {
  elements.discordLoginLink.title = "config.js に sGateBaseUrl を設定してください。";
}

render();
refreshAdminStatus();
