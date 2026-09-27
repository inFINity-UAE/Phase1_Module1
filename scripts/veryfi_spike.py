"""Veryfi sandbox spike — Module 1.1.B item #3 (feature-spec-1_1_B.md §0.2, §3).

Submits sample invoices to Veryfi's Receipts & Invoices endpoint and prints
whether the plan returns a confidence signal, plus whether spec §2 fields
are populated. This is a manual inspection tool, not production extraction.

Credentials come from the repo env files (`.env`, then any missing keys from
`.env.local`) — the same files Nest and Jest use. A variable already set in
the process environment is left as-is.

    pip install requests
    python scripts/veryfi_spike.py test-data/invoice1.pdf test-data/invoice2.jpg
"""

import base64
import json
import os
import sys

import requests

API_URL = "https://api.veryfi.com/api/v8/partner/documents"

REQUIRED_FIELDS = [
    "vendor",           # vendor name lives at vendor.name
    "invoice_number",
    "date",
    "line_items",
    "vat",               # Veryfi's VAT/tax field name may differ — check actual response
    "total",
]

# Fields we're specifically checking for any hint of confidence scoring.
# Veryfi's exact field name isn't confirmed in public docs, so this checks
# several plausible candidates plus does a generic scan for "confidence"
# anywhere in the response.
CONFIDENCE_CANDIDATES = [
    "is_duplicate",
    "ocr_confidence",
    "confidence",
    "field_confidence",
    "extraction_confidence",
]

VERYFI_ENV_KEYS = ("VERYFI_CLIENT_ID", "VERYFI_USERNAME", "VERYFI_API_KEY")


def load_repo_env():
    """Fill process env from repo-root `.env`, then `.env.local` for blanks.

    Matches this repo's convention: Nest reads `.env`; Jest reads `.env.local`;
    README says both hold the same values. Existing process env wins, and a
    blank placeholder in `.env.example` does not block a real value in the
    other file.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name in (".env", ".env.local"):
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if value:
                    os.environ.setdefault(key, value)


def build_headers():
    client_id = os.environ["VERYFI_CLIENT_ID"]
    username = os.environ["VERYFI_USERNAME"]
    api_key = os.environ["VERYFI_API_KEY"]
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Client-Id": client_id,
        "Authorization": f"apikey {username}:{api_key}",
    }


def submit_document(file_path: str, headers: dict) -> dict:
    with open(file_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "file_data": encoded,
        "file_name": os.path.basename(file_path),
        # Keep this synchronous for the spike so we get the result inline —
        # production batch processing (spec §4) should use async + webhook
        # instead, this is just for quick manual inspection.
        "async": False,
    }

    resp = requests.post(API_URL, headers=headers, data=json.dumps(payload))
    resp.raise_for_status()
    return resp.json()


def scan_for_confidence_signals(data: dict) -> list:
    found = []

    def walk(obj, path=""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                new_path = f"{path}.{k}" if path else k
                if "confiden" in k.lower() or k in CONFIDENCE_CANDIDATES:
                    found.append((new_path, v))
                walk(v, new_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                walk(item, f"{path}[{i}]")

    walk(data)
    return found


def check_required_fields(data: dict) -> dict:
    results = {}
    vendor = data.get("vendor") or {}
    results["vendor_name"] = vendor.get("name")
    results["invoice_number"] = data.get("invoice_number") or data.get("document_reference_number")
    results["date"] = data.get("date")
    results["line_items_count"] = len(data.get("line_items") or [])
    results["vat_amount"] = data.get("tax") or data.get("vat")
    results["total_amount"] = data.get("total")
    return results


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/veryfi_spike.py <file1> [file2] ...")
        sys.exit(1)

    load_repo_env()
    missing = [k for k in VERYFI_ENV_KEYS if not os.environ.get(k)]
    if missing:
        print("Missing in .env / .env.local (or the process environment):")
        for key in missing:
            print(f"  {key}")
        sys.exit(1)

    headers = build_headers()

    for file_path in sys.argv[1:]:
        print("=" * 70)
        print(f"File: {file_path}")
        print("=" * 70)

        try:
            data = submit_document(file_path, headers)
        except requests.HTTPError as e:
            print(f"  ERROR: {e}")
            print(f"  Response body: {e.response.text[:500]}")
            continue

        print("\n-- Required field check (spec §2) --")
        for field, value in check_required_fields(data).items():
            status = "OK" if value not in (None, "", 0) else "MISSING/NULL"
            print(f"  {field:20s} = {value!r:30s} [{status}]")

        print("\n-- Confidence signal scan --")
        signals = scan_for_confidence_signals(data)
        if signals:
            for path, value in signals:
                print(f"  FOUND: {path} = {value!r}")
        else:
            print("  No confidence-related field found anywhere in the response.")
            print("  (This would confirm §3's rule-based fallback is necessary,")
            print("   not just a safe default.)")

        # Dump the full raw response too, in case something's named
        # differently than expected above.
        out_file = f"{os.path.basename(file_path)}.veryfi_response.json"
        with open(out_file, "w") as f:
            json.dump(data, f, indent=2)
        print(f"\nFull raw response saved to: {out_file}")


if __name__ == "__main__":
    main()
