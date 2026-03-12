/**
 * Ping Analyst v1.2 — Apps Script Backend
 * ------------------------------------------
 * Deploy this as a STANDALONE script under nikomoutop10@gmail.com
 * (NOT bound to a sheet). Set SPREADSHEET_ID below.
 *
 * The sheet stays on pingpayments.org — this script writes to it
 * by opening it via ID. The pingpayments.org sheet must be shared
 * as "Anyone with the link can edit" OR shared directly with
 * nikomoutop10@gmail.com as an Editor.
 *
 * Deploy settings:
 *   Execute as: Me (nikomoutop10@gmail.com)
 *   Who has access: Anyone
 *
 * GET ?action=search&...     → { success, searchId, message, lat, lng, address }
 * GET ?action=updateStatus&... → { success, updated }
 *
 * NOTE: Geocoding is now handled by the extension (OpenStreetMap).
 *       The extension sends pre-resolved lat/lng with every search request.
 */

// ── CONFIGURE THIS ────────────────────────────────────────────────────────────

const SPREADSHEET_ID  = "1sM5B_pi9Kqjymv-p7FUItNgR3zL0CoNxZup7TjDwrf4";
const SHEET_NAME      = "Saved Searches";
const USERS_SHEET_NAME = "Users Import";

// Column index map (1-based) — must match sheet column order exactly
const COL = {
  SEARCH_ID:   1,
  TIMESTAMP:   2,
  EMAIL:       3,
  ADDRESS:     4,
  LAT:         5,
  LNG:         6,
  RADIUS:      7,
  MIN_COMPS:   8,
  MAX_COMPS:   9,
  STATUS:      10,
  TOTAL_UNITS: 11,
  PRICE:       12,
  COST:        13,
  SQFT:        14,
  BEDS:        15,
  BATHS:       16,
  TYPE:        17,
  RUN_STATUS:  18,
  NORMAL_TIME: 19,
  UNITS:       20,
  COMMERCIAL:  21,  // JSON array of commercial space objects (written on first combo row only)
};

// ── Entry Point ───────────────────────────────────────────────────────────────

function doGet(e) {
  const p      = (e && e.parameter) || {};
  const action = p.action || "search";
  if (action === "search")       return handleSearch(p);
  if (action === "updateStatus") return handleUpdateStatus(p);
  return jsonResponse({ error: "Unknown action: " + action });
}

// ── Search / Log ──────────────────────────────────────────────────────────────

function handleSearch(p) {
  try {
    const userEmail = p.userEmail || "";
    const address   = p.address   || "";
    const price     = p.price     || "";
    const cost      = p.cost      || "";
    const sqft      = p.sqft      || "";
    const radius    = p.radius    || "";
    const minComps  = p.minComps  || "";
    const maxComps  = p.maxComps  || "";
    const status    = p.status    || "";
    const lat       = parseFloat(p.lat) || "";
    const lng       = parseFloat(p.lng) || "";
    const combos     = JSON.parse(p.combos     || "[]");
    const commercial = JSON.parse(p.commercial || "[]");

    // Derive totalUnits from per-combo unit counts
    const totalUnits = combos.reduce((s, c) => s + (Number(c.units) || 0), 0);

    if (!userEmail)             throw new Error("Missing email.");
    if (!address)               throw new Error("Missing address.");
    if (!lat || !lng)           throw new Error("Missing coordinates — extension geocoding may have failed.");
    if (combos.length === 0)    throw new Error("No unit mix selected.");
    if (combos.length > 5)      throw new Error("Max 5 unit mix combos allowed.");
    if (commercial.length > 5)  throw new Error("Max 5 commercial spaces allowed.");
    if (totalUnits === 0)       throw new Error("Total units cannot be 0 — enter units for each type.");

    // ── Rate Limit Enforcement ─────────────────────────────────────────────
    const rateCheck = checkRateLimit(userEmail, combos.length);
    if (!rateCheck.allowed) throw new Error(rateCheck.reason);
    // ──────────────────────────────────────────────────────────────────────

    const sheet     = openSheet();
    const searchId  = generateSearchId(sheet);
    const timestamp = new Date().toISOString();

    const rows = combos.map(combo => [
      searchId, timestamp, userEmail, address,
      lat, lng, radius, minComps, maxComps, status, totalUnits,
      price, cost, sqft,
      combo.beds, combo.baths, combo.type, "NEW",
    ]);

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

    // Green "NEW" highlight (col 18 = Run Status)
    sheet.getRange(startRow, 18, rows.length, 1)
      .setBackground("#00c853").setFontColor("#ffffff").setFontWeight("bold");

    // Normal Time formula in col 19 (UTC → ET)
    for (let i = 0; i < rows.length; i++) {
      const r = startRow + i;
      sheet.getRange(r, 19).setFormula(
        `=IFERROR(TEXT(DATEVALUE(LEFT(B${r},10))+TIMEVALUE(MID(B${r},12,8))-5/24,"MMM DD, YYYY HH:MM:SS AM/PM"),"")`
      );
    }

    // Units per combo in col 20
    for (let i = 0; i < rows.length; i++) {
      const r = startRow + i;
      sheet.getRange(r, COL.UNITS).setValue(Number(combos[i].units) || 0);
    }

    // Commercial spaces JSON in col 21 — stored on the first row only (property-level data)
    if (commercial.length > 0) {
      sheet.getRange(startRow, COL.COMMERCIAL).setValue(JSON.stringify(commercial));
    }

    Logger.log(`[${searchId}] Logged ${rows.length} combo(s) for "${address}" (${commercial.length} commercial space(s))`);

    // Notify admin of new submission
    sendPingSubmissionEmail({ searchId, userEmail, address, combos, totalUnits });

    return jsonResponse({
      success: true, searchId, lat, lng,
      address: address,
      message: `Saved ${rows.length} combo(s) as ${searchId}.`,
    });

  } catch (err) {
    Logger.log("Error in handleSearch: " + err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── Update Row Status (called by Python after processing) ─────────────────────

function handleUpdateStatus(p) {
  try {
    const searchId  = p.searchId  || "";
    const newStatus = p.status    || "DONE";
    if (!searchId) throw new Error("Missing searchId.");

    const sheet   = openSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse({ success: false, updated: 0 });

    const ids     = sheet.getRange(2, COL.SEARCH_ID, lastRow - 1, 1).getValues().flat();
    let   updated = 0;

    ids.forEach((id, i) => {
      if (String(id).trim() === searchId) {
        const cell = sheet.getRange(i + 2, COL.RUN_STATUS);
        cell.setValue(newStatus);
        if (newStatus === "DONE") {
          cell.setBackground("#1565c0").setFontColor("#ffffff").setFontWeight("bold");
        } else if (newStatus === "ERROR") {
          cell.setBackground("#b71c1c").setFontColor("#ffffff").setFontWeight("bold");
        } else if (newStatus === "PROCESSING") {
          cell.setBackground("#f57f17").setFontColor("#ffffff").setFontWeight("bold");
        }
        updated++;
      }
    });

    return jsonResponse({ success: true, updated });
  } catch (err) {
    Logger.log("Error in handleUpdateStatus: " + err.message);
    return jsonResponse({ error: err.message });
  }
}

// ── Rate Limit Check ──────────────────────────────────────────────────────────

/**
 * Checks whether userEmail is registered and has enough remaining tokens
 * to cover the requested number of API calls (callsNeeded).
 *
 * Reads the "Users Import" sheet:
 *   Col A = Email
 *   Col G = Remaining Tokens  (computed by sheet formulas — read-only here)
 *
 * Returns { allowed: true } on pass, or { allowed: false, reason: "..." } on fail.
 */
function checkRateLimit(userEmail, callsNeeded) {
  const ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);

  if (!usersSheet) {
    // If the sheet doesn't exist yet, fail safe rather than open to everyone
    return { allowed: false, reason: "Users sheet not found. Contact support." };
  }

  const lastRow = usersSheet.getLastRow();
  if (lastRow < 2) {
    return { allowed: false, reason: "Failed: Not Registered" };
  }

  // Read cols A (email) and G (remaining tokens) for all data rows
  const data = usersSheet.getRange(2, 1, lastRow - 1, 7).getValues();

  for (let i = 0; i < data.length; i++) {
    const rowEmail = String(data[i][0]).trim().toLowerCase();
    if (rowEmail === userEmail.trim().toLowerCase()) {
      // User found — check token balance
      const remainingTokens = Number(data[i][6]); // col G is index 6 (0-based)
      if (callsNeeded > remainingTokens) {
        return {
          allowed: false,
          reason: `Insufficient Token Balance (need ${callsNeeded}, have ${remainingTokens}).`,
        };
      }
      return { allowed: true };
    }
  }

  // Email not found in Users Import
  return { allowed: false, reason: "Failed: Not Registered" };
}

// ── Sheet Access ──────────────────────────────────────────────────────────────

function openSheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "YOUR_SHEET_ID_HERE") {
    throw new Error("SPREADSHEET_ID not set. Edit apps-script.gs and paste your Sheet ID.");
  }
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);

  // Auto-create the tab with headers if it doesn't exist yet
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = [
      "Search ID", "Timestamp", "Email", "Address", "Latitude", "Longitude",
      "Radius (mi)", "Min Comps", "Max Comps", "Status", "Total Units",
      "Price", "Cost", "Building SqFt",
      "Beds", "Baths", "Type", "Run Status", "Normal Time", "Units", "Commercial Spaces",
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,  155);
    sheet.setColumnWidth(2,  190);
    sheet.setColumnWidth(3,  190);
    sheet.setColumnWidth(4,  220);
    sheet.setColumnWidth(19, 200);
    Logger.log(`Created "${SHEET_NAME}" tab with headers.`);
  }

  return sheet;
}

// ── Search ID Generator ───────────────────────────────────────────────────────

function generateSearchId(sheet) {
  const today  = Utilities.formatDate(new Date(), "America/New_York", "yyyyMMdd");
  const prefix = `SRCH-${today}-`;
  const lastRow = sheet.getLastRow();
  let count = 0;
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    count = ids.filter(id => String(id).startsWith(prefix)).length;
  }
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Email Notification ────────────────────────────────────────────────────────

/**
 * Sends a notification email to the admin when a new search is submitted.
 * Called from handleSearch() after rows are written to the sheet.
 */
function sendPingSubmissionEmail(payload) {
  const EMAIL_TO = "nmoutopoulos@pingpayments.org";
  try {
    const searchId   = payload.searchId   || "";
    const userEmail  = payload.userEmail  || "";
    const address    = payload.address    || "";
    const combos     = payload.combos     || [];
    const totalUnits = payload.totalUnits || 0;

    const unitMixLines = combos.map(c =>
      `  • ${c.units || "?"} unit(s) — ${c.beds}bd/${c.baths}ba (${c.type})`
    ).join("\n");

    const message =
`New Ping Analyst Submission
Search ID:   ${searchId}
User Email:  ${userEmail}
Address:     ${address}
Total Units: ${totalUnits}

Unit Mix:
${unitMixLines}

Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET
`;

    MailApp.sendEmail({
      to:      EMAIL_TO,
      subject: `Ping Analyst — New Search: ${address} (${searchId})`,
      body:    message,
    });
    Logger.log(`[${searchId}] Notification email sent to ${EMAIL_TO}`);
  } catch (err) {
    Logger.log(`[${payload.searchId}] Email notification failed: ${err.message}`);
  }
}

// ── Quick Test (run from editor to verify sheet access) ───────────────────────

function testSheetAccess() {
  try {
    const sheet = openSheet();
    Logger.log(`✅ Sheet found: "${sheet.getName()}" — ${sheet.getLastRow()} rows`);
  } catch (e) {
    Logger.log(`❌ ${e.message}`);
  }
}
