"""
Email generation and delivery for investment analysis summaries.

This module provides functions to generate email bodies with investment analysis
information and send emails with attachments (Excel models and Word summaries).
"""

import base64
import os
import requests
from datetime import datetime
from pathlib import Path

from config import EMAIL_CFG
from helpers import shorten_address, unit_counts as _unit_counts, parse_num
from assumptions import DEFAULTS as _ASSUMPTION_DEFAULTS, compute_proforma


def generate_summary(search_meta, combos, comp_summary):
    lines = []
    lines.append(f"INVESTMENT SUMMARY — {search_meta['address']}")
    lines.append(f"Search ID: {search_meta['searchId']}  |  {datetime.now().strftime('%B %d, %Y')}")
    lines.append("")
    lines.append("SUBJECT PROPERTY")
    if search_meta.get("price"):
        try:
            lines.append(f"  Acquisition Price: ${float(search_meta['price']):,.0f}")
        except ValueError:
            pass
    if search_meta.get("cost"):
        try:
            lines.append(f"  Estimated Improvements: ${float(search_meta['cost']):,.0f}")
        except ValueError:
            pass
    if search_meta.get("sqft"):
        try:
            lines.append(f"  Building SF: {float(search_meta['sqft']):,.0f}")
        except ValueError:
            pass
    lines.append(f"  Total Units: {search_meta['totalUnits']}")
    lines.append("")
    lines.append("RENTAL COMP ANALYSIS")
    lines.append(f"  Search Radius: {search_meta['radius']} mi  |  Status Filter: {search_meta['status']}")
    lines.append("")
    for s in comp_summary:
        lines.append(f"  {s['beds']}bd/{s['baths']}ba")
        lines.append(f"    Comps Found:  {s['count']}")
        lines.append(f"    Avg Rent/Mo:  ${s['avg_rent']:,.0f}")
        if s["avg_sqft"]:
            lines.append(f"    Avg SF:       {s['avg_sqft']:,.0f}")
            if s["avg_rent"] and s["avg_sqft"]:
                lines.append(f"    Rent / SF:    ${s['avg_rent']/s['avg_sqft']:.2f}")
        lines.append("")
    lines.append("The attached Excel model contains the full pro forma, debt schedule,")
    lines.append("returns analysis, and pricing scenarios populated with live comp data.")
    lines.append("")
    lines.append("— Ping Underwriting Engine")
    return "\n".join(lines)

def generate_email_body(search_meta, comp_summary, excel_fn, docx_fn,
                        commercial_spaces=None, assumptions=None):
    """
    Generate a polished plain-text email body for the investment search results.
    """
    date_str   = datetime.now().strftime("%B %d, %Y")

    price       = parse_num(search_meta.get("price"))
    cost        = parse_num(search_meta.get("cost"))
    total_units = parse_num(search_meta.get("totalUnits"), as_int=True)

    # Use actual per-type unit counts when available (embedded by main.py).
    # Fall back to even distribution across types that have comp data.
    if any(s.get("units", 0) for s in comp_summary):
        gross_monthly = sum(
            (s.get("units") or 0) * (s.get("avg_rent") or 0)
            for s in comp_summary
        )
    else:
        _types_with_data = [s for s in comp_summary if s.get("avg_rent")]
        _unit_cnts = _unit_counts(search_meta["totalUnits"], len(_types_with_data))
        gross_monthly = sum(
            _unit_cnts[i] * s["avg_rent"] for i, s in enumerate(_types_with_data)
        )
    gross_annual  = gross_monthly * 12

    # ── Commercial spaces — compute total annual gross revenue ─────────────────
    comm_spaces   = commercial_spaces or []
    comm_annual   = 0.0
    for sp in comm_spaces:
        try:
            comm_annual += int(float(sp.get("sqft", 0) or 0)) * float(sp.get("rentPerSF", 0) or 0)
        except (ValueError, TypeError):
            pass

    total_annual  = gross_annual + comm_annual   # residential + commercial

    # ── Year-1 pro forma ─ use user's saved assumptions (fall back to defaults) ──
    _a         = {**_ASSUMPTION_DEFAULTS, **(assumptions or {})}
    _pf        = compute_proforma(total_annual, total_units, price, cost, _a)
    _gpr1      = _pf["gpr1"]
    _vac_loss  = _pf["vac_loss"]
    _other_inc = _pf["other_inc"]
    _egi1      = _pf["egi1"]
    _opex1     = _pf["opex1"]
    _noi1      = _pf["noi1"]
    _all_in    = _pf["all_in"]
    _equity    = _pf["equity"]
    _ds1       = _pf["ds1"]
    _ncf1      = _pf["ncf1"]
    _unlev_coc = _pf["unlev_coc"]
    _lev_coc   = _pf["lev_coc"]
    _VACANCY   = _pf["vacancy"]
    _OPEX_RATIO = _pf["opex_ratio"]

    lines = []
    lines.append(f"Your investment search results are ready.")
    lines.append(f"")
    lines.append(f"  {search_meta['address']}")
    lines.append(f"")
    lines.append(f"{'─' * 54}")
    lines.append(f"")
    lines.append(f"SUBJECT PROPERTY")
    if price:
        lines.append(f"  Acquisition Price:    ${price:,.0f}")
    if cost:
        lines.append(f"  Improvements:         ${cost:,.0f}")
    if price:
        lines.append(f"  All-In Cost:          ${price + cost:,.0f}")
    if total_units:
        lines.append(f"  Total Units:          {total_units}")
    if price and total_units:
        lines.append(f"  Price / Unit:         ${price / total_units:,.0f}")
    lines.append(f"")
    lines.append(
        f"RENTAL COMPS  "
        f"({search_meta.get('radius')} mi radius · {search_meta.get('status')} listings)"
    )
    for s in comp_summary:
        if not s.get("count"):
            lines.append(f"  {s['beds']}BD/{s['baths']}BA   No comps found in search radius")
            continue
        avg_rent = s.get("avg_rent") or 0
        avg_sqft = s.get("avg_sqft") or 0
        psf_str  = f"  ${avg_rent/avg_sqft:.2f}/SF" if avg_sqft and avg_rent else ""
        lines.append(
            f"  {s['beds']}BD/{s['baths']}BA   "
            f"{s['count']} comps   "
            f"Avg ${avg_rent:,.0f}/mo   "
            f"{int(avg_sqft):,} SF avg"
            f"{psf_str}"
        )
    lines.append(f"")
    if gross_monthly:
        lines.append(f"  Est. Residential Monthly:    ${gross_monthly:,.0f}")
        lines.append(f"  Est. Residential Annual:     ${gross_annual:,.0f}")
    if comm_annual:
        lines.append(f"  Est. Commercial Annual:      ${comm_annual:,.0f}")
    if gross_monthly or comm_annual:
        lines.append(f"  ─────────────────────────────────────────")
        lines.append(f"  Est. Total Gross Annual:     ${total_annual:,.0f}")
    lines.append(f"")
    lines.append(f"{'─' * 54}")
    lines.append(f"")
    lines.append(f"YEAR 1 PRO FORMA SNAPSHOT  (stabilized assumptions)")
    lines.append(f"  Gross Potential Rent:        ${_gpr1:>10,.0f}")
    lines.append(f"  Vacancy Loss ({_VACANCY:.0%}):         $({_vac_loss:>9,.0f})")
    lines.append(f"  Other Income:                ${_other_inc:>10,.0f}")
    lines.append(f"  ─────────────────────────────────────────")
    lines.append(f"  Effective Gross Income:      ${_egi1:>10,.0f}")
    lines.append(f"  Operating Expenses ({_OPEX_RATIO:.0%}):    $({_opex1:>9,.0f})")
    lines.append(f"  ─────────────────────────────────────────")
    lines.append(f"  Net Operating Income:        ${_noi1:>10,.0f}")
    lines.append(f"  Debt Service:                $({_ds1:>9,.0f})")
    lines.append(f"  ─────────────────────────────────────────")
    lines.append(f"  Net Cash Flow:               ${_ncf1:>10,.0f}")
    lines.append(f"")
    lines.append(f"  Unlevered CoC (Yr 1):        {_unlev_coc:.1%}")
    lines.append(f"  Levered CoC (Yr 1):          {_lev_coc:.1%}")
    lines.append(f"")
    lines.append(f"{'─' * 54}")
    lines.append(f"")
    lines.append(f"Attached:")
    lines.append(f"  • {Path(excel_fn).name}")
    lines.append(f"    Full 10-year pro forma, debt schedule, returns & pricing scenarios")
    lines.append(f"  • {Path(docx_fn).name}")
    lines.append(f"    1-page investment brief")
    lines.append(f"")
    lines.append(f"— Ping Underwriting Engine")
    lines.append(f"  Search ID: {search_meta.get('searchId')}  ·  {date_str}")

    return "\n".join(lines)

def send_email(to_addr, subject, body, attachment_paths):
    """
    Send the investment summary email with one or more file attachments via Resend API.
    attachment_paths: a single Path/str, or a list of Path/str.
    Email is skipped when email.enabled = false in config.json.
    Requires RESEND_API_KEY environment variable.
    """
    if not EMAIL_CFG.get("enabled"):
        print("  [Email] Disabled in config — skipping send.")
        return

    api_key = os.environ.get("RESEND_API_KEY") or EMAIL_CFG.get("resend_api_key", "")
    if not api_key:
        print("  [Email] No RESEND_API_KEY set — skipping send.")
        return

    if isinstance(attachment_paths, (str, Path)):
        attachment_paths = [attachment_paths]

    attachments = []
    for ap in attachment_paths:
        with open(ap, "rb") as f:
            content = base64.b64encode(f.read()).decode()
        attachments.append({"filename": Path(ap).name, "content": content})

    sender = EMAIL_CFG.get("sender") or "Ping Analyst <onboarding@resend.dev>"

    payload = {
        "from":        sender,
        "to":          [to_addr],
        "subject":     subject,
        "text":        body,
        "attachments": attachments,
    }

    resp = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    print(f"  [Email] Sent to {to_addr} via Resend ({len(attachment_paths)} attachment(s))")