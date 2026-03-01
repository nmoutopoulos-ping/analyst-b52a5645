/**
 * RentCast Comps v1.1 — Apps Script Backend
 *
 * GET ?action=geocode&address=...        → { lat, lng, formatted }
 * GET ?action=search&...                 → { success, searchId, message, lat, lng, address }
 * GET ?action=getNewSearches             → { rows: [...] }
 * GET ?action=updateStatus&searchId=...&status=... → { success, updated }
 *
 * Deploy: Execute as Me | Who has access: Anyone
 */

const SHEET_NAME = "Saved Searches";

// Column index map (1-based)
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
};

// ── Entry Point ───────────────────────────────────────────────────────────────

function doGet(e) {
  const p      = (e && e.parameter) || {};
  const action = p.action || "search";
  if (action === "geocode")        return handleGeocode(p);
  if (action === "search")         return handleSearch(p);
  if (action === "getNewSearches") return handleGetNewSearches();
  if (action === "updateStatus")   return handleUpdateStatus(p);
  return jsonResponse({ error: "Unknown action." });
}

// ── Geocode ───────────────────────────────────────────────────────────────────

function handleGeocode(p) {
  try {
    if (!p.address) throw new Error("No address provided.");
    const result = Maps.newGeocoder().geocode(p.address);
    const loc    = result.results[0];
    if (!loc) throw new Error("Address not found.");
    return jsonResponse({
      lat:       loc.geometry.location.lat,
      lng:       loc.geometry.location.lng,
      formatted: loc.formatted_address,
    });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Search / Log ──────────────────────────────────────────────────────────────

function handleSearch(p) {
  try {
    const userEmail  = p.userEmail  || "";
    const address    = p.address    || "";
    const totalUnits = p.totalUnits || "";
    const price      = p.price      || "";
    const cost       = p.cost       || "";
    const sqft       = p.sqft       || "";
    const radius     = p.radius     || "";
    const minComps   = p.minComps   || "";
    const maxComps   = p.maxComps   || "";
    const status     = p.status     || "";
    const combos     = JSON.parse(p.combos || "[]");

    if (!userEmail)          throw new Error("Missing email.");
    if (!address)            throw new Error("Missing address.");
    if (!totalUnits)         throw new Error("Missing total units.");
    if (combos.length === 0) throw new Error("No unit mix selected.");
    if (combos.length > 5)   throw new Error("Max 5 unit mix combos allowed.");

    // Use pre-resolved coords if sent, otherwise geocode
    let lat = parseFloat(p.lat) || null;
    let lng = parseFloat(p.lng) || null;
    let formattedAddress = address;

    if (!lat || !lng) {
      const result = Maps.newGeocoder().geocode(address);
      const loc    = result.results[0];
      if (!loc) throw new Error("Could not geocode address: " + address);
      lat              = loc.geometry.location.lat;
      lng              = loc.geometry.location.lng;
      formattedAddress = loc.formatted_address;
    }

    const sheet     = getOrCreateSheet();
    const searchId  = generateSearchId(sheet);
    const timestamp = new Date().toISOString();

    const rows = combos.map(combo => [
      searchId, timestamp, userEmail, formattedAddress,
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

    Logger.log(`[${searchId}] Logged ${rows.length} combo(s) for "${formattedAddress}"`);

    return jsonResponse({
      success: true, searchId, lat, lng,
      address: formattedAddress,
      message: `Saved ${rows.length} combo(s) as ${searchId}.`,
    });

  } catch (err) {
    Logger.log("Error: " + err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── Search ID ─────────────────────────────────────────────────────────────────

function generateSearchId(sheet) {
  const today    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  const prefix   = `SRCH-${today}-`;
  const lastRow  = sheet.getLastRow();
  let count = 0;
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    count = ids.filter(id => String(id).startsWith(prefix)).length;
  }
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

// ── Sheet Setup ───────────────────────────────────────────────────────────────

function getOrCreateSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = [
      "Search ID", "Timestamp", "Email", "Address", "Latitude", "Longitude",
      "Radius (mi)", "Min Comps", "Max Comps", "Status", "Total Units",
      "Price", "Cost", "Building SqFt",
      "Beds", "Baths", "Type", "Run Status", "Normal Time",
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 155);
    sheet.setColumnWidth(2, 190);
    sheet.setColumnWidth(3, 190);
    sheet.setColumnWidth(4, 220);
    sheet.setColumnWidth(19, 200); // Normal Time
  } else {
    migrateSheetIfNeeded(sheet);
  }
  return sheet;
}

// ── Sheet Migration ────────────────────────────────────────────────────────────

function migrateSheetIfNeeded(sheet) {
  let headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Step 1 — Add Price & Cost after Total Units (col 11) if missing
  if (headerRow.indexOf("Price") === -1) {
    sheet.insertColumnsAfter(11, 2);
    sheet.getRange(1, 12).setValue("Price");
    sheet.getRange(1, 13).setValue("Cost");
    sheet.getRange(1, 12, 1, 2)
      .setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
    // Re-read headers so Step 2 sees the updated layout
    headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    Logger.log("Migrated: Added Price and Cost columns.");
  }

  // Step 2 — Add Building SqFt after Cost (col 13) if missing
  if (headerRow.indexOf("Building SqFt") === -1) {
    sheet.insertColumnsAfter(13, 1);
    sheet.getRange(1, 14).setValue("Building SqFt");
    sheet.getRange(1, 14)
      .setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
    Logger.log("Migrated: Added Building SqFt column.");
  }

  // Step 3 — Delete API Status column so it stays writable in the destination sheet
  const finalHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const apiStatusCol = finalHeaders.indexOf("API Status"); // 0-based
  if (apiStatusCol !== -1) {
    sheet.deleteColumn(apiStatusCol + 1); // convert to 1-based
    Logger.log("Migrated: Removed API Status column — manage it in the destination sheet at col U.");
  }

  // Fix width for Normal Time (now at col 19 after API Status removed)
  sheet.setColumnWidth(19, 200); // Normal Time
}

// ── Get New Searches (for Python pipeline) ────────────────────────────────────

function handleGetNewSearches() {
  try {
    const sheet   = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse({ rows: [] });

    const data = sheet.getRange(2, 1, lastRow - 1, Object.keys(COL).length).getValues();
    const rows = [];

    data.forEach((row, i) => {
      if (String(row[COL.RUN_STATUS - 1]).trim() === "NEW") {
        rows.push({
          rowIndex:   i + 2,         // 1-based sheet row
          searchId:   row[COL.SEARCH_ID   - 1],
          timestamp:  row[COL.TIMESTAMP   - 1],
          email:      row[COL.EMAIL       - 1],
          address:    row[COL.ADDRESS     - 1],
          lat:        row[COL.LAT         - 1],
          lng:        row[COL.LNG         - 1],
          radius:     row[COL.RADIUS      - 1],
          minComps:   row[COL.MIN_COMPS   - 1],
          maxComps:   row[COL.MAX_COMPS   - 1],
          status:     row[COL.STATUS      - 1],
          totalUnits: row[COL.TOTAL_UNITS - 1],
          price:      row[COL.PRICE       - 1],
          cost:       row[COL.COST        - 1],
          sqft:       row[COL.SQFT        - 1],
          beds:       row[COL.BEDS        - 1],
          baths:      row[COL.BATHS       - 1],
          type:       row[COL.TYPE        - 1],
        });
      }
    });

    return jsonResponse({ rows });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Update Row Status (called by Python after processing) ─────────────────────

function handleUpdateStatus(p) {
  try {
    const searchId  = p.searchId  || "";
    const newStatus = p.status    || "DONE";
    if (!searchId) throw new Error("Missing searchId.");

    const sheet   = getOrCreateSheet();
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
    return jsonResponse({ error: err.message });
  }
}

// ── Test Helper (run this from the editor to test) ────────────────────────────

function testSearch() {
  const result = doGet({ parameter: {
    action:    "search",
    userEmail: "test@example.com",
    address:   "884 Lancaster St, Albany, NY 12203",
    radius:    "1",
    minComps:  "10",
    maxComps:  "20",
    status:    "Active",
    totalUnits: "12",
    combos:    JSON.stringify([{ beds: 2, baths: 1, type: "Duplex" }]),
  }});
  Logger.log(result.getContent());
}

// ── Helper ────────────────────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
