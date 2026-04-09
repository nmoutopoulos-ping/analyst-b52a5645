"""
lease_parser.py — Parse lease documents and extract structured data.

Accepts file bytes + filename, detects file type, extracts text, and sends to OpenAI
to extract 24 lease-related fields as JSON.
"""

import io
import json
import logging
import os
from datetime import datetime

from openai import OpenAI

log = logging.getLogger("ping-server")


# Matches the original parse-lease.js prompt exactly
LEASE_FIELDS = [
    "tenant_name",
    "tenant_entity_type",
    "property_address",
    "unit_number",
    "asset_class",
    "lease_start_date",
    "lease_end_date",
    "lease_term_months",
    "base_rent_monthly",
    "base_rent_annual",
    "rent_escalation_type",
    "rent_escalation_value",
    "free_rent_months",
    "security_deposit",
    "expense_structure",
    "tenant_responsible_expenses",
    "landlord_responsible_expenses",
    "tenant_improvement_allowance",
    "renewal_options",
    "termination_option",
    "termination_notice_months",
    "guarantor_name",
    "confidently_extracted",
    "notes",
]

LEASE_EXTRACTION_PROMPT = (
    "You are a commercial and residential lease abstraction expert. "
    "Extract the following fields from the provided lease document and return them as a single JSON object. "
    "Use null for any field you cannot determine from the text. "
    "For list fields, return arrays of strings. "
    "For date fields use YYYY-MM-DD format. "
    "For currency fields return numbers without formatting. "
    'The "confidently_extracted" field should be an array of field names you are highly confident about. '
    'The "notes" field should contain any important caveats or ambiguities.\n\n'
    "Fields to extract:\n"
    + "\n".join(f"- {f}" for f in LEASE_FIELDS)
)


def _extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from a PDF file using PyPDF2."""
    try:
        from PyPDF2 import PdfReader

        pdf_file = io.BytesIO(file_bytes)
        reader = PdfReader(pdf_file)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        log.error(f"Error extracting PDF text: {e}")
        raise


def _extract_text_from_csv(file_bytes: bytes) -> str:
    """Extract text from a CSV file."""
    try:
        text = file_bytes.decode("utf-8")
        return text.strip()
    except Exception as e:
        log.error(f"Error extracting CSV text: {e}")
        raise


def _extract_text_from_xlsx(file_bytes: bytes) -> str:
    """Extract text from an Excel file using openpyxl."""
    try:
        from openpyxl import load_workbook

        excel_file = io.BytesIO(file_bytes)
        workbook = load_workbook(excel_file)
        text = ""
        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]
            text += f"\n=== Sheet: {sheet_name} ===\n"
            for row in sheet.iter_rows(values_only=True):
                for cell in row:
                    if cell is not None:
                        text += str(cell) + " "
                text += "\n"
        return text.strip()
    except Exception as e:
        log.error(f"Error extracting XLSX text: {e}")
        raise


def _extract_text_from_txt(file_bytes: bytes) -> str:
    """Extract text from a plain text file."""
    try:
        text = file_bytes.decode("utf-8")
        return text.strip()
    except Exception as e:
        log.error(f"Error extracting TXT text: {e}")
        raise


def _extract_text(file_bytes: bytes, filename: str) -> str:
    """Detect file type and extract text accordingly."""
    filename_lower = filename.lower()

    if filename_lower.endswith(".pdf"):
        return _extract_text_from_pdf(file_bytes)
    elif filename_lower.endswith(".csv"):
        return _extract_text_from_csv(file_bytes)
    elif filename_lower.endswith(".xlsx"):
        return _extract_text_from_xlsx(file_bytes)
    elif filename_lower.endswith(".txt"):
        return _extract_text_from_txt(file_bytes)
    else:
        raise ValueError(f"Unsupported file type: {filename}")


def parse_lease(file_bytes: bytes, filename: str) -> dict:
    """
    Parse a lease document and extract 24 key fields using OpenAI.

    Args:
        file_bytes: The file contents as bytes
        filename: The filename (used to detect file type)

    Returns:
        {
            "parsed": {24-field lease object},
            "usage": {
                "prompt_tokens": int,
                "completion_tokens": int,
                "total_tokens": int,
                "estimated_cost": float
            }
        }
    """
    # Extract text from file
    log.info(f"Extracting text from {filename}...")
    extracted_text = _extract_text(file_bytes, filename)
    log.info(f"Extracted {len(extracted_text)} characters from {filename}")

    # Initialize OpenAI client
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable not set")

    client = OpenAI(api_key=api_key)

    # Call OpenAI with JSON mode
    log.info("Sending extracted text to OpenAI gpt-4o-mini...")
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": LEASE_EXTRACTION_PROMPT
            },
            {
                "role": "user",
                "content": extracted_text
            }
        ],
        response_format={"type": "json_object"},
        temperature=0
    )

    # Parse the response
    response_text = response.choices[0].message.content
    parsed_data = json.loads(response_text)

    # gpt-4o-mini pricing: $0.15 / 1M input, $0.60 / 1M output
    prompt_cost = (response.usage.prompt_tokens / 1_000_000) * 0.15
    completion_cost = (response.usage.completion_tokens / 1_000_000) * 0.60
    total_cost = prompt_cost + completion_cost

    log.info(f"Lease parsing complete. Tokens: {response.usage.total_tokens}, Cost: ${total_cost:.6f}")

    return {
        "parsed": parsed_data,
        "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
            "estimated_cost": round(total_cost, 6)
        }
    }
