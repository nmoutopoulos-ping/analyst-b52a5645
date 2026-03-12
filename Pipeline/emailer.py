"""
Email generation and delivery for investment analysis summaries.

This module provides functions to generate email bodies with investment analysis
information and send emails with attachments (Excel models and Word summaries).
"""

import smtplib
from datetime import datetime
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from config import EMAIL_CFG
from helpers import shorten_address, unit_counts as _unit_counts


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
                        commercial_spaces=None):
    """
    Generate a polished plain-text email body for the investment search results.
    """
    date_str   = datetime.now().strftime("%B %d, %Y")

    try:    price       = float(search_meta.get("price") or 0)
    except: price = 0
    try:    cost        = float(search_meta.get("cost")  or 0)
    except: cost = 0
    try:    total_units = int(float(search_meta.get("totalUnits") or 0))
    except: total_units = 0

    n_combos      = len(comp_summary)
    unit_cnts     = _unit_counts(search_meta["totalUnits"], n_combos)
    gross_monthly = sum(
        unit_cnts[i] * (s.get("avg_rent") or 0)
        for i, s in enumerate(comp_summary)
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

    # ── Year-1 pro forma (same assumptions as docx_writer / model template) ──
    _LTV          = 0.70
    _CLOSING_PCT  = 0.02
    _VACANCY      = 0.07
    _OTHER_INC_MO = 75
    _OPEX_RATIO   = 0.35
    _INT_RATE     = 0.065
    _RENT_GROWTH1 = 0.03

    _gpr1      = total_annual * (1 + _RENT_GROWTH1)
    _vac_loss  = _gpr1 * _VACANCY
    _other_inc = _OTHER_INC_MO * (total_units or 1) * 12
    _egi1      = _gpr1 - _vac_loss + _other_inc
    _opex1     = _egi1 * _OPEX_RATIO
    _noi1      = _egi1 - _opex1
    _all_in    = price * (1 + _CLOSING_PCT) + cost
    _equity    = price * (1 - _LTV + _CLOSING_PCT) + cost
    _loan      = price * _LTV
    _ds1       = _loan * _INT_RATE
    _ncf1      = _noi1 - _ds1
    _unlev_coc = (_noi1  / _all_in)  if _all_in  else 0
    _lev_coc   = (_ncf1  / _equity)  if _equity  else 0

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
    for i, s in enumerate(comp_summary):
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
    Send the investment summary email with one or more file attachments.
    attachment_paths: a single Path/str, or a list of Path/str.
    Email is skipped when email.enabled = false in config.json.
    """
    if not EMAIL_CFG.get("enabled"):
        print("  [Email] Disabled in config — skipping send.")
        return

    if isinstance(attachment_paths, (str, Path)):
        attachment_paths = [attachment_paths]

    msg = MIMEMultipart()
    msg["From"]    = EMAIL_CFG["sender"]
    msg["To"]      = to_addr
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    for ap in attachment_paths:
        with open(ap, "rb") as f:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition",
                        f'attachment; filename="{Path(ap).name}"')
        msg.attach(part)

    smtp_user = EMAIL_CFG.get("smtp_user", EMAIL_CFG["sender"])
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(smtp_user, EMAIL_CFG["app_password"])
        server.sendmail(EMAIL_CFG["sender"], to_addr, msg.as_string())
    print(f"  [Email] Sent to {to_addr} ({len(attachment_paths)} attachment(s))")