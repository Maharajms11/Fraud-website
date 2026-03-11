const STORAGE_KEY = "fraudWatchReportsV1";

const form = document.getElementById("report-form");
const messageEl = document.getElementById("form-message");
const tableEl = document.getElementById("report-table");

const statReports = document.getElementById("stat-reports");
const statLost = document.getElementById("stat-lost");
const statRecovered = document.getElementById("stat-recovered");
const statNet = document.getElementById("stat-net");

const bankBreakdownEl = document.getElementById("bank-breakdown");
const typeBreakdownEl = document.getElementById("type-breakdown");

const downloadBtn = document.getElementById("download-btn");
const clearBtn = document.getElementById("clear-btn");

const currency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 2,
});

function readReports() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReports(reports) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

function sumBy(reports, selector) {
  return reports.reduce((total, item) => total + selector(item), 0);
}

function groupCounts(items, keySelector) {
  const counts = new Map();
  for (const item of items) {
    const key = keySelector(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function groupNetByBank(reports) {
  const grouped = new Map();
  for (const report of reports) {
    const net = report.amountLost - report.amountRecovered;
    grouped.set(report.bank, (grouped.get(report.bank) || 0) + net);
  }

  return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
}

function makeCell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function renderStats(reports) {
  const totalLost = sumBy(reports, (r) => r.amountLost);
  const totalRecovered = sumBy(reports, (r) => r.amountRecovered);
  const net = totalLost - totalRecovered;

  statReports.textContent = String(reports.length);
  statLost.textContent = currency.format(totalLost);
  statRecovered.textContent = currency.format(totalRecovered);
  statNet.textContent = currency.format(net);
}

function renderTable(reports) {
  tableEl.innerHTML = "";

  const sorted = [...reports].sort(
    (a, b) => new Date(b.incidentDate) - new Date(a.incidentDate),
  );

  if (!sorted.length) {
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No reports yet. Add the first one above.";
    row.appendChild(td);
    tableEl.appendChild(row);
    return;
  }

  for (const report of sorted) {
    const row = document.createElement("tr");
    const net = report.amountLost - report.amountRecovered;

    row.appendChild(makeCell(report.incidentDate));
    row.appendChild(makeCell(report.bank));
    row.appendChild(makeCell(report.fraudType));
    row.appendChild(makeCell(report.province));
    row.appendChild(makeCell(currency.format(net)));
    row.appendChild(makeCell(report.narrative));

    tableEl.appendChild(row);
  }
}

function renderBankBreakdown(reports) {
  bankBreakdownEl.innerHTML = "";
  const grouped = groupNetByBank(reports);

  if (!grouped.length) {
    bankBreakdownEl.textContent = "No bank data yet.";
    return;
  }

  const max = grouped[0][1] || 1;

  for (const [bank, net] of grouped) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const name = document.createElement("span");
    name.textContent = bank;

    const track = document.createElement("div");
    track.className = "bar-track";

    const bar = document.createElement("div");
    bar.className = "bar-value";
    bar.style.width = `${Math.max((net / max) * 100, 2)}%`;

    const value = document.createElement("span");
    value.textContent = currency.format(net);

    track.appendChild(bar);
    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(value);
    bankBreakdownEl.appendChild(row);
  }
}

function renderTypeBreakdown(reports) {
  typeBreakdownEl.innerHTML = "";

  const grouped = groupCounts(reports, (r) => r.fraudType).slice(0, 6);

  if (!grouped.length) {
    const li = document.createElement("li");
    li.textContent = "No type data yet.";
    typeBreakdownEl.appendChild(li);
    return;
  }

  for (const [type, count] of grouped) {
    const li = document.createElement("li");
    li.textContent = `${type} (${count})`;
    typeBreakdownEl.appendChild(li);
  }
}

function renderAll() {
  const reports = readReports();
  renderStats(reports);
  renderTable(reports);
  renderBankBreakdown(reports);
  renderTypeBreakdown(reports);
}

function formDataToReport(formData) {
  return {
    id: crypto.randomUUID(),
    incidentDate: formData.get("incidentDate"),
    bank: formData.get("bank"),
    fraudType: formData.get("fraudType"),
    province: formData.get("province"),
    amountLost: Number.parseFloat(formData.get("amountLost")) || 0,
    amountRecovered: Number.parseFloat(formData.get("amountRecovered")) || 0,
    reportedToBank: formData.get("reportedToBank"),
    reportedToSaps: formData.get("reportedToSaps"),
    narrative: (formData.get("narrative") || "").toString().trim(),
    createdAt: new Date().toISOString(),
  };
}

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#b91c1c" : "#0f766e";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    setMessage("Please complete all required fields.", true);
    return;
  }

  const report = formDataToReport(new FormData(form));

  if (report.amountRecovered > report.amountLost) {
    setMessage("Recovered amount cannot exceed amount lost.", true);
    return;
  }

  const reports = readReports();
  reports.push(report);
  writeReports(reports);

  form.reset();
  setMessage("Report saved locally and added to the exposure dashboard.");
  renderAll();
});

downloadBtn.addEventListener("click", () => {
  const reports = readReports();
  if (!reports.length) {
    setMessage("No data to export yet.", true);
    return;
  }

  const headers = [
    "incidentDate",
    "bank",
    "fraudType",
    "province",
    "amountLost",
    "amountRecovered",
    "reportedToBank",
    "reportedToSaps",
    "narrative",
    "createdAt",
  ];

  const rows = reports.map((report) =>
    headers
      .map((key) => {
        const value = report[key] ?? "";
        return `"${String(value).replaceAll('"', '""')}"`;
      })
      .join(","),
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "fraud-watch-sa-reports.csv";
  link.click();

  URL.revokeObjectURL(url);
  setMessage("CSV downloaded.");
});

clearBtn.addEventListener("click", () => {
  const shouldClear = window.confirm(
    "This clears all saved reports from this browser only. Continue?",
  );

  if (!shouldClear) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  setMessage("Local data cleared.");
  renderAll();
});

renderAll();
