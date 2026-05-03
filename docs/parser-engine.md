# Parser Engine Architecture — Ping Analyst

> **Purpose:** Formal reference for the document parsing subsystem. Read this before making any changes to the parser, adding new document types, or debugging extraction issues.

---

## Overview

The parser engine extracts structured data from commercial real estate (CRE) documents. It accepts a file upload, detects the file format, extracts raw text, sends the text to OpenAI's `gpt-4o-mini` model with a type-specific system prompt, and returns a JSON object of extracted fields.

### Supported Document Types

| Type | Key | Field Count | System Role | Description |
|------|-----|-------------|-------------|-------------|
| Lease Agreement | `lease` | 24 fields | `lease analyst` | Tenant info, rent structure, expenses, options |
| Offering Memorandum | `om` | 32 fields | `investment analyst` | Property overview, financials, income, returns |
| Purchase & Sale Agreement | `psa` | 28 fields | `transaction analyst` | Parties, deal terms, legal provisions |

---

## Data Flow

```
Frontend (Vercel)                    Backend (Render)                    OpenAI
─────────────────                    ────────────────                    ──────
User uploads file  ──POST──►  /api/parse-document
                              │
                              ├─ Authenticate (JWT or API key)
                              ├─ Validate document_type
                              ├─ Validate file extension & size
                              │
                              ▼
                        _extract_text()
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                  .pdf      .csv      .xlsx/.txt
                    │
              ┌─────┴─────┐
              ▼            ▼
          pymupdf      pytesseract
          (fitz)       OCR fallback
              │            │
              └─────┬──────┘
                    ▼
            extracted_text (string)
                    │
                    ▼
          DOC_TYPE_CONFIGS[type]
          selects prompt + fields
                    │
                    ▼
           OpenAI gpt-4o-mini  ◄── system prompt (type-specific)
           JSON mode, temp=0       user message (extracted text)
                    │
                    ▼
              parsed JSON
                    │
                    ▼
           { document_type, parsed, usage }
                    │
                    ▼
           Response to frontend  ──►  Display results + save to Supabase
```

---

## File Map

### Backend Repository: `nmoutopoulos-ping/analyst-b52a5645` (branch: `master`)

| File | Role |
|------|------|
| `Pipeline/document_parser.py` | Core parsing module — field schemas, prompts, text extraction, OpenAI call |
| `Pipeline/lease_parser.py` | Original lease-only parser (legacy, still importable but `document_parser.py` supersedes it) |
| `Pipeline/server.py` | Flask app — HTTP endpoints including `/api/parse-document` and `/api/parse-lease` |

### Frontend Repository: `nmoutopoulos-ping/ping-analyst-v1` (branch: `main`)

| File | Role |
|------|------|
| Documents page component | Upload UI, document type selector, results display, saved documents tab |
| Supabase client / hooks | API calls to backend, save/load from `lease_extractions` table |

---

## Key Module: `document_parser.py`

### Field Schema Lists

Each document type has a Python list of field name strings. These field names become the JSON keys that OpenAI returns.

- `LEASE_FIELDS` — 24 fields (tenant, property, lease terms, rent, expenses, options)
- `OM_FIELDS` — 32 fields (property overview, financials, income, returns, context)
- `PSA_FIELDS` — 28 fields (parties, property, deal terms, legal provisions)

### Extraction Prompts

A shared `_PROMPT_TEMPLATE` is parameterized per type:

- **Role**: tells the model what kind of analyst it is (lease / investment / transaction)
- **Doc label**: what kind of document it's reading
- **Extra instructions**: type-specific guidance (e.g., how to format `unit_mix` for OMs, how to describe `prorations` for PSAs)
- **Field list**: appended at the end — the exact fields to extract

The prompt instructs the model to:
1. Return raw numbers (no formatting like `$1,500,000`)
2. Use `"Not found"` for missing fields
3. Include a `confidence` array of field names the model is sure about
4. Include a `notes` field for caveats

### Configuration Map

```python
DOC_TYPE_CONFIGS = {
    "lease": { "fields": LEASE_FIELDS, "prompt": LEASE_EXTRACTION_PROMPT, "label": "lease" },
    "om":    { "fields": OM_FIELDS,    "prompt": OM_EXTRACTION_PROMPT,    "label": "offering memorandum" },
    "psa":   { "fields": PSA_FIELDS,   "prompt": PSA_EXTRACTION_PROMPT,   "label": "purchase & sale agreement" },
}
```

To add a new document type, add a new entry here with its fields list and prompt.

### Text Extraction Strategy

| Format | Method | Notes |
|--------|--------|-------|
| PDF | `pymupdf` (fitz) primary, `pytesseract` OCR fallback | OCR triggers when fitz yields < 100 chars |
| CSV | UTF-8 decode | Raw text passed directly |
| XLSX | `openpyxl` | Sheet-by-sheet, tab-separated cell values |
| TXT | UTF-8 decode | Raw text passed directly |

PDF OCR requires system packages (`tesseract-ocr`, `poppler-utils`) installed in the Docker image.

### Entry Points

- `parse_document(file_bytes, filename, document_type)` — main function, returns `{ document_type, parsed, usage }`
- `parse_lease(file_bytes, filename)` — backward-compatible wrapper, delegates to `parse_document` with `type="lease"`

---

## API Endpoints

### `POST /api/parse-document` (new, multi-type)

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | The document to parse |
| `document_type` | String | Yes | One of `"lease"`, `"om"`, `"psa"` |

**Auth:** `X-Api-Key` header or `Authorization: Bearer <jwt>`

**Response:**
```json
{
  "ok": true,
  "document_type": "om",
  "parsed": { "property_name": "...", "cap_rate": 0.065, ... },
  "usage": {
    "prompt_tokens": 12000,
    "completion_tokens": 800,
    "total_tokens": 12800,
    "estimated_cost": 0.002280
  }
}
```

### `POST /api/parse-lease` (legacy, unchanged)

Same as above but only accepts lease documents. No `document_type` field needed. Kept for backward compatibility with any existing integrations.

---

## Database: Supabase

### Table: `lease_extractions`

Stores parsed results for all document types.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `api_key` | text | Links to user |
| `filename` | text | Original filename |
| `file_size` | integer | Bytes |
| `document_type` | text | `"lease"`, `"om"`, or `"psa"` (default: `"lease"`) |
| `parsed_data` | jsonb | Full parsed JSON for all doc types |
| Individual lease columns | various | 24 columns for backward compat with legacy leases |
| `confidently_extracted` | text[] | Array of confident field names |
| `notes` | text | Caveats from extraction |
| `prompt_tokens` | integer | OpenAI usage |
| `completion_tokens` | integer | OpenAI usage |
| `estimated_cost` | numeric | Cost in USD |
| `created_at` | timestamptz | Auto-set |

**Index:** `(api_key, document_type)` for filtered queries.

**Read pattern:**
- For leases without `parsed_data` (legacy): read from individual columns
- For everything else: read from `parsed_data` JSONB column
- Use `document_type` to select the correct field schema for display

---

## Deployment

| Component | Platform | Auto-deploy | URL |
|-----------|----------|-------------|-----|
| Backend | Render (Docker) | On push to `master` | `analyst-docker.onrender.com` |
| Frontend | Vercel | On push to `main` | `ping-analyst-v1.vercel.app` |

The Docker image includes `tesseract-ocr` and `poppler-utils` for PDF OCR support.

---

## Adding a New Document Type

1. **Define fields** — Add a new `*_FIELDS` list in `document_parser.py`
2. **Write the prompt** — Use `_PROMPT_TEMPLATE.format(...)` with appropriate role, label, and extra instructions
3. **Register in config** — Add entry to `DOC_TYPE_CONFIGS`
4. **Database** — No migration needed (new types use the `parsed_data` JSONB column)
5. **Frontend** — Add to the segmented control, field schema, and filter chips
6. **Push & deploy** — Push `document_parser.py` changes to `master` (auto-deploys)

---

## Cost Model

OpenAI `gpt-4o-mini` pricing (as of May 2025):
- Input: $0.15 / 1M tokens
- Output: $0.60 / 1M tokens

Typical per-document cost: $0.001–$0.005 depending on document length.

---

## Gotchas & Known Issues

- **Scanned PDFs**: OCR quality depends on scan resolution. 300 DPI works well.
- **Large documents**: OpenAI context window limits apply. Very long documents may be truncated.
- **Field normalization**: The model sometimes returns formatted numbers despite instructions. Frontend should handle both raw and formatted values.
- **Confidence array**: Not always accurate — treat as a hint, not ground truth.
- **"Not found" handling**: Frontend should display these gracefully (gray/muted text, not error state).
