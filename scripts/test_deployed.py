from __future__ import annotations

import base64
import json
import secrets
import time
import urllib.request
from urllib.error import HTTPError

BASE = "https://proof-of-contribution.onrender.com"


def test_health():
    resp = urllib.request.urlopen(f"{BASE}/api/v1/health", timeout=15)
    data = json.loads(resp.read())
    print(f"Health: {data}")
    return data


def test_402():
    print("\n--- Request without payment ---")
    req = urllib.request.Request(f"{BASE}/api/v1/summary")
    try:
        urllib.request.urlopen(req)
        print("  Unexpected success")
    except HTTPError as e:
        print(f"  Status: {e.code}")
        b64 = e.headers.get("PAYMENT-REQUIRED")
        print(f"  PAYMENT-REQUIRED header: {b64 is not None}")
        if b64:
            body = json.loads(base64.b64decode(b64).decode())
            req_info = body["accepts"][0]
            print(f"  Your wallet: {req_info['payTo'][:10]}...{req_info['payTo'][-6:]}")
            print(f"  Network: {req_info['network']}")
            print(f"  Amount: {req_info['amount']}")
            return body
    return None


def test_paid(payment_required):
    print("\n--- Request with PAYMENT-SIGNATURE ---")
    accepted = payment_required["accepts"][0]
    now = int(time.time())
    nonce = "0x" + secrets.token_hex(32)
    payload = {
        "x402Version": 2,
        "resource": payment_required["resource"],
        "accepted": accepted,
        "payload": {
            "signature": "0x" + "ab" * 32,
            "authorization": {
                "from": "0xTestWallet00000000000000000000000000000000",
                "to": accepted["payTo"],
                "value": accepted["amount"],
                "validAfter": str(now - 10),
                "validBefore": str(now + 50),
                "nonce": nonce,
            },
        },
    }
    sig_b64 = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    req = urllib.request.Request(
        f"{BASE}/api/v1/summary",
        headers={"PAYMENT-SIGNATURE": sig_b64},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"  Status: {resp.status}")
        pay_resp_b64 = resp.headers.get("PAYMENT-RESPONSE")
        if pay_resp_b64:
            settlement = json.loads(base64.b64decode(pay_resp_b64).decode())
            print(f"  Settlement success: {settlement.get('success')}")
            print(f"  TX hash: {settlement.get('transaction', '')[:20]}...")
        data = json.loads(resp.read())
        if isinstance(data, dict):
            rows = data.get("rows", [])
            print(f"  Data rows: {len(rows)}")
        return data
    except HTTPError as e:
        print(f"  Payment failed: {e.code}")
        print(f"  Response: {e.read().decode()[:300]}")
        return None


def test_free_endpoints():
    print("\n--- Static pages ---")
    for path, label in [("/", "Landing"), ("/app/", "Dashboard"), ("/app/docs.html", "Docs")]:
        try:
            resp = urllib.request.urlopen(f"{BASE}{path}", timeout=15)
            print(f"  {label}: {resp.status} ({len(resp.read())} bytes)")
        except Exception as e:
            print(f"  {label}: {e}")


if __name__ == "__main__":
    test_free_endpoints()
    pr = test_402()
    if pr:
        test_paid(pr)
