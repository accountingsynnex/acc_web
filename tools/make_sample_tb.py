#!/usr/bin/env python3
"""Generate the synthetic trial balances the engine test runs on.

These are FABRICATED — no real company figures. The app itself no longer
ships sample data: it is in production use, and a "try sample data" button
next to a real close is a way to overwrite one by accident. What is left
here exists only so test/engine.test.js has a trial balance to work on.

Account codes and names come from engine/rulebook.js (a chart of accounts
is structure, not data), amounts are drawn from a seeded PRNG so
re-running this reproduces the same files byte for byte. Each entity is
forced to net to zero on signed closing balances, the way a real TB does.

    python3 tools/make_sample_tb.py

Writes test/TB_<ENTITY>_<PERIOD>.csv.
"""
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULEBOOK_JS = ROOT / "engine" / "rulebook.js"
TEST_DIR = ROOT / "test"

PERIOD = "2026-06"
SEED = 20260630

# Departments used by the one entity that carries a cost-centre dimension,
# so the Cost Center page has something to read in the demo.
DEPARTMENTS = [
    ("10", "CEO Office"), ("12", "Human Resources & Admin"), ("15", "Accounting"),
    ("19", "IT"), ("22", "Marketing"), ("24", "Credit Control"),
    ("30", "Product Sales"), ("44", "Sales BKK"), ("99", "Logistics & Warehouse"),
]

# Rough size of each entity, and how many of the rulebook's codes it uses.
ENTITIES = [
    ("SYN",   1.00, 0.95, True),
    ("SVP",   0.22, 0.42, False),
    ("SYNIN", 0.03, 0.09, False),
    ("SWOP",  0.06, 0.24, False),
]

# Codes deliberately left out of the rulebook so the mapping-review flow has
# something to show (the engine test asserts at least one unmapped code).
UNMAPPED = [("9999994", "SUSPENSE - TO BE CLASSIFIED"), ("9999999", "TEMPORARY CLEARING")]

# Section -> (sign, rough share of the entity's balance-sheet / P&L scale).
# Sign follows the raw TB convention: debit +, credit -, so assets and
# expenses are positive and liabilities/equity/revenue are negative.
ASSET_SECTIONS = {"Current Assets": 1.0, "Non-current Assets": 0.12}
LIAB_SECTIONS = {"Current Liabilities": -0.82, "Non-current Liabilities": -0.04}
PL_WEIGHTS = {
    "Revenue": -1.0, "Cost of Sales": 0.955, "Operating Expenses": 0.031,
    "Other Income / Expense": -0.002, "Finance Costs": 0.004, "Share of Profit": -0.003,
    "Income Tax": 0.002,
}
EQUITY_FIXED = {
    "3110000": -400_000_000,     # issued and paid-up share capital
    "3140000": -120_000_000,     # share premium
    "3151000": -40_000_000,      # legal reserve
}
RETAINED_CODE = "3159000"        # the plug that makes the TB net to zero

# Which accounts sit on the credit side regardless of the section they're
# presented in: the 2/3/4/7 code ranges, plus the contra accounts that live
# inside an asset section (provisions, accumulated depreciation).
CREDIT_PREFIXES = ("2", "3", "4", "7")
CONTRA_NAME = re.compile(r"PROVISION|ALLOWANCE|ACCUMULAT|DEFERRED INTEREST", re.I)


def is_credit(code, name):
    return bool(CONTRA_NAME.search(name or "")) or code[0] in CREDIT_PREFIXES
SCALE = 6_400_000_000            # revenue of the largest entity


def load_rulebook():
    text = RULEBOOK_JS.read_text(encoding="utf-8")
    m = re.search(r"const RULEBOOK = (\{.*?\});\s*$", text, re.S | re.M)
    if not m:
        m = re.search(r"const RULEBOOK = (\{.*\});", text, re.S)
    return json.loads(m.group(1))


def pick(rng, codes, share):
    """Take a deterministic subset, always keeping the first code."""
    if not codes:
        return []
    n = max(1, round(len(codes) * share))
    keep = set(rng.sample(codes, min(n, len(codes))))
    keep.add(codes[0])
    return [c for c in codes if c in keep]


def build_entity(rng, rules, scale, share, with_departments):
    # Only plain numeric codes: the importer skips anything else (the
    # rulebook carries a few reclass-only codes like "1198000X"), and a
    # skipped row would stop the TB netting to zero.
    by_section = {}
    for code, r in rules.items():
        if not re.fullmatch(r"\d{3,}", code):
            continue
        by_section.setdefault(r["section"], []).append(code)
    for codes in by_section.values():
        codes.sort()

    rows = []          # (code, name, opening, closing)
    total = 0.0

    def emit(code, opening, closing):
        nonlocal total
        rows.append((code, rules[code]["name"], round(opening, 2), round(closing, 2)))
        total += round(closing, 2)

    def spread(section, target):
        """Split `target` across a section's codes with an uneven, but
        deterministic, distribution — a few large accounts and a long tail,
        the way a real ledger looks.

        Sections aren't uniformly one-sided: the revenue section carries
        contra-revenue accounts that are debits, asset sections carry
        provisions and accumulated depreciation that are credits. Signing
        purely by section would have put the contra-revenue accounts (which
        share the 6xxxxxx expense range) on the wrong side and made the Cost
        Center page's expense total negative. So split each section into its
        debit- and credit-natured codes, give the section's own side a bit
        more than the target and the contra side the remainder."""
        codes = pick(rng, by_section.get(section, []), share)
        if not codes:
            return
        debit = [c for c in codes if not is_credit(c, rules[c]["name"])]
        credit = [c for c in codes if is_credit(c, rules[c]["name"])]
        contra = 0.06
        if target < 0:                      # credit-natured section
            totals = [(credit, target * (1 + contra)), (debit, -target * contra)]
        else:                               # debit-natured section
            totals = [(debit, target * (1 + contra)), (credit, -target * contra)]
        for group, group_total in totals:
            if not group:
                continue
            weights = [rng.random() ** 2.5 + 0.01 for _ in group]
            s = sum(weights)
            for code, w in zip(group, weights):
                amt = group_total * w / s
                drift = rng.uniform(0.82, 1.18)      # opening differs from closing
                emit(code, amt * drift, amt)

    for section, weight in ASSET_SECTIONS.items():
        spread(section, scale * 0.42 * weight)
    for section, weight in LIAB_SECTIONS.items():
        spread(section, scale * 0.42 * weight)
    for section, weight in PL_WEIGHTS.items():
        spread(section, scale * weight)

    for code, amount in EQUITY_FIXED.items():
        if code in rules:
            emit(code, amount * share, amount * share)

    # These never land in a section (that's the point — the mapping review
    # has to surface them), so they must net to zero between themselves or
    # the grouped balance sheet inherits the difference.
    amt = round(rng.uniform(20_000, 90_000) * share, 2)
    for code, name in UNMAPPED:
        rows.append((code, name, amt, amt))
        total += amt
        amt = -amt

    # Retained earnings absorbs the remainder so the TB nets to zero.
    rows.append((RETAINED_CODE, rules[RETAINED_CODE]["name"], round(-total, 2), round(-total, 2)))

    rows.sort(key=lambda r: r[0])
    if not with_departments:
        return rows, None

    # Split expense accounts across departments; the department's readable
    # name lives in the account-name suffix, matching how these exports look.
    dept_rows = []
    for code, name, opening, closing in rows:
        if not code.startswith("6"):
            continue
        weights = [rng.random() ** 1.8 + 0.02 for _ in DEPARTMENTS]
        s = sum(weights)
        for (dept_code, dept_name), w in zip(DEPARTMENTS, weights):
            dept_rows.append((code, dept_code, f"{name}-{dept_name}",
                              round(opening * w / s, 2), round(closing * w / s, 2)))
    return rows, dept_rows


def csv_text(rows, dept_rows):
    def esc(v):
        v = str(v)
        return '"' + v.replace('"', '""') + '"' if ("," in v or '"' in v) else v
    if dept_rows:
        out = ["MainAccount,Department,Name,Opening balance,Closing balance"]
        seen = {c for c, *_ in dept_rows}
        for code, name, opening, closing in rows:
            if code in seen:
                continue
            out.append(f"{code},,{esc(name)},{opening},{closing}")
        for code, dept, name, opening, closing in dept_rows:
            out.append(f"{code},{dept},{esc(name)},{opening},{closing}")
        return "\r\n".join(out) + "\r\n"
    out = ["MainAccount,Name,Opening balance,Closing balance"]
    for code, name, opening, closing in rows:
        out.append(f"{code},{esc(name)},{opening},{closing}")
    return "\r\n".join(out) + "\r\n"


def main():
    rulebook = load_rulebook()
    rules = rulebook["rules"]
    for entity, size, share, with_departments in ENTITIES:
        rng = random.Random(f"{SEED}-{entity}")
        rows, dept_rows = build_entity(rng, rules, SCALE * size, share, with_departments)
        text = csv_text(rows, dept_rows)
        name = f"TB_{entity}_{PERIOD}.csv"
        (TEST_DIR / name).write_text(text, encoding="utf-8", newline="")
        n = len(dept_rows) if dept_rows else len(rows)
        print(f"  {entity:<6} {len(rows):>4} accounts  {n:>5} rows  -> test/{name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
