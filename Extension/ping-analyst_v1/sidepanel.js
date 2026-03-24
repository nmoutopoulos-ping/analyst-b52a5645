
// ── Auth Gate: hide gated sections until sign-in verified ──
(function initAuthGate() {
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.auth-gated').forEach(function(el) { el.style.display = 'none'; });
    var footer = document.querySelector('#viewSearch .footer');
    if (footer) footer.classList.add('auth-gated');
  });
})();
// sidepanel.js — Ping Analyst v2.0

const $ = id => document.getElementById(id);

// ── USD Formatting ─────────────────────────────────────────────────────────────
function parseUSD(val) { return String(val).replace(/[^0-9.]/g, ""); }
function formatUSD(val) {
  const num = parseFloat(parseUSD(val));
  if (isNaN(num) || val === "") return "";
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function wireUSDInputs() {
  ["price", "cost"].forEach(id => {
    const el = $(id);
    el.addEventListener("focus", () => { el.value = parseUSD(el.value); });
    el.addEventListener("blur",  () => { el.value = formatUSD(el.value); });
  });
}

// ── Unit Mix Matrix ────────────────────────────────────────────────────────────
const TYPES    = { 0:"Studio", 1:"Single", 2:"Duplex", 3:"Triplex", 4:"Fourplex", 5:"Fiveplex" };
const MAX_COMBOS = 5;
let selectedCombos = [];
let resolvedCoords  = null;
let resolvedAddress = null;

// ── Commercial Spaces ──────────────────────────────────────────────────────────
const COMMERCIAL_TYPES = ["Retail", "Office", "Restaurant", "Medical / Dental", "Flex Space"];
const MAX_COMMERCIAL   = 5;
let selectedCommercial = [];

$("commercialToggle").addEventListener("change", function () {
  const panel = $("commercialPanel");
  if (this.checked) { panel.classList.add("on"); if (!selectedCommercial.length) addCommercialRow(); else renderCommercialPanel(); }
  else { panel.classList.remove("on"); }
});
$("addCommercialBtn").addEventListener("click", () => addCommercialRow());

function addCommercialRow() {
  if (selectedCommercial.length >= MAX_COMMERCIAL) return;
  selectedCommercial.push({ type: COMMERCIAL_TYPES[0], sqft: "", rentPerSF: "" });
  renderCommercialPanel();
}
function removeCommercialRow(i) { selectedCommercial.splice(i, 1); renderCommercialPanel(); }
function renderCommercialPanel() {
  const rowsDiv = $("commercialRows");
  rowsDiv.innerHTML = "";
  if (!selectedCommercial.length) { rowsDiv.innerHTML = '<div class="comm-empty">No spaces added yet.</div>'; }
  else {
    selectedCommercial.forEach((space, i) => {
      const row = document.createElement("div"); row.className = "comm-row";
      const typeEl = document.createElement("select"); typeEl.className = "comm-select";
      COMMERCIAL_TYPES.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === space.type) o.selected = true; typeEl.appendChild(o); });
      typeEl.addEventListener("change", () => { selectedCommercial[i].type = typeEl.value; });
      const sfEl = document.createElement("input"); sfEl.type = "number"; sfEl.min = "1"; sfEl.className = "comm-input"; sfEl.placeholder = "SF"; if (space.sqft) sfEl.value = space.sqft;
      const rentEl = document.createElement("input"); rentEl.type = "number"; rentEl.min = "0"; rentEl.step = "0.01"; rentEl.className = "comm-input"; rentEl.placeholder = "$/SF"; if (space.rentPerSF) rentEl.value = space.rentPerSF;
      const revEl = document.createElement("span"); revEl.className = "comm-rev";
      const _upd = () => { const sf = parseFloat(sfEl.value)||0, r = parseFloat(rentEl.value)||0; if (sf>0&&r>0) { revEl.textContent=`$${Math.round(sf*r).toLocaleString()}`; revEl.classList.remove("empty"); } else { revEl.textContent="—"; revEl.classList.add("empty"); } };
      _upd();
      sfEl.addEventListener("input", () => { selectedCommercial[i].sqft = sfEl.value; _upd(); updateCommTotal(); if (sfEl.value && parseInt(sfEl.value)>=1) hideErr("commercialError"); });
      rentEl.addEventListener("input", () => { selectedCommercial[i].rentPerSF = rentEl.value; _upd(); updateCommTotal(); if (rentEl.value && parseFloat(rentEl.value)>0) hideErr("commercialError"); });
      const rmBtn = document.createElement("button"); rmBtn.className = "btn-rm-comm"; rmBtn.type = "button"; rmBtn.textContent = "×"; rmBtn.addEventListener("click", () => removeCommercialRow(i));
      row.append(typeEl, sfEl, rentEl, revEl, rmBtn); rowsDiv.appendChild(row);
    });
  }
  $("addCommercialBtn").disabled = selectedCommercial.length >= MAX_COMMERCIAL;
  updateCommTotal();
}
function updateCommTotal() {
  const totalSF  = selectedCommercial.reduce((s,c) => s+(parseFloat(c.sqft)||0), 0);
  const totalRev = selectedCommercial.reduce((s,c) => s+(parseFloat(c.sqft)||0)*(parseFloat(c.rentPerSF)||0), 0);
  if (totalSF > 0 && totalRev > 0) $("commTotalDisplay").textContent = `${Math.round(totalSF).toLocaleString()} SF · $${Math.round(totalRev).toLocaleString()}/yr`;
  else if (totalSF > 0) $("commTotalDisplay").textContent = `${Math.round(totalSF).toLocaleString()} SF total`;
  else $("commTotalDisplay").textContent = "";
}

function buildMatrix() {
  const tbody = $("comboBody"); tbody.innerHTML = "";
  for (let beds = 0; beds <= 5; beds++) {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td"); tdLabel.textContent = `${TYPES[beds]} (${beds}bd)`; tr.appendChild(tdLabel);
    for (let baths = 1; baths <= 5; baths++) {
      const td = document.createElement("td"); td.className = "cb-cell";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "combo-cb"; cb.id = `cb_${beds}_${baths}`; cb.dataset.beds = beds; cb.dataset.baths = baths; cb.dataset.type = TYPES[beds];
      const lbl = document.createElement("label"); lbl.htmlFor = cb.id; lbl.appendChild(cb); td.appendChild(lbl);
      td.addEventListener("click", e => { if (e.target !== cb) cb.click(); });
      cb.addEventListener("change", () => onComboChange(cb, td));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}
function onComboChange(cb, td) {
  const beds = parseInt(cb.dataset.beds), baths = parseInt(cb.dataset.baths), type = cb.dataset.type;
  if (cb.checked) {
    if (selectedCombos.length >= MAX_COMBOS) { cb.checked = false; return; }
    selectedCombos.push({ beds, baths, type, units: "" }); td.classList.add("sel");
  } else {
    selectedCombos = selectedCombos.filter(c => !(c.beds===beds && c.baths===baths)); td.classList.remove("sel");
  }
  updateMatrixBadge(); updateUnitsPanel();
  document.querySelectorAll(".combo-cb").forEach(c => { if (!c.checked) c.disabled = selectedCombos.length >= MAX_COMBOS; });
  if (selectedCombos.length > 0) hideErr("comboError");
}
function updateUnitsPanel() {
  const panel = $("unitsPanel"), rowsDiv = $("unitsRows");
  if (!selectedCombos.length) { panel.classList.remove("on"); return; }
  panel.classList.add("on"); rowsDiv.innerHTML = "";
  selectedCombos.forEach((combo, i) => {
    const row = document.createElement("div"); row.className = "units-row";
    const inp = document.createElement("input"); inp.type = "number"; inp.min = "1"; inp.className = "units-input"; inp.id = `units_${i}`; inp.placeholder = "# units"; if (combo.units) inp.value = combo.units;
    inp.addEventListener("input", () => { selectedCombos[i].units = inp.value; updateUnitsTotal(); if (inp.value && parseInt(inp.value)>=1) { if (selectedCombos.every(c => c.units && parseInt(c.units)>=1)) hideErr("unitsError"); } });
    const lbl = document.createElement("span"); lbl.className = "units-label"; lbl.textContent = `${combo.type} ${combo.beds}bd/${combo.baths}ba`;
    row.append(lbl, inp); rowsDiv.appendChild(row);
  });
  updateUnitsTotal();
}
function updateUnitsTotal() {
  $("unitsTotalDisplay").textContent = `${selectedCombos.reduce((s,c) => s+(parseInt(c.units)||0), 0)} Total`;
}
function updateMatrixBadge() {
  const badge = $("matrixBadge"); badge.textContent = `${selectedCombos.length} Selected`;
  badge.className = "matrix-badge" + (selectedCombos.length > 0 ? " active" : "");
}

// ── Geocoding ──────────────────────────────────────────────────────────────────
let geoTimer = null;
$("address").addEventListener("input", () => {
  resolvedCoords = null; resolvedAddress = null;
  $("coordsPill").className = "coords-pill";
  clearTimeout(geoTimer);
  const val = $("address").value.trim();
  if (val.length < 6) return;
  geoTimer = setTimeout(() => geocodeAddress(val), 900);
});
async function geocodeAddress(address) {
  $("addrSpinner").className = "addr-spinner on";
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: {"Accept-Language":"en-US,en","User-Agent":"PingUnderwriting/1.0"} });
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

// ── Server URL ─────────────────────────────────────────────────────────────────
// ── Hardcoded server URL ──────────────────────────────────────────
const SERVER_URL = "https://analyst-ra00.onrender.com";

// ── Auth state ──────────────────────────────────────────────────
let currentApiKey = null;
let currentUserName = null;

function isSignedIn() { return !!currentApiKey; }

function getSavedAuth() {
  return new Promise(resolve => {
    chrome.storage.local.get(["ext_api_key", "ext_user_name", "ext_email"], resolve);
  });
}

function saveAuth(apiKey, name, email) {
  currentApiKey = apiKey;
  currentUserName = name;
  chrome.storage.local.set({ ext_api_key: apiKey, ext_user_name: name, ext_email: email });
}

function clearSavedAuth() {
  currentApiKey = null;
  currentUserName = null;
  chrome.storage.local.remove(["ext_api_key", "ext_user_name", "ext_email"]);
}

// ── Sign-in UI ──────────────────────────────────────────────────
function showSignedIn(name) {
  document.querySelectorAll('.auth-gated').forEach(function(el) {
    el.style.display = '';
    el.classList.add('revealing');
    setTimeout(function() { el.classList.add('revealed'); el.classList.remove('revealing'); }, 50);
  });
  var footer = document.querySelector('#viewSearch .footer');
  if (footer) { footer.style.display = ''; footer.classList.remove('auth-gated'); }
  var signInCard = document.getElementById('signInCard');
  if (signInCard) signInCard.classList.add('signed-in');
  $("signInForm").style.display = "none";
  $("signedInInfo").style.display = "";
  $("signedInName").textContent = name || "User";
  $("templatesCard").style.display = "";
  loadTemplates();
}

function showSignedOut() {
  document.querySelectorAll('.auth-gated').forEach(function(el) {
    el.style.display = 'none';
    el.classList.remove('revealing', 'revealed');
  });
  var footer = document.querySelector('#viewSearch .footer');
  if (footer) footer.style.display = 'none';
  var signInCard = document.getElementById('signInCard');
  if (signInCard) signInCard.classList.remove('signed-in');
  $("signInForm").style.display = "";
  $("signedInInfo").style.display = "none";
  $("templatesCard").style.display = "none";
  $("signInError").style.display = "none";
  $("signInEmail").value = "";
  $("signInPassword").value = "";
}

async function handleSignIn() {
  const email = $("signInEmail").value.trim();
  const password = $("signInPassword").value;
  if (!email || !password) {
    $("signInError").textContent = "Please enter email and password.";
    $("signInError").style.display = "";
    return;
  }
  $("signInBtn").disabled = true;
  $("signInBtn").textContent = "Signing in...";
  $("signInError").style.display = "none";
  try {
    const res = await fetch(SERVER_URL + "/extension/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Sign-in failed");
    saveAuth(data.api_key, data.name, data.email);
    showSignedIn(data.name);
  } catch (e) {
    $("signInError").textContent = e.message || "Sign-in failed. Check your credentials.";
    $("signInError").style.display = "";
  } finally {
    $("signInBtn").disabled = false;
    $("signInBtn").textContent = "Sign In";
  }
}

function handleSignOut() {
  clearSavedAuth();
  showSignedOut();
}

// ── Templates ───────────────────────────────────────────────────
async 
// ── 2-Way Sync: Templates & Assumption Presets ──
async function syncTemplatesFromServer() {
  try {
    var resp = await fetch(SERVER_URL + '/api/search-templates', {
      headers: { 'X-Extension-Key': currentApiKey }
    });
    if (!resp.ok) return null;
    var serverTemplates = await resp.json();
    if (Array.isArray(serverTemplates) && serverTemplates.length > 0) {
      chrome.storage.local.set({ search_templates: serverTemplates });
      return serverTemplates;
    }
  } catch(e) { console.warn('Template sync failed:', e); }
  return null;
}

async function pushTemplatesToServer(templates) {
  try {
    await fetch(SERVER_URL + '/api/search-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extension-Key': currentApiKey },
      body: JSON.stringify(templates)
    });
  } catch(e) { console.warn('Template push failed:', e); }
}

async function syncPresetsFromServer() {
  try {
    var resp = await fetch(SERVER_URL + '/api/assumption-presets', {
      headers: { 'X-Extension-Key': currentApiKey }
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    if (data && data.presets && data.presets.length > 0) {
      chrome.storage.local.set({ assumption_presets: JSON.stringify(data) });
      return data;
    }
  } catch(e) { console.warn('Presets sync failed:', e); }
  return null;
}

async function pushPresetsToServer(presets) {
  try {
    await fetch(SERVER_URL + '/api/assumption-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extension-Key': currentApiKey },
      body: JSON.stringify(presets)
    });
  } catch(e) { console.warn('Presets push failed:', e); }
}

async function loadTemplates() {
  var serverTpls = await syncTemplatesFromServer();
  if (serverTpls) {
    var list = document.getElementById('templatesList');
    if (list) {
      list.innerHTML = '';
      serverTpls.forEach(function(t) {
        var item = document.createElement('div');
        item.className = 'template-item';
        item.innerHTML = '<div><div class="template-name">' + (t.name || t.address || 'Untitled') + '</div><div class="template-address">' + (t.address || '') + '</div></div><span class="template-arrow">&#8250;</span>';
        item.addEventListener('click', function() { applyTemplate(t); });
        list.appendChild(item);
      });
      document.getElementById('templatesCard').style.display = '';
    }
    return;
  }
  // Fall back to local storage
  const list = $("templatesList");
  list.innerHTML = '<div class="templates-empty">Loading templates...</div>';
  try {
    const res = await fetch(SERVER_URL + "/crm/templates?api_key=" + encodeURIComponent(currentApiKey));
    const data = await res.json();
    if (!data.ok || !data.templates || data.templates.length === 0) {
      list.innerHTML = '<div class="templates-empty">No saved templates yet. Start a new search below.</div>';
      return;
    }
    list.innerHTML = "";
    data.templates.forEach(t => {
      const el = document.createElement("div");
      el.className = "template-item";
      el.innerHTML = '<div><div class="template-name">' + (t.name || "Untitled") +
        '</div><div class="template-address">' + (t.address || "") + '</div></div>' +
        '<span class="template-arrow">&#8250;</span>';
      el.addEventListener("click", () => applyTemplate(t));
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = '<div class="templates-empty">Could not load templates.</div>';
  }
}

function applyTemplate(t) {
  // Fill form fields from template
  if (t.address) $("address").value = t.address;
  if (t.price) $("price").value = t.price;
  if (t.cost) $("cost").value = t.cost;
  if (t.sqft) $("sqft").value = t.sqft;
  if (t.radius) $("radius").value = t.radius;
  if (t.minComps) $("minComps").value = t.minComps;
  if (t.maxComps) $("maxComps").value = t.maxComps;
  // Hide templates, show form
  $("templatesCard").style.display = "none";
  // Scroll to form
  $("address").scrollIntoView({ behavior: "smooth" });
}

// ── Init ────────────────────────────────────────────────────────
async function loadSettings() {
  // Wire sign-in
  $("signInBtn").addEventListener("click", handleSignIn);
  $("signOutBtn").addEventListener("click", handleSignOut);
  $("newSearchBtn").addEventListener("click", () => {
    $("templatesCard").style.display = "none";
  });

  // Allow Enter to submit sign-in
  $("signInPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") handleSignIn();
  });

  // Check saved auth
  const saved = await getSavedAuth();
  if (saved.ext_api_key) {
    currentApiKey = saved.ext_api_key;
    currentUserName = saved.ext_user_name;
    showSignedIn(saved.ext_user_name);
  } else {
    showSignedOut();
  }
}

function getFormVals() {
  return {
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
  chrome.storage.sync.set({ ...vals, combos: selectedCombos, commercial: selectedCommercial, commercialToggle: $("commercialToggle").checked }, () => {
    $("saveBtn").textContent = "Saved ✓"; setTimeout(() => $("saveBtn").textContent = "Save", 1500);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────────
function showErr(id) { $(id).classList.add("on"); }
function hideErr(id) { $(id).classList.remove("on"); }
["minComps","maxComps"].forEach(id => {
  $(id).addEventListener("input", () => {
    const mn = parseInt($("minComps").value), mx = parseInt($("maxComps").value);
    $("compsWarn").className = "warn-banner" + (mn > mx && mx ? " on" : "");
  });
});
function validate(vals, currentApiKey) {
  let ok = true;
  if (!currentApiKey) { $("formError").textContent = "Please enter your access key first."; $("formError").className = "form-error on"; return false; }
  if (!vals.address) { showErr("addressError"); $("address").classList.add("err"); ok = false; } else { hideErr("addressError"); $("address").classList.remove("err"); }
  const mn = parseInt(vals.minComps), mx = parseInt(vals.maxComps);
  if (!vals.radius || !vals.minComps || !vals.maxComps) { showErr("paramsError"); ok = false; } else if (mn > mx) { showErr("paramsError"); ok = false; } else { hideErr("paramsError"); }
  if (!selectedCombos.length) { showErr("comboError"); ok = false; } else { hideErr("comboError"); }
  if (selectedCombos.length) {
    if (selectedCombos.some(c => !c.units || parseInt(c.units) < 1)) { showErr("unitsError"); ok = false; } else { hideErr("unitsError"); }
  }
  if ($("commercialToggle").checked && selectedCommercial.length) {
    if (selectedCommercial.some(c => !c.sqft || parseInt(c.sqft)<1 || !c.rentPerSF || parseFloat(c.rentPerSF)<=0)) { showErr("commercialError"); ok = false; } else { hideErr("commercialError"); }
  } else { hideErr("commercialError"); }
  return ok;
}

// ── Run ────────────────────────────────────────────────────────────────────────
$("runBtn").addEventListener("click", async () => {
  const vals = getFormVals();

  // Server URL is hardcoded at module level
  // Use module-level currentApiKey (set on sign-in)
  $("formError").className = "form-error";
  if (!validate(vals, currentApiKey)) return;

  $("runBtn").disabled = true;
  $("runBtn").innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Running…`;

  const activeCommercial = $("commercialToggle").checked ? selectedCommercial : [];
  chrome.storage.sync.set({ ...vals, combos: selectedCombos, commercial: selectedCommercial, commercialToggle: $("commercialToggle").checked });

  // Resolve which preset to use for this search
  const chosenPresetName = $("searchPresetSelect")?.value || searchActivePreset || defaultPresetName;
  const chosenPreset     = getPreset(chosenPresetName);
  searchActivePreset     = chosenPresetName;
  savePresetsStorage();

  try {
    const body = {
      api_key: currentApiKey,
      address:    resolvedAddress || vals.address,
      lat:        resolvedCoords?.lat  ?? null,
      lng:        resolvedCoords?.lng  ?? null,
      price:      vals.price,
      cost:       vals.cost,
      sqft:       vals.sqft,
      radius:     vals.radius,
      minComps:   vals.minComps,
      maxComps:   vals.maxComps,
      status:     vals.status,
      combos:     selectedCombos,
      commercial: activeCommercial,
      assumptions: {
        ltv:         chosenPreset.ltv,
        closingPct:  chosenPreset.closingPct,
        vacancy:     chosenPreset.vacancy,
        opexRatio:   chosenPreset.opexRatio,
        intRate:     chosenPreset.intRate,
        rentGrowth1: chosenPreset.rentGrowth1,
        otherIncMo:  chosenPreset.otherIncMo,
      },
      preset_name: chosenPresetName,
    };

    const res  = await fetch(`${SERVER_URL}/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    const totalUnits = selectedCombos.reduce((s, c) => s + (parseInt(c.units) || 0), 0);
    const entry = {
      searchId:   data.searchId || "—",
      address:    vals.address,
      totalUnits,
      combos:     selectedCombos,
      commercial: activeCommercial,
      presetName: chosenPresetName,
      timestamp:  new Date().toISOString(),
      success:    !!data.ok,
      message:    data.error || (data.ok ? "Analysis started — results will be emailed to you shortly." : "Unknown error"),
    };
    addToHistory(entry);
    showResults(entry, vals);

  } catch (err) {
    const entry = { searchId: "ERROR", address: vals.address, combos: selectedCombos, commercial: activeCommercial, timestamp: new Date().toISOString(), success: false, message: err.message };
    addToHistory(entry); showResults(entry, vals);
  } finally {
    $("runBtn").disabled = false;
    $("runBtn").innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Run Analysis`;
  }
});

// ── Results ────────────────────────────────────────────────────────────────────
function showResults(entry, vals) {
  const hero = $("resultHero");
  hero.className = `result-hero ${entry.success ? "ok" : "err"}`;
  $("resultStatus").textContent = entry.success ? "✓ Analysis Started" : "✕ Failed";
  $("resultId").textContent     = entry.searchId;
  $("resultMeta").textContent   = entry.message;
  $("resultsBadge").className   = "results-badge" + (entry.success ? "" : " error");
  $("resultsBadge").textContent = entry.success ? "Running" : "Error";

  const details = $("resultDetails"); details.innerHTML = "";
  [
    ["Address",       entry.address],
    ["Total Units",   entry.totalUnits || "—"],
    ["Price",         vals?.price ? formatUSD(vals.price) : "—"],
    ["Cost",          vals?.cost  ? formatUSD(vals.cost)  : "—"],
    ["Building SqFt", vals?.sqft  ? Number(vals.sqft).toLocaleString() + " sqft" : "—"],
    ["Radius",        `${vals?.radius || "—"} mi`],
    ["Comps",         `${vals?.minComps || "—"} – ${vals?.maxComps || "—"}`],
    ["Status",        vals?.status || "—"],
    ["Assumptions",   entry.presetName || "—"],
  ].forEach(([label, value]) => {
    const row = document.createElement("div"); row.className = "detail-row";
    row.innerHTML = `<span class="dl">${label}</span><span class="dv">${value}</span>`;
    details.appendChild(row);
  });

  if (entry.combos?.length) {
    const row = document.createElement("div"); row.className = "detail-row"; row.style.cssText = "flex-direction:column;align-items:flex-start;gap:6px;";
    row.innerHTML = `<span class="dl">Unit Mix</span>`;
    const tags = document.createElement("div"); tags.className = "combo-tags";
    entry.combos.forEach(c => { const tag = document.createElement("span"); tag.className = "combo-tag"; tag.textContent = `${c.type} ${c.beds}bd/${c.baths}ba${c.units ? ` · ${c.units}u` : ""}`; tags.appendChild(tag); });
    row.appendChild(tags); details.appendChild(row);
  }

  renderHistory();
  $("viewSearch").className  = "view";
  $("viewResults").className = "view active";
}

$("backBtn").addEventListener("click", () => { $("viewResults").className="view"; $("viewSearch").className="view active"; });
$("newSearchBtn").addEventListener("click", () => {
  selectedCombos = [];
  document.querySelectorAll(".combo-cb").forEach(cb => { cb.checked=false; cb.disabled=false; cb.closest(".cb-cell")?.classList.remove("sel"); });
  updateMatrixBadge(); updateUnitsPanel();
  selectedCommercial = []; $("commercialToggle").checked=false; $("commercialPanel").classList.remove("on"); renderCommercialPanel();
  chrome.storage.sync.remove(["combos","commercial","commercialToggle"]);
  $("viewResults").className="view"; $("viewSearch").className="view active";
});

// ── History ────────────────────────────────────────────────────────────────────
function addToHistory(entry) {
  chrome.storage.local.get(["searchHistory"], ({ searchHistory }) => {
    const h = searchHistory || []; h.unshift(entry);
    chrome.storage.local.set({ searchHistory: h.slice(0, 20) });
  });
}
function renderHistory() {
  chrome.storage.local.get(["searchHistory"], ({ searchHistory }) => {
    const list = $("historyList"), h = searchHistory || [];
    if (!h.length) { list.innerHTML = '<div class="empty-state">No searches yet.</div>'; return; }
    list.innerHTML = "";
    h.slice(0, 8).forEach(entry => {
      const item = document.createElement("div"); item.className = "h-item";
      const d = new Date(entry.timestamp);
      const t = d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " · " + d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
      item.innerHTML = `<div><div class="h-id">${entry.searchId}</div><div class="h-meta">${entry.address} · ${t}</div></div><span class="h-badge ${entry.success?"ok":"err"}">${entry.success?"OK":"ERR"}</span>`;
      list.appendChild(item);
    });
  });
}

// ── Assumption Presets ─────────────────────────────────────────────────────────

const PRESET_FIELD_CONFIG = [
  { key:"ltv",         label:"Loan-to-Value (LTV)",     step:"1",   min:"1",   max:"100", pct:true  },
  { key:"closingPct",  label:"Closing Costs",            step:"0.5", min:"0",   max:"20",  pct:true  },
  { key:"vacancy",     label:"Vacancy Rate",             step:"1",   min:"0",   max:"50",  pct:true  },
  { key:"opexRatio",   label:"OPEX Ratio",               step:"1",   min:"0",   max:"100", pct:true  },
  { key:"intRate",     label:"Interest Rate (IO, Yr 1)", step:"0.1", min:"0",   max:"30",  pct:true  },
  { key:"rentGrowth1", label:"Year-1 Rent Growth",       step:"0.5", min:"-10", max:"20",  pct:true  },
  { key:"otherIncMo",  label:"Other Income / Unit / Mo", step:"5",   min:"0",   max:"500", pct:false, prefix:"$" },
];

const SEED_PRESETS = [
  { name:"Conservative", ltv:0.65, closingPct:0.03,  vacancy:0.10, opexRatio:0.40, intRate:0.07,  rentGrowth1:0.02, otherIncMo:50  },
  { name:"Standard",     ltv:0.70, closingPct:0.02,  vacancy:0.07, opexRatio:0.35, intRate:0.065, rentGrowth1:0.03, otherIncMo:75  },
  { name:"Aggressive",   ltv:0.80, closingPct:0.015, vacancy:0.05, opexRatio:0.30, intRate:0.060, rentGrowth1:0.05, otherIncMo:100 },
];

let assumptionPresets  = [];
let defaultPresetName  = "";
let searchActivePreset = "";
let settingsSelected   = "";   // preset currently highlighted in settings view
let editingPreset      = null; // null = adding new, string = name of preset being edited

function loadPresetsStorage(cb) {
  syncPresetsFromServer().then(function(serverData) {
    if (serverData && serverData.presets) {
      window.__presetsCache = serverData.presets;
      window.__defaultPresetId = serverData.defaultId || null;
      if (cb) cb(serverData);
      return;
    }
    _loadPresetsLocal(cb);
  }).catch(function() { _loadPresetsLocal(cb); });
}
function _loadPresetsLocal(cb) {
  chrome.storage.sync.get(["assumptionPresets","defaultPresetName","searchActivePreset"], cfg => {
    assumptionPresets  = cfg.assumptionPresets?.length ? cfg.assumptionPresets : SEED_PRESETS.map(p => ({...p}));
    defaultPresetName  = cfg.defaultPresetName  || assumptionPresets[0]?.name || "";
    searchActivePreset = cfg.searchActivePreset || defaultPresetName;
    settingsSelected   = defaultPresetName;
    if (cb) cb();
  });
}

function savePresetsStorage() {
  var presetsData = { presets: window.__presetsCache || [], defaultId: window.__defaultPresetId || null };
  pushPresetsToServer(presetsData);
  chrome.storage.sync.set({ assumptionPresets, defaultPresetName, searchActivePreset });
}

function getPreset(name) {
  return assumptionPresets.find(p => p.name === name) || assumptionPresets[0];
}

function fmtPresetVal(key, val) {
  const cfg = PRESET_FIELD_CONFIG.find(c => c.key === key);
  if (!cfg) return String(val);
  if (cfg.pct) {
    const pct = val * 100;
    const decimals = (pct % 1 === 0) ? 0 : (String(pct).split(".")[1]?.length > 1 ? 1 : 1);
    return pct.toFixed(decimals).replace(/\.0$/, "") + "%";
  }
  return "$" + val;
}

// ── Search preset selector ─────────────────────────────────────────────────────

function renderSearchPresetSelect() {
  const sel = $("searchPresetSelect");
  if (!sel) return;
  const prev = sel.value || searchActivePreset;
  sel.innerHTML = "";
  assumptionPresets.forEach(p => {
    const o = document.createElement("option");
    o.value = p.name;
    o.textContent = p.name + (p.name === defaultPresetName ? " (Default)" : "");
    if (p.name === prev) o.selected = true;
    sel.appendChild(o);
  });
  if (!sel.value && assumptionPresets.length) sel.value = assumptionPresets[0].name;
}

$("searchPresetSelect").addEventListener("change", function () {
  searchActivePreset = this.value;
  savePresetsStorage();
});

$("openSettingsBtn").addEventListener("click", () => {
  settingsSelected = searchActivePreset || defaultPresetName;
  $("viewSearch").className   = "view";
  $("viewSettings").className = "view active";
  renderSettingsList();
});

// ── Settings view ──────────────────────────────────────────────────────────────

$("settingsBackBtn").addEventListener("click", () => {
  $("viewSettings").className = "view";
  $("viewSearch").className   = "view active";
  renderSearchPresetSelect();
});

function renderSettingsList() {
  // Ensure main section is visible, edit form hidden
  $("presetMainSection").classList.remove("off");
  $("presetEditSection").classList.remove("on");

  const list = $("presetList");
  list.innerHTML = "";

  assumptionPresets.forEach(p => {
    const isDefault = p.name === defaultPresetName;
    const isSelected = p.name === settingsSelected;

    const item = document.createElement("div");
    item.className = "preset-item" + (isSelected ? " active" : "");

    // Left side: name + default badge
    const left = document.createElement("div");
    left.className = "preset-item-left";
    const nameEl = document.createElement("div");
    nameEl.className = "preset-item-name";
    nameEl.textContent = p.name;
    left.appendChild(nameEl);
    if (isDefault) {
      const defEl = document.createElement("div");
      defEl.className = "preset-default-label";
      defEl.textContent = "Default";
      left.appendChild(defEl);
    }
    left.addEventListener("click", () => { settingsSelected = p.name; renderSettingsList(); });

    // Right side: edit + delete icons
    const acts = document.createElement("div");
    acts.className = "preset-item-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-preset-icon";
    editBtn.title = "Edit preset";
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.addEventListener("click", e => { e.stopPropagation(); openEditForm(p.name); });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-preset-icon delete";
    delBtn.title = isDefault ? "Cannot delete the default preset" : "Delete preset";
    if (isDefault) delBtn.disabled = true;
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    delBtn.addEventListener("click", e => { e.stopPropagation(); deletePreset(p.name); });

    acts.append(editBtn, delBtn);
    item.append(left, acts);
    list.appendChild(item);
  });

  renderPresetValues();
}

function renderPresetValues() {
  const p = getPreset(settingsSelected);
  if (!p) return;
  $("presetValuesTitle").textContent = p.name;
  const grid = $("presetValuesGrid");
  grid.innerHTML = "";
  PRESET_FIELD_CONFIG.forEach(cfg => {
    const box = document.createElement("div");
    box.className = "pvb";
    box.innerHTML = `<div class="pvb-label">${cfg.label}</div><div class="pvb-value">${fmtPresetVal(cfg.key, p[cfg.key])}</div>`;
    grid.appendChild(box);
  });
}

// ── Add / Edit form ────────────────────────────────────────────────────────────

$("addPresetBtn").addEventListener("click", () => openEditForm(null));

function openEditForm(presetName) {
  editingPreset = presetName;
  const isNew = presetName === null;
  const p = isNew ? SEED_PRESETS[1] : getPreset(presetName); // default to Standard values for new

  $("presetEditTitle").textContent  = isNew ? "New Preset" : `Edit: ${presetName}`;
  $("presetNameInput").value        = isNew ? "" : presetName;
  $("presetNameInput").disabled     = !isNew; // renaming not supported to keep references clean
  $("presetNameError").style.display = "none";
  $("presetNameError").textContent   = "";

  // Build input fields dynamically
  const grid = $("presetFormFields");
  grid.innerHTML = "";
  PRESET_FIELD_CONFIG.forEach(cfg => {
    const fieldDiv = document.createElement("div");
    fieldDiv.className = "field";
    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = `pef_${cfg.key}`;
    label.textContent = cfg.label;

    const wrap = document.createElement("div");
    wrap.className = "pef-wrap" + (cfg.prefix ? " has-prefix" : "");

    const inp = document.createElement("input");
    inp.type = "number"; inp.step = cfg.step; inp.min = cfg.min; inp.max = cfg.max;
    inp.id = `pef_${cfg.key}`;

    // Display as percentage number or raw dollar
    const rawVal = p[cfg.key];
    if (cfg.pct) {
      const pctVal = rawVal * 100;
      inp.value = parseFloat(pctVal.toFixed(4)); // avoid floating point noise
    } else {
      inp.value = rawVal;
    }

    if (cfg.prefix) {
      const pfx = document.createElement("span");
      pfx.className = "pef-prefix"; pfx.textContent = cfg.prefix;
      wrap.appendChild(pfx);
    } else if (cfg.pct) {
      const sfx = document.createElement("span");
      sfx.className = "pef-suffix"; sfx.textContent = "%";
      wrap.appendChild(sfx);
    }
    wrap.appendChild(inp);
    fieldDiv.append(label, wrap);
    grid.appendChild(fieldDiv);
  });

  $("presetMainSection").classList.add("off");
  $("presetEditSection").classList.add("on");
}

$("savePresetBtn").addEventListener("click", () => {
  const isNew = editingPreset === null;
  const name = $("presetNameInput").value.trim();

  if (!name) {
    $("presetNameError").textContent = "Please enter a preset name.";
    $("presetNameError").style.display = "block"; return;
  }
  if (isNew && assumptionPresets.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    $("presetNameError").textContent = "A preset with this name already exists.";
    $("presetNameError").style.display = "block"; return;
  }
  $("presetNameError").style.display = "none";

  // Collect and validate field values
  const newPreset = { name };
  let valid = true;
  PRESET_FIELD_CONFIG.forEach(cfg => {
    const inp = $(`pef_${cfg.key}`);
    const val = parseFloat(inp.value);
    if (isNaN(val)) { inp.classList.add("err"); valid = false; return; }
    inp.classList.remove("err");
    newPreset[cfg.key] = cfg.pct ? val / 100 : val;
  });
  if (!valid) return;

  if (isNew) {
    assumptionPresets.push(newPreset);
  } else {
    const idx = assumptionPresets.findIndex(p => p.name === editingPreset);
    if (idx >= 0) assumptionPresets[idx] = newPreset;
  }

  settingsSelected = name;
  savePresetsStorage();
  renderSettingsList();
});

$("cancelPresetBtn").addEventListener("click", () => {
  $("presetMainSection").classList.remove("off");
  $("presetEditSection").classList.remove("on");
});

function deletePreset(name) {
  if (name === defaultPresetName) return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  assumptionPresets = assumptionPresets.filter(p => p.name !== name);
  if (settingsSelected   === name) settingsSelected   = defaultPresetName;
  if (searchActivePreset === name) searchActivePreset = defaultPresetName;
  savePresetsStorage();
  renderSettingsList();
}

// "Save as Default" — sets currently selected preset as the default + active for searches
$("saveProfileBtn").addEventListener("click", () => {
  defaultPresetName  = settingsSelected;
  searchActivePreset = settingsSelected;
  savePresetsStorage();
  renderSettingsList();
  const btn = $("saveProfileBtn");
  const orig = btn.textContent;
  btn.textContent = "Saved ✓";
  setTimeout(() => { btn.textContent = orig; }, 1500);
});

// ── Init ───────────────────────────────────────────────────────────────────────
buildMatrix();
loadSettings();
wireUSDInputs();


// ── Intercept chrome.storage saves for 2-way sync ──
(function() {
  var origLocalSet = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = function(items, cb) {
    if (items.search_templates && typeof pushTemplatesToServer === 'function') {
      pushTemplatesToServer(items.search_templates);
    }
    if (items.assumption_presets && typeof pushPresetsToServer === 'function') {
      try {
        var parsed = typeof items.assumption_presets === 'string' ? JSON.parse(items.assumption_presets) : items.assumption_presets;
        pushPresetsToServer(parsed);
      } catch(e) {}
    }
    return origLocalSet(items, cb);
  };
})();
