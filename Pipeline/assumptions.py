"""
assumptions.py — Per-user underwriting assumptions + shared pro forma logic
----------------------------------------------------------------------------
Centralises all financial model defaults so they're defined exactly once
and shared by emailer.py, docx_writer.py, and the CRM Settings API.

Users can override defaults via PATCH /settings in the CRM.
Overrides are persisted to SETTINGS_DIR (default /tmp/ping_settings) so
they survive server restarts — though they will be lost on a Render
redeploy until a persistent Volume is attached.

Usage in pipeline modules:
    from assumptions import load as load_assumptions, compute_proforma
    a  = load_assumptions(api_key)       # returns dict with all keys filled in
    pf = compute_proforma(total_annual, total_units, price, cost, a)
    noi = pf["noi1"]
"""

import json
import os
from pathlib import Path


# ── Defaults ────────────────────────────────────────────────────────────────────
# These mirror the Excel template's initial model inputs.  If a user has not
# customised a particular value, the default below is used.
DEFAULTS: dict = {
    "ltv":          0.70,   # Loan-to-value ratio
    "closingPct":   0.02,   # Acquisition closing costs as % of price
    "vacancy":      0.07,   # Vacancy & credit loss as % of GPR
    "otherIncMo":   75,     # Other income per unit per month ($)
    "opexRatio":    0.35,   # Operating expenses as % of EGI
    "intRate":      0.065,  # Annual interest rate (IO in Year 1)
    "rentGrowth1":  0.03,   # Year-1 rent growth applied to GPR
}

# Human-readable labels for the CRM Settings UI
LABELS: dict = {
    "ltv":          "Loan-to-Value (LTV)",
    "closingPct":   "Closing Costs",
    "vacancy":      "Vacancy Rate",
    "otherIncMo":   "Other Income / Unit / Month ($)",
    "opexRatio":    "Operating Expense Ratio",
    "intRate":      "Interest Rate",
    "rentGrowth1":  "Year-1 Rent Growth",
}

# Keys that are stored/displayed as percentages (multiply by 100 for display)
PCT_KEYS = {"ltv", "closingPct", "vacancy", "opexRatio", "intRate", "rentGrowth1"}


# ── Storage ──────────────────────────────────────────────────────────────────────
_SETTINGS_DIR = Path(os.environ.get("SETTINGS_DIR", "/tmp/ping_settings"))


def _settings_path(api_key: str) -> Path:
    """Return the JSON file path for a user's settings (safe filename)."""
    safe = api_key.replace("/", "_").replace("..", "").replace(" ", "_")
    return _SETTINGS_DIR / f"{safe}.json"


def load(api_key: str) -> dict:
    """
    Load a user's assumptions. Missing keys are filled in from DEFAULTS.
    Always returns a complete dict with every key in DEFAULTS present.
    """
    p = _settings_path(api_key)
    if p.exists():
        try:
            stored = json.loads(p.read_text())
            # Merge: stored values win, but any new default keys are filled in
            return {**DEFAULTS, **{k: v for k, v in stored.items() if k in DEFAULTS}}
        except Exception:
            pass
    return dict(DEFAULTS)


def compute_proforma(total_annual: float, total_units: int,
                     price: float, cost: float,
                     a: dict | None = None) -> dict:
    """
    Compute a Year-1 pro forma snapshot from revenue and property inputs.

    Arguments:
        total_annual  — total gross annual revenue (residential + commercial)
        total_units   — total residential unit count
        price         — acquisition price
        cost          — estimated improvements / capex
        a             — assumptions dict (from load()); falls back to DEFAULTS

    Returns a dict with all intermediate and final values:
        gpr1, vac_loss, other_inc, egi1, opex1, noi1,
        all_in, equity, loan, ds1, ncf1,
        unlev_coc, lev_coc
    """
    _a           = {**DEFAULTS, **(a or {})}
    ltv          = _a["ltv"]
    closing_pct  = _a["closingPct"]
    vacancy      = _a["vacancy"]
    other_inc_mo = _a["otherIncMo"]
    opex_ratio   = _a["opexRatio"]
    int_rate     = _a["intRate"]
    rent_growth1 = _a["rentGrowth1"]

    gpr1      = total_annual * (1 + rent_growth1)
    vac_loss  = gpr1 * vacancy
    other_inc = other_inc_mo * (total_units or 1) * 12
    egi1      = gpr1 - vac_loss + other_inc
    opex1     = egi1 * opex_ratio
    noi1      = egi1 - opex1
    all_in    = price * (1 + closing_pct) + cost
    equity    = price * (1 - ltv + closing_pct) + cost
    loan      = price * ltv
    ds1       = loan * int_rate
    ncf1      = noi1 - ds1

    return {
        "gpr1":       gpr1,
        "vac_loss":   vac_loss,
        "other_inc":  other_inc,
        "egi1":       egi1,
        "opex1":      opex1,
        "noi1":       noi1,
        "all_in":     all_in,
        "equity":     equity,
        "loan":       loan,
        "ds1":        ds1,
        "ncf1":       ncf1,
        "unlev_coc":  (noi1 / all_in)       if all_in  else 0,
        "lev_coc":    (ncf1 / equity)        if equity  else 0,
        # pass-through inputs for display convenience
        "vacancy":    vacancy,
        "opex_ratio": opex_ratio,
    }


def save(api_key: str, updates: dict) -> dict:
    """
    Merge updates onto the user's current assumptions and persist to disk.
    Only keys that exist in DEFAULTS are accepted; unknown keys are ignored.
    Returns the full merged dict.
    """
    current = load(api_key)
    merged  = {**current, **{k: v for k, v in updates.items() if k in DEFAULTS}}
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _settings_path(api_key).write_text(json.dumps(merged, indent=2))
    return merged


def _irr(cash_flows: list, max_iter: int = 200, tol: float = 1e-7) -> "float | None":
    """Solve for IRR via Newton-Raphson. Returns None if no convergence."""
    if not cash_flows or cash_flows[0] >= 0:
        return None  # must start with a negative outflow
    rate = 0.10
    for _ in range(max_iter):
        npv = sum(cf / (1 + rate) ** t for t, cf in enumerate(cash_flows))
        dnpv = sum(-t * cf / (1 + rate) ** (t + 1) for t, cf in enumerate(cash_flows))
        if abs(dnpv) < 1e-12:
            break
        delta = npv / dnpv
        rate -= delta
        if rate <= -1:
            rate = -0.999  # clamp to avoid division by zero
        if abs(delta) < tol:
            return rate
    return None


def compute_returns(
    total_annual: float,
    total_units: int,
    price: float,
    cost: float,
    a: "dict | None" = None,
    hold_years: int = 5,
) -> dict:
    """
    Compute levered investment returns over a hold period.

    Arguments:
        total_annual  - gross annual revenue (residential + commercial)
        total_units   - total unit count
        price         - acquisition price
        cost          - improvements / capex budget
        a             - assumptions dict (from load()); falls back to DEFAULTS
        hold_years    - investment hold period in years (default 5)

    Returns a dict with:
        noi       - Year-1 Net Operating Income ($)
        cap_rate  - entry cap rate (NOI / purchase price)
        coc       - Year-1 levered cash-on-cash return
        moic      - equity multiple over hold period
        irr       - annual IRR over hold period
    """
    pf = compute_proforma(total_annual, total_units, price, cost, a)
    _a = {**DEFAULTS, **(a or {})}
    rent_growth = _a["rentGrowth1"]

    noi1 = pf["noi1"]
    equity = pf["equity"]
    loan = pf["loan"]
    ds = pf["ds1"]  # IO debt service (constant throughout hold)

    if not equity or equity <= 0:
        return {"noi": round(noi1, 0), "cap_rate": None, "coc": None, "moic": None, "irr": None, "loan_amount": None, "down_payment": None, "monthly_cash_flow": None, "dscr": None}

    # Entry cap rate (NOI / purchase price)
    entry_cap = noi1 / price if price else 0
    exit_cap = entry_cap  # assume exit at same cap rate as entry

    # Annual cash flows: IO loan, sell at end of hold
    cash_flows = [-equity]  # Year 0: equity out
    noi_t = noi1
    for t in range(1, hold_years + 1):
        if t > 1:
            noi_t *= 1 + rent_growth
        ncf_t = noi_t - ds
        if t == hold_years:
            exit_value = (noi_t / exit_cap) if exit_cap else 0
            reversion = exit_value - loan  # net proceeds after paying off loan
            cash_flows.append(ncf_t + reversion)
        else:
            cash_flows.append(ncf_t)

    total_return = sum(cash_flows[1:])
    moic = total_return / equity
    irr = _irr(cash_flows)

    return {
        "noi": round(noi1, 0),
        "cap_rate": round(entry_cap, 4),
        "coc": round(pf["lev_coc"], 4),
        "moic": round(moic, 3),
        "irr": round(irr, 4) if irr is not None else None,
        "loan_amount": round(loan, 0),
        "down_payment": round(equity, 0),
        "monthly_cash_flow": round(pf["ncf1"] / 12, 0),
        "dscr": round(noi1 / ds, 2) if ds else None,
    }
