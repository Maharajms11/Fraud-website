const form = document.getElementById("report-form");
const messageEl = document.getElementById("form-message");
const tableEl = document.getElementById("report-table");
const lastUpdatedEl = document.getElementById("last-updated");

const statReports = document.getElementById("stat-reports");
const statLost = document.getElementById("stat-lost");
const statRecovered = document.getElementById("stat-recovered");
const statNet = document.getElementById("stat-net");

const bankBreakdownEl = document.getElementById("bank-breakdown");
const typeBreakdownEl = document.getElementById("type-breakdown");

const downloadBtn = document.getElementById("download-btn");

const currency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 2,
});

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#b91c1c" : "#0f766e";
}

function makeCell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function renderStats(stats) {
  statReports.textContent = String(stats.totalReports || 0);
  statLost.textContent = currency.format(stats.totalLost || 0);
  statRecovered.textContent = currency.format(stats.totalRecovered || 0);
  statNet.textContent = currency.format(stats.netHarm || 0);
}

function renderTable(reports) {
  tableEl.innerHTML = "";

  if (!reports.length) {
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No reports yet. Add the first one above.";
    row.appendChild(td);
    tableEl.appendChild(row);
    return;
  }

  for (const report of reports) {
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

function renderBankBreakdown(bankBreakdown) {
  bankBreakdownEl.innerHTML = "";

  if (!bankBreakdown.length) {
    bankBreakdownEl.textContent = "No bank data yet.";
    return;
  }

  const max = bankBreakdown[0].netHarm || 1;

  for (const entry of bankBreakdown) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const name = document.createElement("span");
    name.textContent = entry.bank;

    const track = document.createElement("div");
    track.className = "bar-track";

    const bar = document.createElement("div");
    bar.className = "bar-value";
    bar.style.width = `${Math.max((entry.netHarm / max) * 100, 2)}%`;

    const value = document.createElement("span");
    value.textContent = currency.format(entry.netHarm);

    track.appendChild(bar);
    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(value);
    bankBreakdownEl.appendChild(row);
  }
}

function renderTypeBreakdown(typeBreakdown) {
  typeBreakdownEl.innerHTML = "";

  if (!typeBreakdown.length) {
    const li = document.createElement("li");
    li.textContent = "No type data yet.";
    typeBreakdownEl.appendChild(li);
    return;
  }

  for (const entry of typeBreakdown.slice(0, 6)) {
    const li = document.createElement("li");
    li.textContent = `${entry.fraudType} (${entry.count})`;
    typeBreakdownEl.appendChild(li);
  }
}

async function loadDashboard() {
  try {
    const response = await fetch("/api/dashboard", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch dashboard.");
    }

    const data = await response.json();

    renderStats(data.stats || {});
    renderTable(Array.isArray(data.reports) ? data.reports : []);
    renderBankBreakdown(Array.isArray(data.bankBreakdown) ? data.bankBreakdown : []);
    renderTypeBreakdown(Array.isArray(data.typeBreakdown) ? data.typeBreakdown : []);

    if (data.generatedAt) {
      const timestamp = new Date(data.generatedAt);
      lastUpdatedEl.textContent = `Last updated: ${timestamp.toLocaleString()}`;
      lastUpdatedEl.style.color = "#334155";
    }
  } catch (error) {
    lastUpdatedEl.textContent = "Could not load public data right now.";
    lastUpdatedEl.style.color = "#b91c1c";
  }
}

function formDataToPayload(formData) {
  return {
    incidentDate: String(formData.get("incidentDate") || ""),
    bank: String(formData.get("bank") || ""),
    fraudType: String(formData.get("fraudType") || ""),
    province: String(formData.get("province") || ""),
    amountLost: Number.parseFloat(String(formData.get("amountLost") || "0")),
    amountRecovered: Number.parseFloat(String(formData.get("amountRecovered") || "0")) || 0,
    reportedToBank: String(formData.get("reportedToBank") || ""),
    reportedToSaps: String(formData.get("reportedToSaps") || ""),
    narrative: String(formData.get("narrative") || ""),
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    setMessage("Please complete all required fields.", true);
    return;
  }

  const payload = formDataToPayload(new FormData(form));

  if (payload.amountRecovered > payload.amountLost) {
    setMessage("Recovered amount cannot exceed amount lost.", true);
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Submission failed.");
    }

    form.reset();
    setMessage("Report published to the public dashboard.");
    await loadDashboard();
  } catch (error) {
    setMessage(error.message || "Submission failed.", true);
  } finally {
    submitBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  window.location.assign("/api/reports.csv");
});

loadDashboard();
