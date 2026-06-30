from __future__ import annotations

import base64
import json
import secrets
import time
import urllib.request
from urllib.error import HTTPError

BASE = "http://localhost:8080"
AMOUNT = "100000"
NETWORK = "eip155:8453"
ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
PAY_TO = "0x282A9f0387d7f1827AfDe519ac127531C7A6F7D2"


def step1_request_without_payment():
    print("=== Step 1: Request without payment ===")
    req = urllib.request.Request(f"{BASE}/api/v1/summary")
    try:
        resp = urllib.request.urlopen(req)
        print("  Unexpected success — server may be in free tier mode")
        return None
    except HTTPError as e:
        print(f"  Status: {e.code}")
        if e.code != 402:
            print(f"  Unexpected status. Response: {e.read().decode()[:200]}")
            return None
        pay_req_b64 = e.headers.get("PAYMENT-REQUIRED")
        if not pay_req_b64:
            print("  No PAYMENT-REQUIRED header!")
            return None
        payment_required = json.loads(base64.b64decode(pay_req_b64).decode())
        print(f"  x402Version: {payment_required['x402Version']}")
        print(f"  Resource: {payment_required['resource']['url']}")
        print(f"  Accepts: {len(payment_required['accepts'])} payment method(s)")
        req_info = payment_required["accepts"][0]
        print(f"    Amount: {req_info['amount']} ({int(req_info['amount'])/10**6} USDC)")
        print(f"    Network: {req_info['network']}")
        print(f"    Pay to: {req_info['payTo'][:10]}...{req_info['payTo'][-6:]}")
        return payment_required


def step2_create_payment_payload(payment_required):
    print("\n=== Step 2: Create payment payload ===")
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
                "from": "0xClientWalletAddress000000000000000000000000",
                "to": accepted["payTo"],
                "value": accepted["amount"],
                "validAfter": str(now - 10),
                "validBefore": str(now + 50),
                "nonce": nonce,
            },
        },
    }
    sig_b64 = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    print(f"  Nonce: {nonce[:20]}...")
    print(f"  From:  0xClientWallet...000000")
    print(f"  To:    {accepted['payTo'][:10]}...{accepted['payTo'][-6:]}")
    print(f"  Value: {accepted['amount']}")
    return sig_b64


def step3_request_with_payment(sig_b64):
    print("\n=== Step 3: Request with PAYMENT-SIGNATURE ===")
    req = urllib.request.Request(
        f"{BASE}/api/v1/summary",
        headers={"PAYMENT-SIGNATURE": sig_b64},
    )
    try:
        resp = urllib.request.urlopen(req)
    except HTTPError as e:
        print(f"  Payment failed: {e.code}")
        body = e.read().decode()[:300]
        print(f"  {body}")
        return None

    print(f"  Status: {resp.status}")
    pay_resp_b64 = resp.headers.get("PAYMENT-RESPONSE")
    if pay_resp_b64:
        settlement = json.loads(base64.b64decode(pay_resp_b64).decode())
        print(f"  Settlement success: {settlement['success']}")
        print(f"  Transaction: {settlement['transaction'][:20]}...")
        print(f"  Payer: {settlement['payer'][:10]}...")
    data = json.loads(resp.read())
    print(f"  Data received: {type(data).__name__}")
    if isinstance(data, dict):
        rows = data.get("rows", [])
        print(f"  Rows in response: {len(rows)}")
    return data


def test_free_tier_endpoints():
    print("\n=== Free tier: direct endpoint tests ===")
    endpoints = [
        ("/api/v1/health", "Health check"),
        ("/api/v1/ecosystems", "Ecosystems list"),
        ("/api/v1/meta", "Dashboard meta"),
    ]
    for path, label in endpoints:
        try:
            resp = urllib.request.urlopen(f"{BASE}{path}")
            data = resp.read()
            print(f"  {label}: {resp.status} ({len(data)} bytes)")
        except Exception as e:
            print(f"  {label}: {e}")


if __name__ == "__main__":
    payment_required = step1_request_without_payment()
    if payment_required:
        sig_b64 = step2_create_payment_payload(payment_required)
        if sig_b64:
            step3_request_with_payment(sig_b64)
    test_free_tier_endpoints()
