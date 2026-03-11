const http = require("http");
const path = require("path");
const { createHmac, randomUUID } = require("crypto");
const { promises: fs } = require("fs");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const ROOT_DIR = __dirname;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT_DIR, "data", "reports.json");
const DATA_DIR = path.dirname(DATA_FILE);
const AUDIT_TOKEN = process.env.AUDIT_TOKEN || "";
const IP_HASH_SECRET = process.env.IP_HASH_SECRET || process.env.AUDIT_TOKEN || "";
const MAX_BODY_BYTES = 20 * 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_POSTS = 25;

const postHistoryByIp = new Map();
let writeQueue = Promise.resolve();

const banks = new Set([
  "ABSA",
  "Capitec",
  "FNB",
  "Nedbank",
  "Standard Bank",
  "TymeBank",
  "Discovery Bank",
  "Investec",
  "African Bank",
  "Other",
]);

const fraudTypes = new Set([
  "Phishing",
  "Vishing",
  "SIM swap",
  "Card cloning",
  "ATM scam",
  "App takeover",
  "Online banking compromise",
  "Investment scam",
  "Unauthorized debit order",
  "Other",
]);

const provinces = new Set([
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
]);

const statusValues = new Set(["Yes", "No", "Unknown"]);

const staticFiles = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "application/javascript; charset=utf-8" }],
]);

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
  );
}

function sendJson(res, statusCode, body) {
  setSecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  setSecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function sanitizeText(value, maxLength = 600) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeCaseRef(value, maxLength = 80) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isValidCaseRef(value) {
  return /^[A-Za-z0-9][A-Za-z0-9/.\-\s]*$/.test(value);
}

function normalizeStatus(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "Unknown";
  }
  return trimmed;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/[^\d+\s()-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
}

function isValidEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function isValidPhone(value) {
  return /^[+]?[\d\s()-]{7,30}$/.test(value);
}

function hashIp(ipAddress) {
  if (!IP_HASH_SECRET || !ipAddress) {
    return "";
  }

  return createHmac("sha256", IP_HASH_SECRET).update(ipAddress).digest("hex");
}

function parseAmount(value) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

function hasLikelySensitiveData(text) {
  const containsLongDigitRuns = /\b\d{8,}\b/.test(text);
  const containsEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  return containsLongDigitRuns || containsEmail;
}

function validateReport(payload, auditContext = {}) {
  if (!payload || typeof payload !== "object") {
    return { error: "Invalid payload." };
  }

  const incidentDate = String(payload.incidentDate || "").trim();
  const bank = String(payload.bank || "").trim();
  const fraudType = String(payload.fraudType || "").trim();
  const province = String(payload.province || "").trim();
  const reportedToBank = normalizeStatus(payload.reportedToBank);
  const reportedToSaps = normalizeStatus(payload.reportedToSaps);
  const hasServedInCourt = normalizeStatus(payload.hasServedInCourt);
  const sapsCaseNumberInput = sanitizeCaseRef(payload.sapsCaseNumber, 80);
  const courtCaseNumberInput = sanitizeCaseRef(payload.courtCaseNumber, 80);
  const reporterName = sanitizeText(payload.reporterName, 120);
  const reporterEmail = normalizeEmail(payload.reporterEmail);
  const reporterPhone = normalizePhone(payload.reporterPhone);
  const consentPopia = Boolean(payload.consentPopia);
  const narrative = sanitizeText(payload.narrative, 600);
  const ipHash = String(auditContext.ipHash || "");
  const submittedUserAgent = sanitizeText(auditContext.userAgent, 300);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)) {
    return { error: "Incident date is required." };
  }

  const parsedDate = new Date(`${incidentDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: "Incident date is invalid." };
  }

  if (!banks.has(bank)) {
    return { error: "Bank value is invalid." };
  }

  if (!fraudTypes.has(fraudType)) {
    return { error: "Fraud type value is invalid." };
  }

  if (!provinces.has(province)) {
    return { error: "Province value is invalid." };
  }

  if (
    !statusValues.has(reportedToBank) ||
    !statusValues.has(reportedToSaps) ||
    !statusValues.has(hasServedInCourt)
  ) {
    return { error: "Reporting status must be Yes, No, or left blank." };
  }

  if (sapsCaseNumberInput && !isValidCaseRef(sapsCaseNumberInput)) {
    return { error: "SAPS case number has invalid characters." };
  }

  if (courtCaseNumberInput && !isValidCaseRef(courtCaseNumberInput)) {
    return { error: "Court case number has invalid characters." };
  }

  if (narrative.length < 10) {
    return { error: "Summary is too short." };
  }

  if (reporterName.length < 2) {
    return { error: "Private full name is required for audit purposes." };
  }

  if (!reporterEmail && !reporterPhone) {
    return { error: "Provide at least one private contact detail (email or mobile)." };
  }

  if (reporterEmail && !isValidEmail(reporterEmail)) {
    return { error: "Private email address is invalid." };
  }

  if (reporterPhone && !isValidPhone(reporterPhone)) {
    return { error: "Private mobile number is invalid." };
  }

  if (!consentPopia) {
    return { error: "POPIA consent is required." };
  }

  if (hasLikelySensitiveData(narrative)) {
    return {
      error: "Summary appears to include private data. Remove account numbers/emails and try again.",
    };
  }

  const amountLost = parseAmount(payload.amountLost);
  const amountRecovered = parseAmount(payload.amountRecovered ?? 0);

  if (amountLost === null || amountRecovered === null) {
    return { error: "Amounts must be valid positive numbers." };
  }

  if (amountRecovered > amountLost) {
    return { error: "Recovered amount cannot exceed amount lost." };
  }

  if (amountLost > 500000000 || amountRecovered > 500000000) {
    return { error: "Amounts exceed allowed limit." };
  }

  const sapsCaseNumber = reportedToSaps === "Yes" ? sapsCaseNumberInput : "";
  const courtCaseNumber = hasServedInCourt === "Yes" ? courtCaseNumberInput : "";

  return {
    value: {
      id: randomUUID(),
      incidentDate,
      bank,
      fraudType,
      province,
      amountLost,
      amountRecovered,
      reportedToBank,
      reportedToSaps,
      sapsCaseNumber,
      hasServedInCourt,
      courtCaseNumber,
      audit: {
        reporterName,
        reporterEmail,
        reporterPhone,
        consentPopiaAt: new Date().toISOString(),
        ipHash,
        submittedUserAgent,
      },
      narrative,
      createdAt: new Date().toISOString(),
    },
  };
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", "utf8");
  }
}

async function readReports() {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function queueWrite(taskFn) {
  const next = writeQueue.then(taskFn, taskFn);
  writeQueue = next.catch(() => {});
  return next;
}

async function appendReport(report) {
  return queueWrite(async () => {
    const reports = await readReports();
    reports.push(report);
    await fs.writeFile(DATA_FILE, JSON.stringify(reports, null, 2) + "\n", "utf8");
    return report;
  });
}

function toPublicReport(report) {
  return {
    id: report.id,
    incidentDate: report.incidentDate,
    bank: report.bank,
    fraudType: report.fraudType,
    province: report.province,
    amountLost: report.amountLost,
    amountRecovered: report.amountRecovered,
    reportedToBank: report.reportedToBank,
    reportedToSaps: report.reportedToSaps,
    sapsCaseNumber: report.sapsCaseNumber,
    hasServedInCourt: report.hasServedInCourt,
    courtCaseNumber: report.courtCaseNumber,
    narrative: report.narrative,
    createdAt: report.createdAt,
  };
}

function computeDashboard(reports) {
  const totals = reports.reduce(
    (acc, report) => {
      acc.totalLost += report.amountLost;
      acc.totalRecovered += report.amountRecovered;
      return acc;
    },
    { totalLost: 0, totalRecovered: 0 },
  );

  const byBank = new Map();
  const byType = new Map();

  for (const report of reports) {
    const net = report.amountLost - report.amountRecovered;
    byBank.set(report.bank, (byBank.get(report.bank) || 0) + net);
    byType.set(report.fraudType, (byType.get(report.fraudType) || 0) + 1);
  }

  const bankBreakdown = [...byBank.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bank, netHarm]) => ({ bank, netHarm: Number(netHarm.toFixed(2)) }));

  const typeBreakdown = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fraudType, count]) => ({ fraudType, count }));

  const recentReports = [...reports]
    .sort((a, b) => new Date(b.incidentDate) - new Date(a.incidentDate))
    .slice(0, 200)
    .map(toPublicReport);

  const netHarm = totals.totalLost - totals.totalRecovered;

  return {
    stats: {
      totalReports: reports.length,
      totalLost: Number(totals.totalLost.toFixed(2)),
      totalRecovered: Number(totals.totalRecovered.toFixed(2)),
      netHarm: Number(netHarm.toFixed(2)),
    },
    bankBreakdown,
    typeBreakdown,
    reports: recentReports,
    generatedAt: new Date().toISOString(),
  };
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function isPostRateLimited(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const previous = postHistoryByIp.get(ip) || [];
  const recent = previous.filter((ts) => ts >= cutoff);

  if (recent.length >= RATE_LIMIT_MAX_POSTS) {
    postHistoryByIp.set(ip, recent);
    return true;
  }

  recent.push(now);
  postHistoryByIp.set(ip, recent);
  return false;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    let body = "";
    let tooLarge = false;
    let settled = false;

    function fail(error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }

    req.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (tooLarge) {
        fail(new Error("Payload too large."));
        return;
      }

      try {
        if (!settled) {
          settled = true;
          resolve(body ? JSON.parse(body) : {});
        }
      } catch {
        fail(new Error("Invalid JSON body."));
      }
    });

    req.on("error", () => {
      fail(new Error("Unable to read request body."));
    });
  });
}

function toCsv(reports) {
  const headers = [
    "incidentDate",
    "bank",
    "fraudType",
    "province",
    "amountLost",
    "amountRecovered",
    "reportedToBank",
    "reportedToSaps",
    "sapsCaseNumber",
    "hasServedInCourt",
    "courtCaseNumber",
    "narrative",
    "createdAt",
  ];

  const rows = reports.map((report) =>
    headers
      .map((key) => `"${String(report[key] ?? "").replaceAll('"', '""')}"`)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function toAuditCsv(reports) {
  const headers = [
    "incidentDate",
    "bank",
    "fraudType",
    "province",
    "amountLost",
    "amountRecovered",
    "reportedToBank",
    "reportedToSaps",
    "sapsCaseNumber",
    "hasServedInCourt",
    "courtCaseNumber",
    "narrative",
    "createdAt",
    "reporterName",
    "reporterEmail",
    "reporterPhone",
    "consentPopiaAt",
    "ipHash",
    "submittedUserAgent",
  ];

  const rows = reports.map((report) => {
    const audit = report.audit || {};
    const values = {
      ...report,
      reporterName: audit.reporterName || "",
      reporterEmail: audit.reporterEmail || "",
      reporterPhone: audit.reporterPhone || "",
      consentPopiaAt: audit.consentPopiaAt || "",
      ipHash: audit.ipHash || "",
      submittedUserAgent: audit.submittedUserAgent || "",
    };

    return headers
      .map((key) => `"${String(values[key] ?? "").replaceAll('"', '""')}"`)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

function authorizeAuditRequest(req, requestUrl) {
  if (!AUDIT_TOKEN) {
    return {
      ok: false,
      status: 503,
      error: "Audit endpoint is disabled. Set AUDIT_TOKEN on the server.",
    };
  }

  const tokenFromHeader = req.headers["x-audit-token"];
  const tokenFromQuery = requestUrl.searchParams.get("token");
  const providedToken = String(tokenFromHeader || tokenFromQuery || "");

  if (!providedToken || providedToken !== AUDIT_TOKEN) {
    return { ok: false, status: 401, error: "Unauthorized audit access." };
  }

  return { ok: true };
}

async function serveStatic(reqPath, res) {
  const staticAsset = staticFiles.get(reqPath);
  if (!staticAsset) {
    sendText(res, 404, "Not Found");
    return;
  }

  const filePath = path.join(ROOT_DIR, staticAsset.file);
  try {
    const content = await fs.readFile(filePath);
    setSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", staticAsset.type);
    res.end(content);
  } catch {
    sendText(res, 500, "Failed to load static file.");
  }
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const reqPath = requestUrl.pathname;

  if (req.method === "GET" && reqPath === "/health") {
    sendJson(res, 200, { ok: true, service: "fraud-watch-sa" });
    return;
  }

  if (req.method === "GET" && reqPath === "/api/dashboard") {
    const reports = await readReports();
    sendJson(res, 200, computeDashboard(reports));
    return;
  }

  if (req.method === "GET" && reqPath === "/api/audit/reports") {
    const auth = authorizeAuditRequest(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error });
      return;
    }

    const reports = await readReports();
    sendJson(res, 200, { reports, total: reports.length });
    return;
  }

  if (req.method === "GET" && reqPath === "/api/audit/reports.csv") {
    const auth = authorizeAuditRequest(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error });
      return;
    }

    const reports = await readReports();
    const csv = toAuditCsv(reports);

    setSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="fraud-watch-sa-audit-reports.csv"');
    res.end(csv);
    return;
  }

  if (req.method === "GET" && reqPath === "/api/reports.csv") {
    const reports = await readReports();
    const csv = toCsv(reports);

    setSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="fraud-watch-sa-reports.csv"');
    res.end(csv);
    return;
  }

  if (req.method === "POST" && reqPath === "/api/reports") {
    const clientIp = getClientIp(req);
    if (isPostRateLimited(clientIp)) {
      sendJson(res, 429, {
        error: "Too many submissions from this address. Please try again later.",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      const isTooLarge = String(error.message).includes("too large");
      sendJson(res, isTooLarge ? 413 : 400, { error: error.message });
      return;
    }

    const validation = validateReport(payload, {
      ipHash: hashIp(clientIp),
      userAgent: req.headers["user-agent"],
    });
    if (validation.error) {
      sendJson(res, 400, { error: validation.error });
      return;
    }

    const saved = await appendReport(validation.value);
    sendJson(res, 201, { report: saved });
    return;
  }

  if (req.method === "GET") {
    await serveStatic(reqPath, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("Unhandled server error:", error);
    sendJson(res, 500, { error: "Internal server error." });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Fraud Watch SA running on http://${HOST}:${PORT}`);
});
