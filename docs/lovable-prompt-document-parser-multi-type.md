# Lovable Prompt — Document Parser: Add OM & PSA Support

> Paste everything below the dotted line into Lovable's chat as a single message.

---

# Document Parser — Support for Offering Memorandums & Purchase/Sale Agreements

The Lease Parser page currently only handles lease documents. I want to expand it to support three document types: **Leases**, **Offering Memorandums (OMs)**, and **Purchase & Sale Agreements (PSAs)**. The backend already supports a new endpoint — this prompt updates the frontend only.

## What changed on the backend

**New endpoint:** `POST /api/parse-document` (on `https://analyst-docker.onrender.com`)
- Accepts `multipart/form-data` with two fields:
  - `file` — the uploaded document (same as before)
  - `document_type` — one of `"lease"`, `"om"`, or `"psa"`
- Returns: `{ ok: true, document_type: "om", parsed: { ... }, usage: { ... } }`
- Auth: same as `/api/parse-lease` (Bearer JWT or X-Api-Key)

**Old endpoint** `/api/parse-lease` still works unchanged — no need to touch the "Saved Leases" logic that uses it.

**Database:** The `lease_extractions` table now has two new columns:
- `document_type` (text, defaults to `"lease"`) — filter saved docs by type
- `parsed_data` (jsonb) — stores the full parsed output for all doc types

## Changes required

### 1. Page title and subtitle

Change:
- Title: "Lease Parser" → **"Document Parser"**
- Subtitle: "Upload up to 20 lease documents and we'll extract key terms, tenant info, rent structure, and more." → **"Upload up to 20 documents and we'll extract key terms, financials, deal structure, and more."**

Keep the nav item label as "Documents" (it was already renamed in the sidebar redesign).

### 2. "Parse New" tab — Add document type selector

Above the file upload zone, add a **segmented control** (three buttons in a row) for choosing the document type. Use shadcn `ToggleGroup` or a custom button group:

```
[ Lease ]  [ Offering Memorandum ]  [ Purchase & Sale ]
```

- Default selection: **Lease**
- Selection determines which `document_type` value is sent to the API
- Values: `"lease"`, `"om"`, `"psa"`
- Style: pills/segments with the active one highlighted in the brand blue (#3B82F6), inactive ones in muted gray border

When the selection changes:
- Clear any queued files (since the user is switching contexts)
- Update the "What gets extracted?" info box at the bottom (see section 4)

### 3. API call change

When the user clicks the parse button, instead of calling:
```
POST https://analyst-docker.onrender.com/api/parse-lease
Body: FormData { file }
```

Call the new endpoint:
```
POST https://analyst-docker.onrender.com/api/parse-document
Body: FormData { file, document_type }
```

The `document_type` comes from the segmented control selection.

**Important:** Append `document_type` to the FormData alongside the file:
```ts
const formData = new FormData();
formData.append("file", file);
formData.append("document_type", selectedDocType); // "lease" | "om" | "psa"
```

The response shape is the same as before (`{ ok, parsed, usage }`) plus an extra `document_type` field.

### 4. "What gets extracted?" info box

Update the info box content based on the selected document type:

**Lease (default):**
> Each lease is parsed for 24 key fields including tenant info, property details, lease terms, rent structure, expense allocation, renewal/termination options, and extraction confidence scores.

**Offering Memorandum:**
> Each OM is parsed for 32 key fields including property overview, unit mix, financial summary (NOI, cap rate, expenses), rent roll highlights, proposed financing, projected returns, and extraction confidence scores.

**Purchase & Sale:**
> Each PSA is parsed for 28 key fields including buyer/seller info, purchase price, earnest money, due diligence period, financing contingency, closing details, legal provisions, and extraction confidence scores.

### 5. Parse results display

When results come back, the parsed fields will differ by document type. The existing result display shows fields organized by section. Update the section/field mapping to handle all three types:

```ts
// Field schemas by document type
const FIELD_SCHEMAS: Record<string, Record<string, { label: string; section: string; isArray?: boolean }>> = {
  lease: {
    tenant_name:                  { label: "Tenant Name",              section: "Tenant Info" },
    tenant_entity_type:           { label: "Entity Type",              section: "Tenant Info" },
    guarantor_name:               { label: "Guarantor Name",           section: "Tenant Info" },
    property_address:             { label: "Property Address",         section: "Property" },
    unit_number:                  { label: "Unit Number",              section: "Property" },
    asset_class:                  { label: "Asset Class",              section: "Property" },
    lease_start_date:             { label: "Lease Start Date",         section: "Lease Terms" },
    lease_end_date:               { label: "Lease End Date",           section: "Lease Terms" },
    lease_term_months:            { label: "Lease Term (months)",      section: "Lease Terms" },
    base_rent_monthly:            { label: "Base Rent (monthly)",      section: "Rent" },
    base_rent_annual:             { label: "Base Rent (annual)",       section: "Rent" },
    rent_escalation_type:         { label: "Escalation Type",          section: "Rent" },
    rent_escalation_value:        { label: "Escalation Value",         section: "Rent" },
    free_rent_months:             { label: "Free Rent (months)",       section: "Rent" },
    security_deposit:             { label: "Security Deposit",         section: "Rent" },
    expense_structure:            { label: "Expense Structure",        section: "Expenses" },
    tenant_responsible_expenses:  { label: "Tenant Responsible",       section: "Expenses", isArray: true },
    landlord_responsible_expenses:{ label: "Landlord Responsible",     section: "Expenses", isArray: true },
    tenant_improvement_allowance: { label: "Tenant Improvement",       section: "Expenses" },
    renewal_options:              { label: "Renewal Options",          section: "Options" },
    termination_option:           { label: "Termination Option",       section: "Options" },
    termination_notice_months:    { label: "Termination Notice (mo)",  section: "Options" },
    commencement_conditions:      { label: "Commencement Conditions",  section: "Options" },
    notes:                        { label: "Notes",                    section: "Confidence" },
  },

  om: {
    property_name:          { label: "Property Name",           section: "Property Overview" },
    property_address:       { label: "Property Address",        section: "Property Overview" },
    asset_class:            { label: "Asset Class",             section: "Property Overview" },
    property_type:          { label: "Property Type",           section: "Property Overview" },
    year_built:             { label: "Year Built",              section: "Property Overview" },
    year_renovated:         { label: "Year Renovated",          section: "Property Overview" },
    lot_size_acres:         { label: "Lot Size (acres)",        section: "Property Overview" },
    building_sf:            { label: "Building SF",             section: "Property Overview" },
    total_units:            { label: "Total Units",             section: "Property Overview" },
    unit_mix:               { label: "Unit Mix",                section: "Property Overview", isArray: true },
    occupancy_rate:         { label: "Occupancy Rate",          section: "Property Overview" },
    amenities:              { label: "Amenities",               section: "Property Overview", isArray: true },
    asking_price:           { label: "Asking Price",            section: "Financials" },
    price_per_unit:         { label: "Price / Unit",            section: "Financials" },
    price_per_sf:           { label: "Price / SF",              section: "Financials" },
    cap_rate:               { label: "Cap Rate",                section: "Financials" },
    noi:                    { label: "NOI",                     section: "Financials" },
    effective_gross_income: { label: "Effective Gross Income",   section: "Financials" },
    operating_expenses:     { label: "Operating Expenses",      section: "Financials" },
    expense_ratio:          { label: "Expense Ratio",           section: "Financials" },
    gross_rent_multiplier:  { label: "GRM",                     section: "Financials" },
    average_rent_per_unit:  { label: "Avg Rent / Unit",         section: "Income" },
    market_rent_per_unit:   { label: "Market Rent / Unit",      section: "Income" },
    rent_growth_potential:  { label: "Rent Growth Potential",    section: "Income" },
    other_income:           { label: "Other Income",            section: "Income" },
    vacancy_loss:           { label: "Vacancy Loss",            section: "Income" },
    proposed_financing:     { label: "Proposed Financing",      section: "Returns" },
    loan_to_value:          { label: "Loan-to-Value",           section: "Returns" },
    debt_service:           { label: "Debt Service",            section: "Returns" },
    cash_on_cash_return:    { label: "Cash-on-Cash Return",     section: "Returns" },
    projected_irr:          { label: "Projected IRR",           section: "Returns" },
    seller_broker:          { label: "Seller / Broker",         section: "Context" },
    notes:                  { label: "Notes",                   section: "Confidence" },
  },

  psa: {
    buyer_name:                 { label: "Buyer Name",               section: "Parties" },
    buyer_entity_type:          { label: "Buyer Entity Type",        section: "Parties" },
    seller_name:                { label: "Seller Name",              section: "Parties" },
    seller_entity_type:         { label: "Seller Entity Type",       section: "Parties" },
    property_address:           { label: "Property Address",         section: "Property" },
    legal_description:          { label: "Legal Description",        section: "Property" },
    asset_class:                { label: "Asset Class",              section: "Property" },
    property_type:              { label: "Property Type",            section: "Property" },
    purchase_price:             { label: "Purchase Price",           section: "Deal Terms" },
    earnest_money_deposit:      { label: "Earnest Money Deposit",    section: "Deal Terms" },
    additional_deposit:         { label: "Additional Deposit",       section: "Deal Terms" },
    deposit_escrow_agent:       { label: "Escrow Agent",             section: "Deal Terms" },
    closing_date:               { label: "Closing Date",             section: "Deal Terms" },
    due_diligence_period_days:  { label: "Due Diligence (days)",     section: "Deal Terms" },
    due_diligence_expiration:   { label: "DD Expiration",            section: "Deal Terms" },
    financing_contingency:      { label: "Financing Contingency",    section: "Deal Terms" },
    financing_type:             { label: "Financing Type",           section: "Deal Terms" },
    loan_amount:                { label: "Loan Amount",              section: "Deal Terms" },
    inspection_contingency:     { label: "Inspection Contingency",   section: "Deal Terms" },
    title_company:              { label: "Title Company",            section: "Legal" },
    closing_costs_allocation:   { label: "Closing Costs",            section: "Legal" },
    prorations:                 { label: "Prorations",               section: "Legal" },
    representations_warranties: { label: "Reps & Warranties",        section: "Legal" },
    default_remedies_buyer:     { label: "Default (Buyer)",          section: "Legal" },
    default_remedies_seller:    { label: "Default (Seller)",         section: "Legal" },
    assignment_rights:          { label: "Assignment Rights",        section: "Legal" },
    governing_law:              { label: "Governing Law",            section: "Legal" },
    notes:                      { label: "Notes",                    section: "Confidence" },
  },
};
```

Use the `document_type` from the API response to pick the right schema when rendering results. The result card should show a small badge/tag indicating the document type (e.g., "Lease", "OM", "PSA") in the top-right corner.

### 6. "Saved Leases" tab → "Saved Documents"

- Rename the tab label from "Saved Leases" to **"Saved Documents"**
- When querying saved documents from Supabase, the query should now include a filter or show the `document_type`:
  ```ts
  // Before:
  supabase.from("lease_extractions").select("*").eq("api_key", apiKey)
  // After (show all types):
  supabase.from("lease_extractions").select("*").eq("api_key", apiKey).order("created_at", { ascending: false })
  ```
- Add filter chips at the top of the saved list: **All** | **Leases** | **OMs** | **PSAs**
  - "All" is default
  - Clicking a chip filters by `document_type`
- Each saved document card should show a type badge:
  - Lease → gray badge
  - OM → blue badge
  - PSA → amber/orange badge

### 7. Saving to Supabase

When saving a parsed document to `lease_extractions`, add the new columns:

```ts
// Before (lease only):
const insertData = {
  api_key: apiKey,
  filename: file.name,
  file_size: file.size,
  ...parsedFields,       // spread 24 lease fields directly
  confidently_extracted: parsed.confidence,
  notes: parsed.notes,
  prompt_tokens: usage.prompt_tokens,
  completion_tokens: usage.completion_tokens,
  estimated_cost: usage.estimated_cost,
};

// After (all types):
const insertData = {
  api_key: apiKey,
  filename: file.name,
  file_size: file.size,
  document_type: documentType,     // NEW: "lease", "om", or "psa"
  parsed_data: parsed,             // NEW: full parsed JSON
  // For leases, still spread the individual columns for backward compat:
  ...(documentType === "lease" ? {
    tenant_name: parsed.tenant_name,
    tenant_entity_type: parsed.tenant_entity_type,
    property_address: parsed.property_address,
    unit_number: parsed.unit_number,
    asset_class: parsed.asset_class,
    lease_start_date: parsed.lease_start_date,
    lease_end_date: parsed.lease_end_date,
    lease_term_months: parsed.lease_term_months,
    base_rent_monthly: parsed.base_rent_monthly,
    base_rent_annual: parsed.base_rent_annual,
    rent_escalation_type: parsed.rent_escalation_type,
    rent_escalation_value: parsed.rent_escalation_value,
    free_rent_months: parsed.free_rent_months,
    security_deposit: parsed.security_deposit,
    expense_structure: parsed.expense_structure,
    tenant_responsible_expenses: parsed.tenant_responsible_expenses,
    landlord_responsible_expenses: parsed.landlord_responsible_expenses,
    tenant_improvement_allowance: parsed.tenant_improvement_allowance,
    renewal_options: parsed.renewal_options,
    termination_option: parsed.termination_option,
    termination_notice_months: parsed.termination_notice_months,
    guarantor_name: parsed.guarantor_name,
    commencement_conditions: parsed.commencement_conditions,
  } : {}),
  confidently_extracted: parsed.confidence,
  notes: parsed.notes,
  prompt_tokens: usage.prompt_tokens,
  completion_tokens: usage.completion_tokens,
  estimated_cost: usage.estimated_cost,
};
```

### 8. Reading saved documents

When displaying a saved document from the "Saved Documents" tab:
- For **lease** documents: read from the individual columns (backward compat) OR from `parsed_data`
- For **om** and **psa** documents: read from the `parsed_data` JSONB column
- Use the `document_type` column to pick the right field schema for display

```ts
function getDisplayData(extraction: any) {
  const docType = extraction.document_type || "lease";
  
  if (docType === "lease" && !extraction.parsed_data) {
    // Legacy lease: fields are in individual columns
    return { docType, parsed: extraction };
  }
  
  // New format: everything in parsed_data
  return { docType, parsed: extraction.parsed_data || extraction };
}
```

## Empty state update

Change the empty state on the "Saved Documents" tab:
- Old: "No saved leases yet. Parse some leases and save them to build your library."
- New: **"No saved documents yet. Parse leases, OMs, or PSAs to build your library."**
- Button: "Parse New Leases" → **"Parse New Documents"**

## Files to change

Likely:
1. The Documents page component (wherever the Lease Parser page lives)
2. Any hooks or API functions related to lease parsing
3. Any types/interfaces for lease extraction data

## Acceptance criteria

1. The page title reads "Document Parser" with updated subtitle.
2. The "Parse New" tab shows a 3-option segmented control: Lease | Offering Memorandum | Purchase & Sale.
3. Selecting a type updates the "What gets extracted?" info box.
4. Uploading a file sends `document_type` in the FormData to `/api/parse-document`.
5. Results display with the correct field labels/sections for the selected document type.
6. Each result card shows a doc-type badge.
7. The "Saved Documents" tab shows all document types with filter chips.
8. Saving includes `document_type` and `parsed_data` columns.
9. Old lease data (without `document_type`) still displays correctly.
10. No regressions — the lease parsing flow works identically to before.

List every file you touched so I can review.
