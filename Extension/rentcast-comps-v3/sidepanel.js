// sidepanel.js — RentCast Comps v1.0

const $ = id => document.getElementById(id);

// ── USD Formatting ─────────────────────────────────────────────────────────────

function parseUSD(val) {
  return String(val).replace(/[^0-9.]/g, "");
}

function formatUSD(val) {
  const num = parseFloat(parseUSD(val));
  if (isNaN(num) || val === "") return "";
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

["price", "cost"].forEach(id => {
  // Show raw number while editing
  document.addEventListener("DOMContentLoaded", () => {}, false);
  // We wire these after DOM is ready via init at bottom
});

function wireUSDInputs() {
  ["price", "cost"].forEach(id => {
    const el = $(id);
    el.addEventListener("focus", () => {
      el.value = parseUSD(el.value);
    });
    el.addEventListener("blur", () => {
      el.value = formatUSD(el.value);
    });
  });
}

// ── Matrix ────────────────────────────────────────────────────────────────────

const TYPES = { 0:"Studio", 1:"Single", 2:"Duplex", 3:"Triplex", 4:"Fourplex", 5:"Fiveplex" };
const MAX_COMBOS = 5;
let selectedCombos = [];
let resolvedCoords = null;

function buildMatrix() {
  const tbody = $("comboBody");
  tbody.innerHTML = "";
  for (let beds = 0; beds <= 5; beds++) {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = `${TYPES[beds]} (${beds}bd)`;
    tr.appendChild(tdLabel);
    for (let baths = 1; baths <= 5; baths++) {
      const td = document.createElement("td");
      td.className = "cb-cell";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "combo-cb";
      cb.id = `cb_${beds}_${baths}`;
      cb.dataset.beds = beds; cb.dataset.baths = baths; cb.dataset.type = TYPES[beds];
      const lbl = document.createElement("label");
      lbl.htmlFor = cb.id; lbl.appendChild(cb);
      td.appendChild(lbl);
      td.addEventListener("click", e => { if (e.target !== cb) cb.click(); });
      cb.addEventListener("change", () => onComboChange(cb, td));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function onComboChange(cb, td) {
  const beds = parseInt(cb.dataset.beds);
  const baths = parseInt(cb.dataset.baths);
  const type = cb.dataset.type;
  if (cb.checked) {
    if (selectedCombos.length >= MAX_COMBOS) { cb.checked = false; return; }
    selectedCombos.push({ beds, baths, type });
    td.classList.add("sel");
  } else {
    selectedCombos = selectedCombos.filter(c => !(c.beds === beds && c.baths === baths));
    td.classList.remove("sel");
  }
  updateMatrixBadge();
  document.querySelectorAll(".combo-cb").forEach(c => {
    if (!c.checked) c.disabled = selectedCombos.length >= MAX_COMBOS;
  });
  if (selectedCombos.length > 0) hideErr("comboError");
}

function updateMatrixBadge() {
  const badge = $("matrixBadge");
  badge.textContent = `${selectedCombos.length} Selected`;
  badge.className = "matrix-badge" + (selectedCombos.length > 0 ? " active" : "");
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

let geoTimer = null;

$("address").addEventListener("input", () => {
  resolvedCoords = null;
  $("coordsPill").className = "coords-pill";
  clearTimeout(geoTimer);
  const val = $("address").value.trim();
  if (val.length < 6) return;
  geoTimer = setTimeout(() => geocodeAddress(val), 900);
});

async function geocodeAddress(address) {
  const url = await getSetting("modelUrl");
  if (!url) return;
  $("addrSpinner").className = "addr-spinner on";
  try {
    const params = new URLSearchParams({ action: "geocode", address });
    const res  = await fetch(`${url}?${params}`);
    const data = await res.json();
    if (data.lat && data.lng) {
      resolvedCoords = { lat: data.lat, lng: data.lng };
      $("coordsText").textContent = `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
      $("coordsPill").className = "coords-pill on";
    }
  } catch (_) {}
  finally { $("addrSpinner").className = "addr-spinner"; }
}

// ── Model Link ────────────────────────────────────────────────────────────────

function setConfiguredState(url) {
  $("modelUnconfigured").style.display = "none";
  $("modelConfigured").style.display   = "flex";
  $("modelUrlDisplay").textContent      = url;
  $("modelCard").classList.add("ok");
  $("modelStatus").className = "model-status ok";
  $("modelStatusText").textContent = "CONNECTED";
}

function setUnconfiguredState() {
  $("modelUnconfigured").style.display = "";
  $("modelConfigured").style.display   = "none";
  $("modelCard").classList.remove("ok");
  $("modelStatus").className = "model-status";
  $("modelStatusText").textContent = "NOT CONFIGURED";
}

$("configureBtn").addEventListener("click", () => {
  const url = $("modelUrl").value.trim();
  if (!url || !url.startsWith("https://")) {
    $("modelUrl").classList.add("err");
    return;
  }
  $("modelUrl").classList.remove("err");
  chrome.storage.sync.set({ modelUrl: url });
  setConfiguredState(url);
});

$("editUrlBtn").addEventListener("click", () => {
  chrome.storage.sync.remove("modelUrl");
  $("modelUrl").value = "";
  setUnconfiguredState();
});

// ── Settings ──────────────────────────────────────────────────────────────────

function getSetting(key) {
  return new Promise(r => chrome.storage.sync.get([key], s => r(s[key] || null)));
}

async function loadSettings() {
  chrome.storage.sync.get(
    ["modelUrl","email","address","totalUnits","price","cost","sqft","radius","minComps","maxComps","status","combos"],
    cfg => {
      if (cfg.modelUrl) { $("modelUrl").value = cfg.modelUrl; setConfiguredState(cfg.modelUrl); }
      if (cfg.email)    $("email").value    = cfg.email;
      if (cfg.address)  $("address").value  = cfg.address;
      if (cfg.totalUnits) $("totalUnits").value = cfg.totalUnits;
      if (cfg.price)    $("price").value    = formatUSD(cfg.price);
      if (cfg.cost)     $("cost").value     = formatUSD(cfg.cost);
      if (cfg.sqft)     $("sqft").value     = cfg.sqft;
      if (cfg.radius)   $("radius").value   = cfg.radius;
      if (cfg.minComps) $("minComps").value = cfg.minComps;
      if (cfg.maxComps) $("maxComps").value = cfg.maxComps;
      if (cfg.status)   $("status").value   = cfg.status;
      if (cfg.combos?.length) {
        selectedCombos = cfg.combos;
        cfg.combos.forEach(({ beds, baths }) => {
          const cb = $(`cb_${beds}_${baths}`);
          if (!cb) return;
          cb.checked = true;
          cb.closest(".cb-cell")?.classList.add("sel");
        });
        updateMatrixBadge();
        document.querySelectorAll(".combo-cb").forEach(c => {
          if (!c.checked) c.disabled = selectedCombos.length >= MAX_COMBOS;
        });
      }
    }
  );
}

function getFormVals() {
  return {
    modelUrl:   $("modelUrl").value.trim(),
    email:      $("email").value.trim(),
    address:    $("address").value.trim(),
    totalUnits: $("totalUnits").value.trim(),
    price:      parseUSD($("price").value),
    cost:       parseUSD($("cost").value),
    sqft:       $("sqft").value.trim(),
    radius:     $("radius").value.trim(),
    minComps:   $("minComps").value.trim(),
    maxComps:   $("maxComps").value.trim(),
    status:     $("status").value,
  };
}

$("saveBtn").addEventListener("click", () => {
  const vals = getFormVals();
  chrome.storage.sync.set({ ...vals, combos: selectedCombos }, () => {
    $("saveBtn").textContent = "Saved ✓";
    setTimeout(() => $("saveBtn").textContent = "Save", 1500);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

function showErr(id) { $(id).classList.add("on"); }
function hideErr(id) { $(id).classList.remove("on"); }

// Live min/max warning
["minComps","maxComps"].forEach(id => {
  $(id).addEventListener("input", () => {
    const mn = parseInt($("minComps").value);
    const mx = parseInt($("maxComps").value);
    $("compsWarn").className = "warn-banner" + (mn > mx && mx ? " on" : "");
  });
});

function validate(vals) {
  let ok = true;
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!vals.email || !emailRe.test(vals.email)) { showErr("emailError"); $("email").classList.add("err"); ok = false; }
  else { hideErr("emailError"); $("email").classList.remove("err"); }

  if (!vals.address) { showErr("addressError"); $("address").classList.add("err"); ok = false; }
  else { hideErr("addressError"); $("address").classList.remove("err"); }

  if (!vals.totalUnits || parseInt(vals.totalUnits) < 1) { showErr("totalUnitsError"); $("totalUnits").classList.add("err"); ok = false; }
  else { hideErr("totalUnitsError"); $("totalUnits").classList.remove("err"); }

  const mn = parseInt(vals.minComps), mx = parseInt(vals.maxComps);
  if (!vals.radius || !vals.minComps || !vals.maxComps) { showErr("paramsError"); ok = false; }
  else if (mn > mx) { showErr("paramsError"); ok = false; }
  else { hideErr("paramsError"); }

  if (selectedCombos.length === 0) { showErr("comboError"); ok = false; }
  else { hideErr("comboError"); }

  return ok;
}

// ── Run ───────────────────────────────────────────────────────────────────────

$("runBtn").addEventListener("click", async () => {
  const vals = getFormVals();

  if (!vals.modelUrl) {
    $("formError").textContent = "Please configure your Apps Script URL first.";
    $("formError").className = "form-error on";
    return;
  }
  $("formError").className = "form-error";
  if (!validate(vals)) return;

  $("runBtn").disabled = true;
  $("runBtn").innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Running…`;

  chrome.storage.sync.set({ ...vals, combos: selectedCombos });

  try {
    const params = new URLSearchParams({
      action:     "search",
      userEmail:  vals.email,
      address:    vals.address,
      totalUnits: vals.totalUnits,
      price:      vals.price,
      cost:       vals.cost,
      sqft:       vals.sqft,
      radius:     vals.radius,
      minComps:   vals.minComps,
      maxComps:   vals.maxComps,
      status:     vals.status,
      combos:     JSON.stringify(selectedCombos),
      ...(resolvedCoords ? { lat: resolvedCoords.lat, lng: resolvedCoords.lng } : {}),
    });

    const res  = await fetch(`${vals.modelUrl}?${params}`);
    const data = await res.json();

    const entry = {
      searchId:  data.searchId || "—",
      email:     vals.email,
      address:   vals.address,
      combos:    selectedCombos,
      timestamp: new Date().toISOString(),
      success:   !!data.success,
      message:   data.message || data.error || "",
    };
    addToHistory(entry);
    showResults(entry, vals);

  } catch (err) {
    const entry = {
      searchId: "ERROR", email: vals.email, address: vals.address,
      combos: selectedCombos, timestamp: new Date().toISOString(),
      success: false, message: err.message,
    };
    addToHistory(entry);
    showResults(entry, vals);
  } finally {
    $("runBtn").disabled = false;
    $("runBtn").innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Execute Comps Search`;
  }
});

// ── Results ───────────────────────────────────────────────────────────────────

function showResults(entry, vals) {
  const hero = $("resultHero");
  hero.className = `result-hero ${entry.success ? "ok" : "err"}`;
  $("resultStatus").textContent = entry.success ? "✓ Submitted" : "✕ Failed";
  $("resultId").textContent     = entry.searchId;
  $("resultMeta").textContent   = entry.message;
  $("resultsBadge").className   = "results-badge" + (entry.success ? "" : " error");
  $("resultsBadge").textContent = entry.success ? "Saved" : "Error";

  const details = $("resultDetails");
  details.innerHTML = "";
  [
    ["Email",         entry.email],
    ["Address",       entry.address],
    ["Total Units",   vals?.totalUnits || "—"],
    ["Price",         vals?.price ? formatUSD(vals.price) : "—"],
    ["Cost",          vals?.cost  ? formatUSD(vals.cost)  : "—"],
    ["Building SqFt", vals?.sqft  ? Number(vals.sqft).toLocaleString() + " sqft" : "—"],
    ["Radius",        `${vals?.radius || "—"} mi`],
    ["Comps",         `${vals?.minComps || "—"} – ${vals?.maxComps || "—"}`],
    ["Status",        vals?.status || "—"],
  ].forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    row.innerHTML = `<span class="dl">${label}</span><span class="dv">${value}</span>`;
    details.appendChild(row);
  });

  if (entry.combos?.length) {
    const row = document.createElement("div");
    row.className = "detail-row";
    row.style.cssText = "flex-direction:column;align-items:flex-start;gap:6px;";
    row.innerHTML = `<span class="dl">Unit Mix</span>`;
    const tags = document.createElement("div");
    tags.className = "combo-tags";
    entry.combos.forEach(c => {
      const tag = document.createElement("span");
      tag.className = "combo-tag";
      tag.textContent = `${c.type} ${c.beds}bd/${c.baths}ba`;
      tags.appendChild(tag);
    });
    row.appendChild(tags);
    details.appendChild(row);
  }

  renderHistory();
  $("viewSearch").className  = "view";
  $("viewResults").className = "view active";
}

$("backBtn").addEventListener("click",      () => { $("viewResults").className="view"; $("viewSearch").className="view active"; });
$("newSearchBtn").addEventListener("click", () => { $("viewResults").className="view"; $("viewSearch").className="view active"; });

// ── History ───────────────────────────────────────────────────────────────────

function addToHistory(entry) {
  chrome.storage.local.get(["searchHistory"], ({ searchHistory }) => {
    const h = searchHistory || [];
    h.unshift(entry);
    chrome.storage.local.set({ searchHistory: h.slice(0, 20) });
  });
}

function renderHistory() {
  chrome.storage.local.get(["searchHistory"], ({ searchHistory }) => {
    const list = $("historyList");
    const h = searchHistory || [];
    if (!h.length) { list.innerHTML = '<div class="empty-state">No searches yet.</div>'; return; }
    list.innerHTML = "";
    h.slice(0, 8).forEach(entry => {
      const item = document.createElement("div");
      item.className = "h-item";
      const d = new Date(entry.timestamp);
      const t = d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " · " +
                d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
      item.innerHTML = `
        <div>
          <div class="h-id">${entry.searchId}</div>
          <div class="h-meta">${entry.address} · ${t}</div>
        </div>
        <span class="h-badge ${entry.success ? "ok":"err"}">${entry.success ? "OK":"ERR"}</span>`;
      list.appendChild(item);
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

buildMatrix();
loadSettings();
wireUSDInputs();
