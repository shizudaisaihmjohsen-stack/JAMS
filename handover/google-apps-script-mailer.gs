const SCRIPT_SECRET =
  PropertiesService.getScriptProperties().getProperty("GOOGLE_APPS_SCRIPT_MAIL_SECRET") ||
  PropertiesService.getScriptProperties().getProperty("S_GATE_MAIL_SECRET");
const ALLOWED_EMAIL_DOMAINS = String(
  PropertiesService.getScriptProperties().getProperty("S_GATE_ALLOWED_EMAIL_DOMAINS") ||
  "shizuoka.ac.jp",
)
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    assertAuthorized(payload);

    const to = String(payload.to || "").trim();
    const subject = String(payload.subject || "").trim();
    const text = String(payload.text || "");
    const html = String(payload.html || "");
    const from = normalizeFrom(payload.from);

    if (
      !isValidEmail(to) ||
      !isAllowedDomain(to) ||
      hasHeaderBreak(subject) ||
      hasHeaderBreak(from.name) ||
      hasHeaderBreak(from.email) ||
      !subject ||
      !text
    ) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    MailApp.sendEmail({
      to,
      subject,
      body: text,
      htmlBody: html || undefined,
      name: from.name || "S-GATE",
      replyTo: from.email || undefined,
    });

    return json({
      ok: true,
      remainingDailyQuota: MailApp.getRemainingDailyQuota(),
    });
  } catch (error) {
    console.error(error);
    return json({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

function assertAuthorized(payload) {
  if (!SCRIPT_SECRET) {
    throw new Error("script_secret_not_configured");
  }

  if (!payload || payload.secret !== SCRIPT_SECRET) {
    throw new Error("unauthorized");
  }
}

function normalizeFrom(value) {
  if (value && typeof value === "object") {
    return {
      name: String(value.name || "").trim(),
      email: String(value.email || "").trim(),
    };
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: String(match[1] || "").trim(),
      email: String(match[2] || "").trim(),
    };
  }
  return { name: "", email: raw };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isAllowedDomain(value) {
  const domain = String(value || "").trim().toLowerCase().split("@").pop();
  return ALLOWED_EMAIL_DOMAINS.length > 0 && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

function hasHeaderBreak(value) {
  return /[\r\n]/.test(String(value || ""));
}

function json(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
