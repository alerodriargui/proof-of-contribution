from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import uuid
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _load_dotenv(path: str | Path = ".env") -> None:
    p = Path(path) if isinstance(path, str) else path
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from .x402 import (
    X402_VERSION,
    BASE_HEADER,
    SIGNATURE_HEADER,
    RESPONSE_HEADER,
    PaymentPayload,
    SettlementResponse,
    decode_header,
    encode_header,
    make_payment_required,
)
from .facilitator import MockFacilitator, RemoteFacilitator


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

DEFAULT_PORT = 8080
DEFAULT_PAY_TO = os.environ.get("X402_PAY_TO", "0x0000000000000000000000000000000000000000")
DEFAULT_AMOUNT = os.environ.get("X402_AMOUNT", "100000")
DEFAULT_NETWORK = os.environ.get("X402_NETWORK", "eip155:8453")
FACILITATOR_URL = os.environ.get("X402_FACILITATOR_URL", "")
CDP_API_KEY_ID = os.environ.get("CDP_API_KEY_ID", os.environ.get("X402_CDP_KEY_ID", ""))
CDP_API_KEY_SECRET = os.environ.get("CDP_API_KEY_SECRET", os.environ.get("X402_CDP_KEY_SECRET", ""))
FREE_TIER = os.environ.get("X402_FREE_TIER", "").lower() in ("1", "true", "yes")
MOCK_FACILITATOR = os.environ.get("X402_MOCK_FACILITATOR", "1").lower() in ("1", "true", "yes")


if FACILITATOR_URL:
    facilitator = RemoteFacilitator(FACILITATOR_URL, api_key_id=CDP_API_KEY_ID, api_key_secret=CDP_API_KEY_SECRET)
else:
    facilitator = MockFacilitator()


def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [row for row in reader]


def json_response(data: Any, status: int = 200) -> tuple[str, int, dict[str, str]]:
    body = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    return body, status, {"Content-Type": "application/json"}


def error_response(message: str, status: int = 400) -> tuple[str, int, dict[str, str]]:
    return json_response({"error": message}, status)


def handle_x402(handler: "APIHandler") -> tuple[str, int, dict[str, str]] | None:
    if FREE_TIER:
        return None

    signature_b64 = handler.headers.get(SIGNATURE_HEADER)
    if not signature_b64:
        pay_req = make_payment_required(
            url=f"http://{handler.headers.get('Host', 'localhost')}{handler.path}",
            description="Access programmatic data extraction API for crypto contribution data",
            pay_to=DEFAULT_PAY_TO,
            amount=DEFAULT_AMOUNT,
            network=DEFAULT_NETWORK,
        )
        body, status, headers = json_response(pay_req.to_dict(), 402)
        headers[BASE_HEADER] = encode_header(pay_req.to_dict())
        return body, status, headers

    try:
        payload_dict = decode_header(signature_b64)
    except ValueError as exc:
        return error_response(str(exc), 400)

    try:
        payload = PaymentPayload.from_dict(payload_dict)
    except Exception as exc:
        return error_response(f"invalid_payload: {exc}", 400)

    accepted = payload.accepted
    requirements = {
        "scheme": "exact",
        "network": DEFAULT_NETWORK,
        "amount": DEFAULT_AMOUNT,
        "asset": f"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payTo": DEFAULT_PAY_TO,
        "maxTimeoutSeconds": 60,
        "extra": {"name": "USDC", "version": "2"},
    }
    pay_requirements = type("obj", (object,), requirements)()

    from .x402 import PaymentRequirements
    pay_reqs = PaymentRequirements(
        scheme="exact",
        network=DEFAULT_NETWORK,
        amount=DEFAULT_AMOUNT,
        asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo=DEFAULT_PAY_TO,
        maxTimeoutSeconds=60,
        extra={"name": "USDC", "version": "2"},
    )

    result = facilitator.verify(payload, pay_reqs)
    if not result.isValid:
        pay_req = make_payment_required(
            url=f"http://{handler.headers.get('Host', 'localhost')}{handler.path}",
            description="Payment verification failed",
            pay_to=DEFAULT_PAY_TO,
            amount=DEFAULT_AMOUNT,
            network=DEFAULT_NETWORK,
            error=result.invalidReason,
        )
        body, status, headers = json_response(pay_req.to_dict(), 402)
        headers[BASE_HEADER] = encode_header(pay_req.to_dict())
        return body, status, headers

    settle_result = facilitator.settle(payload, pay_reqs)
    setattr(handler, "_x402_settlement", settle_result)
    setattr(handler, "_x402_payer", result.payer)
    return None


def wrap_with_x402(handler_class: type) -> type:
    class X402Wrapped(handler_class):
        def _x402_check(self) -> tuple[str, int, dict[str, str]] | None:
            return handle_x402(self)

        def _add_payment_response(self, headers: dict[str, str]) -> None:
            settlement: SettlementResponse | None = getattr(self, "_x402_settlement", None)
            if settlement and settlement.success:
                headers[RESPONSE_HEADER] = encode_header(settlement.to_dict())

        def end_headers(self) -> None:
            if hasattr(self, "_x402_pending_headers"):
                for key, value in self._x402_pending_headers.items():
                    self.send_header(key, value)
            super().end_headers()

        def send_response(self, code: int, message: str | None = None) -> None:
            super().send_response(code, message)
            if hasattr(self, "_x402_pending_headers"):
                for key, value in self._x402_pending_headers.items():
                    self.send_header(key, value)

    return X402Wrapped


class APIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        payer = getattr(self, "_x402_payer", "")
        payer_info = f" payer={payer[:10]}..." if payer else ""
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {args[0]} {args[1]} {args[2]}{payer_info}")

    def _serve_api(self) -> tuple[str, int, dict[str, str]]:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/v1/summary":
            data = load_json(DATA_DIR / "dashboard-summary.json")
            if data is None:
                return error_response("Summary data not available", 404)
            return json_response(data)

        if path == "/api/v1/meta":
            data = load_json(DATA_DIR / "dashboard-meta.json")
            if data is None:
                return error_response("Meta data not available", 404)
            return json_response(data)

        if path == "/api/v1/stats":
            data = load_json(DATA_DIR / "stats-aggregation.json")
            if data is None:
                return error_response("Stats data not available", 404)
            return json_response(data)

        if path == "/api/v1/ecosystems":
            summary = load_json(DATA_DIR / "dashboard-summary.json")
            if summary and isinstance(summary, dict) and "ecosystems" in summary:
                return json_response(summary["ecosystems"])
            ecosystems = []
            for f in DATA_DIR.glob("*_merged_prs.csv"):
                name = f.stem.replace("_merged_prs", "")
                ecosystems.append({"id": name, "name": name.capitalize()})
            return json_response(ecosystems)

        eco_match = re.match(r"^/api/v1/ecosystems/([^/]+)/prs$", path)
        if eco_match:
            eco_id = eco_match.group(1)
            csv_path = DATA_DIR / f"{eco_id}_merged_prs.csv"
            rows = load_csv(csv_path)
            if not rows:
                alt_path = DATA_DIR / f"{eco_id}_merged_prs.csv"
                rows = load_csv(alt_path)
            if not rows:
                return error_response(f"Ecosystem '{eco_id}' not found", 404)
            return json_response({"ecosystem": eco_id, "count": len(rows), "rows": rows})

        user_match = re.match(r"^/api/v1/contributors/([^/]+)$", path)
        if user_match:
            username = user_match.group(1).lower()
            summary = load_json(DATA_DIR / "dashboard-summary.json")
            if summary and isinstance(summary, dict) and "rows" in summary:
                user_rows = [r for r in summary["rows"] if r.get("usuario", "").lower() == username or r.get("user", "").lower() == username]
                if user_rows:
                    return json_response({"contributor": username, "entries": user_rows})
            for f in DATA_DIR.glob("*_merged_prs.csv"):
                rows = load_csv(f)
                matched = [r for r in rows if r.get("usuario", "").lower() == username]
                if matched:
                    eco_name = f.stem.replace("_merged_prs", "")
                    return json_response({"contributor": username, "ecosystem": eco_name, "rows": matched})
            return error_response(f"Contributor '{username}' not found", 404)

        if path == "/api/v1/facilitator/supported":
            return json_response(facilitator.get_supported())

        if path == "/api/v1/facilitator/verify" and self.command == "POST":
            content_len = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_len).decode()) if content_len else {}
            from .x402 import PaymentPayload, PaymentRequirements
            pp = PaymentPayload.from_dict(body.get("paymentPayload", {}))
            pr = PaymentRequirements.from_dict(body.get("paymentRequirements", {}))
            result = facilitator.verify(pp, pr)
            return json_response(result.to_dict())

        if path == "/api/v1/facilitator/settle" and self.command == "POST":
            content_len = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_len).decode()) if content_len else {}
            from .x402 import PaymentPayload, PaymentRequirements
            pp = PaymentPayload.from_dict(body.get("paymentPayload", {}))
            pr = PaymentRequirements.from_dict(body.get("paymentRequirements", {}))
            result = facilitator.settle(pp, pr)
            return json_response(result.to_dict())

        if path == "/api/v1/health":
            return json_response({"status": "ok", "x402Version": X402_VERSION, "timestamp": time.time()})

        return error_response(f"Not found: {path}", 404)

    def _handle_api(self) -> None:
        x402_result = handle_x402(self)
        if x402_result is not None:
            body, status, headers = x402_result
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            if body:
                self.send_header("Content-Length", str(len(body.encode())))
            self.end_headers()
            if body:
                self.wfile.write(body.encode())
            return

        try:
            body, status, headers = self._serve_api()
        except Exception as exc:
            body, status, headers = error_response(f"Internal server error: {exc}", 500)

        self._add_payment_response(headers)
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        if body:
            self.send_header("Content-Length", str(len(body.encode())))
        self.end_headers()
        if body:
            self.wfile.write(body.encode())

    def translate_path(self, path: str) -> str:
        if path.startswith("/api/"):
            return path
        if re.match(r"^/contributors/", path):
            path = "/contributors/index.html"
        if path == "/" or path == "":
            path = "/index.html"
        return super().translate_path(path)

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            self._handle_api()
        else:
            parsed = urlparse(self.path)
            path = parsed.path
            if re.match(r"^/contributors/", path):
                path = "/contributors/index.html"
            orig_path = self.path
            self.path = path
            try:
                super().do_GET()
            finally:
                self.path = orig_path

    def do_POST(self) -> None:
        if self.path.startswith("/api/"):
            self._handle_api()
        else:
            self.send_response(405)
            self.end_headers()

    def _add_payment_response(self, headers: dict[str, str]) -> None:
        settlement: SettlementResponse | None = getattr(self, "_x402_settlement", None)
        if settlement and settlement.success:
            headers[RESPONSE_HEADER] = encode_header(settlement.to_dict())


def create_server(port: int = DEFAULT_PORT) -> HTTPServer:
    server = HTTPServer(("0.0.0.0", port), APIHandler)
    return server


def main() -> None:
    port = int(os.environ.get("PORT") or sys.argv[1]) if "PORT" in os.environ or len(sys.argv) > 1 else DEFAULT_PORT
    free_mode = "FREE" if FREE_TIER else "PAID (x402)"
    mock_mode = "mock" if MOCK_FACILITATOR else f"remote ({FACILITATOR_URL})"

    pay_to_short = DEFAULT_PAY_TO
    if len(pay_to_short) > 20:
        pay_to_short = f"{DEFAULT_PAY_TO[:10]}...{DEFAULT_PAY_TO[-6:]}"

    is_placeholder = DEFAULT_PAY_TO.lower().replace("0x", "").startswith("0000000")
    print(f"Proof of Contribution API server")
    print(f"  Mode: {free_mode}")
    print(f"  You receive payments at: {pay_to_short}")
    print(f"  Facilitator: {mock_mode}")
    print(f"  Network: {DEFAULT_NETWORK}")
    print(f"  Price: {DEFAULT_AMOUNT} atomic units ({int(DEFAULT_AMOUNT) / 10**6:.2f} USDC if 6 decimals)")
    if is_placeholder:
        print(f"  [WARNING] X402_PAY_TO is not set! Set it to YOUR wallet address to receive USDC.")
    if MOCK_FACILITATOR and not is_placeholder:
        print(f"  [WARNING] Using mock facilitator - NO real on-chain settlement occurs.")
        print(f"    Set X402_FACILITATOR_URL and X402_MOCK_FACILITATOR=false for real payments.")
    print(f"  Listening on http://0.0.0.0:{port}")
    print()
    print("API endpoints:")
    print("  GET  /api/v1/health")
    print("  GET  /api/v1/summary")
    print("  GET  /api/v1/meta")
    print("  GET  /api/v1/stats")
    print("  GET  /api/v1/ecosystems")
    print("  GET  /api/v1/ecosystems/{id}/prs")
    print("  GET  /api/v1/contributors/{username}")
    print("  GET  /api/v1/facilitator/supported")
    print("  POST /api/v1/facilitator/verify")
    print("  POST /api/v1/facilitator/settle")
    print()
    if not FREE_TIER:
        print("x402 payment required. Include PAYMENT-SIGNATURE header with valid")
        print("payment payload. See docs at /app/docs.html for details.")
        print()

    server = create_server(port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
