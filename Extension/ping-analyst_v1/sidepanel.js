// sidepanel.js — Ping Analyst v1.2

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

// ── Pipeline server URL (set once via chrome.storage, defaults to localhost) ───
// To point at your Render deployment run once in the DevTools console:
//   chrome.storage.sync.set({ pipelineUrl: "https://YOUR-APP.onrender.com" })
let _pipelineUrl = "http://localhost:5001";

// ── Matrix ────────────────────────────────────────────────────────────────────

const TYPES = { 0:"Studio", 1:"Single", 2:"Duplex", 3:"Triplex", 4:"Fourplex", 5:"Fiveplex" };
const MAX_COMBOS = 5;
let selectedCombos = [];
let resolvedCoords = null;

// ── Commercial Spaces ─────────────────────────────────────────────────────────

const COMMERCIAL_TYPES = ["Retail", "Office", "Restaurant", "Medical / Dental", "Flex Space"];
const MAX_COMMERCIAL   = 5;
let selectedCommercial = [];

$("commercialToggle").addEventListener("change", function () {
  const panel = $("commercialPanel");
  if (this.checked) {
    panel.classList.add("on");
    if (selectedCommercial.length === 0) addCommercialRow();
    else renderCommercialPanel();
  } else {
    panel.classList.remove("on");
  }
});

$("addCommercialBtn").addEventListener("click", () => addCommercialRow());

function addCommercialRow() {
  if (selectedCommercial.length >= MAX_COMMERCIAL) return;
  selectedCommercial.push({ type: COMMERCIAL_TYPES[0], sqft: "", rentPerSF: "" });
  renderCommercialPanel();
}

function removeCommercialRow(i) {
  selectedCommercial.splice(i, 1);
  renderCommercialPanel();
}

function renderCommercialPanel() {
  const rowsDiv = $("commercialRows");
  rowsDiv.innerHTML = "";

  if (selectedCommercial.length === 0) {
    rowsDiv.innerHTML = '<div class="comm-empty">No spaces added yet.</div>';
  } else {
    selectedCommercial.forEach((space, i) => {
      const row = document.createElement("div");
      row.className = "comm-row";

      // Type select
      const typeEl = document.createElement("select");
      typeEl.className = "comm-select";
      COMMERCIAL_TYPES.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t; opt.textContent = t;
        if (t === space.type) opt.selected = true;
        typeEl.appendChild(opt);
      });
      typeEl.addEventListener("change", () => { selectedCommercial[i].type = typeEl.value; });

      // SF input
      const sfEl = document.createElement("input");
      sfEl.type = "number"; sfEl.min = "1";
      sfEl.className = "comm-input"; sfEl.placeholder = "SF";
      if (space.sqft) sfEl.value = space.sqft;

      // $/SF/Yr input
      const rentEl = document.createElement("input");
      rentEl.type = "number"; rentEl.min = "0"; rentEl.step = "0.01";
      rentEl.className = "comm-input"; rentEl.placeholder = "$/SF";
      if (space.rentPerSF) rentEl.value = space.rentPerSF;

      // Annual revenue display
      const revEl = document.createElement("span");
      revEl.className = "comm-rev";
      const _updateRevEl = () => {
        const sf = parseFloat(sfEl.value) || 0;
        const rpsf = parseFloat(rentEl.value) || 0;
        if (sf > 0 && rpsf > 0) {
          revEl.textContent = `$${Math.round(sf * rpsf).toLocaleString()}`;
          revEl.classList.remove("empty");
        } else {
          revEl.textContent = "—";
          revEl.classList.add("empty");
        }
      };
      _updateRevEl();

      sfEl.addEventListener("input", () => {
        selectedCommercial[i].sqft = sfEl.value;
        _updateRevEl();
        updateCommTotal();
        if (sfEl.value && parseInt(sfEl.value) >= 1) hideErr("commercialError");
      });
      rentEl.addEventListener("input", () => {
        selectedCommercial[i].rentPerSF = rentEl.value;
        _updateRevEl();
        updateCommTotal();
        if (rentEl.value && parseFloat(rentEl.value) > 0) hideErr("commercialError");
      });

      // Remove button
      const rmBtn = document.createElement("button");
      rmBtn.className = "btn-rm-comm"; rmBtn.type = "button";
      rmBtn.textContent = "×";
      rmBtn.addEventListener("click", () => removeCommercialRow(i));

      row.appendChild(typeEl);
      row.appendChild(sfEl);
      row.appendChild(rentEl);
      row.appendChild(revEl);
      row.appendChild(rmBtn);
      rowsDiv.appendChild(row);
    });
  }

  $("addCommercialBtn").disabled = selectedCommercial.length >= MAX_COMMERCIAL;
  updateCommTotal();
}

function updateCommTotal() {
  const totalSF  = selectedCommercial.reduce((s, c) => s + (parseFloat(c.sqft)      || 0), 0);
  const totalRev = selectedCommercial.reduce((s, c) => s + (parseFloat(c.sqft) || 0) * (parseFloat(c.rentPerSF) || 0), 0);
  if (totalSF > 0 && totalRev > 0) {
    $("commTotalDisplay").textContent = `${Math.round(totalSF).toLocaleString()} SF · $${Math.round(totalRev).toLocaleString()}/yr`;
  } else if (totalSF > 0) {
    $("commTotalDisplay").textContent = `${Math.round(totalSF).toLocaleString()} SF total`;
  } else {
    $("commTotalDisplay").textContent = "";
  }
}

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
    selectedCombos.push({ beds, baths, type, units: "" });
    td.classList.add("sel");
  } else {
    selectedCombos = selectedCombos.filter(c => !(c.beds === beds && c.baths === baths));
    td.classList.remove("sel");
  }
  updateMatrixBadge();
  updateUnitsPanel();
  document.querySelectorAll(".combo-cb").forEach(c => {
    if (!c.checked) c.disabled = selectedCombos.length >= MAX_COMBOS;
  });
  if (selectedCombos.length > 0) hideErr("comboError");
}

// ── Units per Type Panel ───────────────────────────────────────────────────────

function updateUnitsPanel() {
  const panel   = $("unitsPanel");
  const rowsDiv = $("unitsRows");

  if (selectedCombos.length === 0) {
    panel.classList.remove("on");
    return;
  }
  panel.classList.add("on");
  rowsDiv.innerHTML = "";

  selectedCombos.forEach((combo, i) => {
    const row = document.createElement("div");
    row.className = "units-row";
    const label = `${combo.type} ${combo.beds}bd/${combo.baths}ba`;
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "1"; inp.className = "units-input";
    inp.id = `units_${i}`; inp.placeholder = "# units";
    if (combo.units) inp.value = combo.units;
    inp.addEventListener("input", () => {
      selectedCombos[i].units = inp.value;
      updateUnitsTotal();
      if (inp.value && parseInt(inp.value) >= 1) {
        const allFilled = selectedCombos.every(c => c.units && parseInt(c.units) >= 1);
        if (allFilled) hideErr("unitsError");
      }
    });
    const lbl = document.createElement("span");
    lbl.className = "units-label"; lbl.textContent = label;
    row.appendChild(lbl); row.appendChild(inp);
    rowsDiv.appendChild(row);
  });

  updateUnitsTotal();
}

function updateUnitsTotal() {
  const total = selectedCombos.reduce((s, c) => s + (parseInt(c.units) || 0), 0);
  $("unitsTotalDisplay").textContent = `${total} Total`;
}

function updateMatrixBadge() {
  const badge = $("matrixBadge");
  badge.textContent = `${selectedCombos.length} Selected`;
  badge.className = "matrix-badge" + (selectedCombos.length > 0 ? " active" : "");
}

// ── Geocoding (OpenStreetMap Nominatim — no GAS needed) ───────────────────────

let geoTimer = null;
let resolvedAddress = null;   // formatted address returned by geocoder

$("address").addEventListener("input", () => {
  resolvedCoords  = null;
  resolvedAddress = null;
  $("coordsPill").className = "coords-pill";
  clearTimeout(geoTimer);
  const val = $("address").value.trim();
  if (val.length < 6) return;
  geoTimer = setTimeout(() => geocodeAddress(val), 900);
});

async function geocodeAddress(address) {
  $("addrSpinner").className = "addr-spinner on";
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res  = await fetch(url, {
      headers: { "Accept-Language": "en-US,en", "User-Agent": "PingUnderwriting/1.0" }
    });
    const data = await res.json();
    if (data.length > 0) {
      resolvedCoords  = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      resolvedAddress = data[0].display_name;
      $("coordsText").textContent = `${resolvedCoords.lat.toFixed(5)}, ${resolvedCoords.lng.toFixed(5)}`;
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
    ["modelUrl","pipelineUrl","email","address","price","cost","sqft","radius","minComps","maxComps","status","combos"],
    cfg => {
      if (cfg.pipelineUrl) _pipelineUrl = cfg.pipelineUrl;
      if (cfg.modelUrl) { $("modelUrl").value = cfg.modelUrl; setConfiguredState(cfg.modelUrl); }
      if (cfg.email)    $("email").value    = cfg.email;
      if (cfg.address)  $("address").value  = cfg.address;
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
        updateUnitsPanel();
        document.querySelectorAll(".combo-cb").forEach(c => {
          if (!c.checked) c.disabled = selectedCombos.length >= MAX_COMBOS;
        });
      }
      if (cfg.commercial?.length) {
        selectedCommercial = cfg.commercial;
      }
      if (cfg.commercialToggle) {
        $("commercialToggle").checked = true;
        $("commercialPanel").classList.add("on");
        renderCommercialPanel();
      }
    }
  );
}

function getFormVals() {
  return {
    modelUrl: $("modelUrl").value.trim(),
    email:    $("email").value.trim(),
    address:  $("address").value.trim(),
    price:    parseUSD($("price").value),
    cost:     parseUSD($("cost").value),
    sqft:     $("sqft").value.trim(),
    radius:   $("radius").value.trim(),
    minComps: $("minComps").value.trim(),
    maxComps: $("maxComps").value.trim(),
    status:   $("status").value,
  };
}

$("saveBtn").addEventListener("click", () => {
  const vals = getFormVals();
  chrome.storage.sync.set({
    ...vals,
    combos: selectedCombos,
    commercial: selectedCommercial,
    commercialToggle: $("commercialToggle").checked,
  }, () => {
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

  const mn = parseInt(vals.minComps), mx = parseInt(vals.maxComps);
  if (!vals.radius || !vals.minComps || !vals.maxComps) { showErr("paramsError"); ok = false; }
  else if (mn > mx) { showErr("paramsError"); ok = false; }
  else { hideErr("paramsError"); }

  if (selectedCombos.length === 0) { showErr("comboError"); ok = false; }
  else { hideErr("comboError"); }

  if (selectedCombos.length > 0) {
    const missingUnits = selectedCombos.some(c => !c.units || parseInt(c.units) < 1);
    if (missingUnits) { showErr("unitsError"); ok = false; }
    else { hideErr("unitsError"); }
  }

  // Validate commercial spaces if toggle is on
  if ($("commercialToggle").checked && selectedCommercial.length > 0) {
    const incomplete = selectedCommercial.some(
      c => !c.sqft || parseInt(c.sqft) < 1 || !c.rentPerSF || parseFloat(c.rentPerSF) <= 0
    );
    if (incomplete) { showErr("commercialError"); ok = false; }
    else { hideErr("commercialError"); }
  } else {
    hideErr("commercialError");
  }

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

  const activeCommercial = $("commercialToggle").checked ? selectedCommercial : [];
  chrome.storage.sync.set({
    ...vals,
    combos: selectedCombos,
    commercial: selectedCommercial,
    commercialToggle: $("commercialToggle").checked,
  });

  try {
    const totalUnits = selectedCombos.reduce((s, c) => s + (parseInt(c.units) || 0), 0);

    const params = new URLSearchParams({
      action:     "search",
      userEmail:  vals.email,
      address:    resolvedAddress || vals.address,
      price:      vals.price,
      cost:       vals.cost,
      sqft:       vals.sqft,
      radius:     vals.radius,
      minComps:   vals.minComps,
      maxComps:   vals.maxComps,
      status:     vals.status,
      combos:     JSON.stringify(selectedCombos),
      commercial: JSON.stringify(activeCommercial),
      ...(resolvedCoords ? { lat: resolvedCoords.lat, lng: resolvedCoords.lng } : {}),
    });

    const res  = await fetch(`${vals.modelUrl}?${params}`);
    const data = await res.json();

    const entry = {
      searchId:   data.searchId || "—",
      email:      vals.email,
      address:    vals.address,
      totalUnits: totalUnits,
      combos:     selectedCombos,
      commercial: activeCommercial,
      timestamp:  new Date().toISOString(),
      success:    !!data.success,
      message:    data.message || data.error || "",
    };
    addToHistory(entry);
    showResults(entry, vals);

    // Fire-and-forget: kick the pipeline server the instant GAS confirms
    if (data.success) {
      fetch(`${_pipelineUrl}/trigger`, { method: "POST" }).catch(() => {});
    }

  } catch (err) {
    const entry = {
      searchId: "ERROR", email: vals.email, address: vals.address,
      combos: selectedCombos, commercial: activeCommercial,
      timestamp: new Date().toISOString(),
      success: false, message: err.message,
    };
    addToHistory(entry);
    showResults(entry, vals);
  } finally {
    $("runBtn").disabled = false;
    $("runBtn").innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Run Analysis`;
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
    ["Total Units",   entry.totalUnits || vals?.totalUnits || "—"],
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
      const unitStr = c.units ? ` · ${c.units}u` : "";
      tag.textContent = `${c.type} ${c.beds}bd/${c.baths}ba${unitStr}`;
      tags.appendChild(tag);
    });
    row.appendChild(tags);
    details.appendChild(row);
  }

  if (entry.commercial?.length) {
    const row = document.createElement("div");
    row.className = "detail-row";
    row.style.cssText = "flex-direction:column;align-items:flex-start;gap:6px;";
    row.innerHTML = `<span class="dl">Commercial Spaces</span>`;
    const tags = document.createElement("div");
    tags.className = "combo-tags";
    entry.commercial.forEach(c => {
      const tag = document.createElement("span");
      tag.className = "combo-tag";
      const sf  = c.sqft    ? Number(c.sqft).toLocaleString() + " SF" : "–";
      const nnn = c.rentPerSF ? `$${c.rentPerSF}/SF` : "–";
      tag.textContent = `${c.type} · ${sf} · ${nnn}`;
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
$("newSearchBtn").addEventListener("click", () => {
  // Clear all combos for a clean slate
  selectedCombos = [];
  document.querySelectorAll(".combo-cb").forEach(cb => {
    cb.checked  = false;
    cb.disabled = false;
    cb.closest(".cb-cell")?.classList.remove("sel");
  });
  updateMatrixBadge();
  updateUnitsPanel();

  // Clear commercial spaces
  selectedCommercial = [];
  $("commercialToggle").checked = false;
  $("commercialPanel").classList.remove("on");
  renderCommercialPanel();

  chrome.storage.sync.remove(["combos", "commercial", "commercialToggle"]);

  $("viewResults").className = "view";
  $("viewSearch").className  = "view active";
});

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
