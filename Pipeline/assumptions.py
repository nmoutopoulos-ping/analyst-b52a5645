"""
assumptions.py — Per-user underwriting assumptions + shared pro forma logic
----------------------------------------------------------------------------
Centralises all financial model defaults so they're defined exactly once and
shared by emailer.py, docx_writer.py, and the CRM Settings API.

Users can override defaults via PATCH /settings in the CRM.  Overrides are
persisted to SETTINGS_DIR (default /tmp/ping_settings) so they survive
server restarts — though they will be lost on a Render redeploy until a
persistent Volume is attached.

Usage in pipeline modules:
    from assumptions import load as load_assumptions, compute_proforma
    a = load_assumptions(api_key)      # returns dict with all keys filled in
    pf = compute_proforma(total_annual, total_units, price, cost, a)
    noi = pf["noi0"]
"""

import json
import os
from pathlib import Path


# ── Defaults ──────────────────────────────────────────────────────────────────
# These mirror the Excel template's initial model inputs.  If a user has not
# customised a particular value, the default below is used.

DEFAULTS: dict = {
    "ltv":              0.70,    # Loan-to-value ratio
    "closingPct":       0.02,    # Acquisition closing costs as % of price
    "vacancy":          0.07,    # Vacancy & credit loss as % of GPR
    "otherIncMo":       75,      # Other income per unit per month ($)
    "opexRatio":        0.35,    # Operating expenses as % of NEI
    "intRate":          0.065,   # Annual interest rate
    "rentGrowth1":      0.03,    # Year-1 rent growth applied to GPR
    "io_period_mo":     24,      # Interest-only period in months
    "amort_years":      30,      # Amortization term in years
    "loan_term_years":  10,      # Total loan term in years
    "exit_cap_rate":    0.07,    # Exit / reversion cap rate
    "opex_growth":      0.03,    # Annual OpEx growth rate
    "selling_costs_pct": 0.04,   # Disposition selling costs
}

# Human-readable labels for the CRM Settings UI
LABELS: dict = {
    "ltv":              "Loan-to-Value (LTV)",
    "closingPct":       "Closing Costs",
    "vacancy":          "Vacancy Rate",
    "otherIncMo":       "Other Income / Unit / Month ($)",
    "opexRatio":        "Operating Expense Ratio",
    "intRate":          "Interest Rate",
    "rentGrowth1":      "Year-1 Rent Growth",
    "exit_cap_rate":    "Exit Cap Rate",
    "opex_growth":      "OpEx Growth Rate",
    "selling_costs_pct": "Selling Costs",
}

# Keys that are stored/displayed as percentages (multiply by 100 for display)
PCT_KEYS = {"ltv", "closingPct", "vacancy", "opexRatio", "intRate", "rentGrowth1",
            "exit_cap_rate", "opex_growth", "selling_costs_pct"}


# ── Storage ────────────────────────────────────────────────────────────────────

_SETTINGS_DIR = Path(os.environ.get("SETTINGS_DIR", "/tmp/ping_settings"))


def _settings_path(api_key: str) -> Path:
    """Return the JSON file path for a user's settings (safe filename)."""
    safe = api_key.replace("/", "_").replace("..", "").replace(" ", "_")
    return _SETTINGS_DIR / f"{safe}.json"


def load(api_key: str) -> dict:
    """
    Load a user's assumptions.  Missing keys are filled in from DEFAULTS.
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
    Compute a Year-0 pro forma snapshot from revenue and property inputs.

    IMPORTANT: This now matches the Excel Pro Forma Year 0 logic exactly:
      GPR  = total_annual  (no rent growth applied to Year 0)
      EGI  = GPR + Other Income
      NEI  = EGI * (1 - Vacancy)
      OpEx = NEI * opex_ratio
      NOI  = NEI - OpEx

    Arguments:
      total_annual — total gross annual revenue (residential + commercial)
      total_units  — total residential unit count
      price        — acquisition price
      cost         — estimated improvements / capex
      a            — assumptions dict (from load()); falls back to DEFAULTS

    Returns a dict with all intermediate and final values:
      gpr0, other_inc, egi0, nei0, opex0, noi0,
      all_in, equity, loan, ds0, ncf0, unlev_coc, lev_coc
    """
    _a = {**DEFAULTS, **(a or {})}

    ltv          = _a["ltv"]
    closing_pct  = _a["closingPct"]
    vacancy      = _a["vacancy"]
    other_inc_mo = _a["otherIncMo"]
    opex_ratio   = _a["opexRatio"]
    int_rate     = _a["intRate"]

    # ── Year 0: NO rent growth applied (matches Excel Pro Forma column D) ──
    gpr0      = total_annual
    other_inc = other_inc_mo * (total_units or 1) * 12
    egi0      = gpr0 + other_inc
    nei0      = egi0 * (1 - vacancy)         # Net Effective Income
    opex0     = nei0 * opex_ratio            # OpEx on NEI (not EGI)
    noi0      = nei0 - opex0

    all_in = price * (1 + closing_pct) + cost
    equity = price * (1 - ltv + closing_pct) + cost
    loan   = price * ltv
    ds0    = loan * int_rate                  # IO debt service
    ncf0   = noi0 - ds0

    return {
        "gpr0":       gpr0,
        "other_inc":  other_inc,
        "egi0":       egi0,
        "nei0":       nei0,
        "opex0":      opex0,
        "noi0":       noi0,
        "all_in":     all_in,
        "equity":     equity,
        "loan":       loan,
        "ds0":        ds0,
        "ncf0":       ncf0,
        "unlev_coc":  (noi0 / all_in) if all_in else 0,
        "lev_coc":    (ncf0 / equity) if equity else 0,
        # pass-through inputs for display convenience
        "vacancy":    vacancy,
        "opex_ratio": opex_ratio,
        # Keep legacy keys for any code still referencing them
        "gpr1":       gpr0,
        "egi1":       egi0,
        "opex1":      opex0,
        "noi1":       noi0,
        "ncf1":       ncf0,
        "vac_loss":   egi0 * vacancy,
    }


def save(api_key: str, updates: dict) -> dict:
    """
    Merge updates onto the user's current assumptions and persist to disk.
    Only keys that exist in DEFAULTS are accepted; unknown keys are ignored.
    Returns the full merged dict.
    """
    current = load(api_key)
    merged = {**current, **{k: v for k, v in updates.items() if k in DEFAULTS}}
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _settings_path(api_key).write_text(json.dumps(merged, indent=2))
    return merged


def _irr(cash_flows: list, max_iter: int = 200, tol: float = 1e-7) -> "float | None":
    """Solve for IRR via Newton-Raphson. Returns None if no convergence."""
    if not cash_flows or cash_flows[0] >= 0:
        return None  # must start with a negative outflow

    rate = 0.10
    for _ in range(max_iter):
        npv  = sum(cf / (1 + rate) ** t for t, cf in enumerate(cash_flows))
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


def _pmt(rate: float, nper: int, pv: float) -> float:
    """Monthly payment for a fully amortizing loan (matches Excel PMT)."""
    if rate == 0:
        return pv / nper if nper else 0
    return pv * (rate * (1 + rate) ** nper) / ((1 + rate) ** nper - 1)


def compute_returns(
    total_annual: float,
    total_units: int,
    price: float,
    cost: float,
    a: "dict | None" = None,
    hold_years: int | None = None,
) -> dict:
    """
    Compute levered investment returns over a hold period.

    *** ALIGNED WITH EXCEL PRO FORMA ***
    - Uses explicit exit_cap_rate (not entry cap) for reversion
    - Transitions from IO to amortizing debt service after io_period_mo
    - Tracks remaining loan balance for accurate exit reversion
    - Applies selling_costs_pct to exit value

    Arguments:
      total_annual  - gross annual revenue (residential + commercial)
      total_units   - total unit count
      price         - acquisition price
      cost          - improvements / capex budget
      a             - assumptions dict (from load()); falls back to DEFAULTS
      hold_years    - investment hold period (default from assumptions or 5)

    Returns a dict with:
      noi            - Year-0 Net Operating Income ($)
      cap_rate       - entry cap rate (NOI / purchase price)
      coc            - Year-0 levered cash-on-cash return
      moic           - equity multiple over hold period
      irr            - annual IRR over hold period
      loan_amount    - total loan
      down_payment   - total equity required
      monthly_cash_flow - Year-0 monthly net cash flow
      dscr           - Year-0 debt service coverage ratio
    """
    pf = compute_proforma(total_annual, total_units, price, cost, a)

    _a = {**DEFAULTS, **(a or {})}
    rent_growth     = _a["rentGrowth1"]
    io_period_mo    = int(_a.get("io_period_mo", 24))
    amort_years     = int(_a.get("amort_years", 30))
    int_rate        = float(_a["intRate"])
    exit_cap        = float(_a.get("exit_cap_rate", 0.07))
    selling_pct     = float(_a.get("selling_costs_pct", 0.04))
    opex_growth     = float(_a.get("opex_growth", 0.03))

    if hold_years is None:
        hold_years = int(_a.get("hold_period_years", 5))

    noi0   = pf["noi0"]
    equity = pf["equity"]
    loan   = pf["loan"]
    ds_io  = loan * int_rate   # annual IO debt service

    if not equity or equity <= 0:
        return {
            "noi": round(noi0, 0), "cap_rate": None, "coc": None,
            "moic": None, "irr": None, "loan_amount": None,
            "down_payment": None, "monthly_cash_flow": None, "dscr": None,
        }

    # Entry cap rate (NOI / purchase price)
    entry_cap = noi0 / price if price else 0

    # Monthly amortizing payment (used after IO period)
    monthly_rate = int_rate / 12
    num_payments = amort_years * 12
    monthly_pmt  = _pmt(monthly_rate, num_payments, loan)
    annual_amort_ds = monthly_pmt * 12

    # ── Build annual cash flows matching Excel Pro Forma ────────────────
    # Track loan balance month-by-month for accurate exit reversion
    loan_balance = loan
    cash_flows = [-equity]  # Year 0: equity out

    # Year-0 pro forma components (for growing individually)
    gpr_t   = pf["gpr0"]
    other_t = pf["other_inc"]
    opex_t  = pf["opex0"]
    vacancy = float(_a["vacancy"])

    for t in range(1, hold_years + 1):
        # Grow revenue and expenses (matching Excel Pro Forma columns)
        gpr_t   *= 1 + rent_growth
        other_t *= 1 + rent_growth
        egi_t    = gpr_t + other_t
        nei_t    = egi_t * (1 - vacancy)
        opex_t  *= 1 + opex_growth
        noi_t    = nei_t - opex_t

        # ── Debt service: IO vs amortizing per month ──
        # For each month in this year, determine IO or amort
        annual_ds = 0.0
        for m in range(12):
            month_num = (t - 1) * 12 + m + 1  # 1-indexed absolute month
            if month_num <= io_period_mo:
                # Interest-only
                monthly_interest = loan_balance * monthly_rate
                annual_ds += monthly_interest
                # No principal reduction during IO
            else:
                # Amortizing
                monthly_interest = loan_balance * monthly_rate
                principal_pmt    = monthly_pmt - monthly_interest
                annual_ds       += monthly_pmt
                loan_balance    -= principal_pmt

        ncf_t = noi_t - annual_ds

        if t == hold_years:
            # Exit: sell at explicit exit cap, minus remaining loan, minus selling costs
            exit_value    = (noi_t / exit_cap) if exit_cap else 0
            selling_costs = exit_value * selling_pct
            reversion     = exit_value - selling_costs - loan_balance
            cash_flows.append(ncf_t + reversion)
        else:
            cash_flows.append(ncf_t)

    total_return = sum(cash_flows[1:])
    moic = total_return / equity
    irr  = _irr(cash_flows)

    return {
        "noi":               round(noi0, 0),
        "cap_rate":          round(entry_cap, 4),
        "coc":               round(pf["lev_coc"], 4),
        "moic":              round(moic, 3),
        "irr":               round(irr, 4) if irr is not None else None,
        "loan_amount":       round(loan, 0),
        "down_payment":      round(equity, 0),
        "monthly_cash_flow": round(pf["ncf0"] / 12, 0),
        "dscr":              round(noi0 / ds_io, 2) if ds_io else None,
    }
