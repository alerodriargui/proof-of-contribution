from __future__ import annotations

import json
import time
import secrets
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import URLError

from .x402 import (
    X402_VERSION,
    PaymentPayload,
    PaymentRequirements,
    SettlementResponse,
    VerifyResponse,
    verify_payload,
)


def default_config() -> dict[str, Any]:
    return {
        "supported": [
            {
                "x402Version": X402_VERSION,
                "scheme": "exact",
                "network": "eip155:8453",
            },
            {
                "x402Version": X402_VERSION,
                "scheme": "exact",
                "network": "eip155:84532",
            },
        ],
        "signers": {
            "eip155:*": ["0x0000000000000000000000000000000000000000"],
        },
    }


class MockFacilitator:
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or default_config()
        self._verify_nonces: set[str] = set()

    def verify(
        self,
        payment_payload: PaymentPayload,
        payment_requirements: PaymentRequirements,
    ) -> VerifyResponse:
        if payment_payload.x402Version != X402_VERSION:
            return VerifyResponse(isValid=False, invalidReason="invalid_x402_version")

        auth = payment_payload.payload.get("authorization", {})
        nonce = auth.get("nonce", "")
        if nonce and nonce in self._verify_nonces:
            return VerifyResponse(isValid=False, invalidReason="replay_detected")
        if nonce:
            self._verify_nonces.add(nonce)

        is_valid, reason = verify_payload(payment_payload, payment_requirements)
        if not is_valid:
            return VerifyResponse(isValid=False, invalidReason=reason, payer=auth.get("from", ""))

        payer = auth.get("from", "0x0000000000000000000000000000000000000000")
        return VerifyResponse(isValid=True, payer=payer)

    def settle(
        self,
        payment_payload: PaymentPayload,
        payment_requirements: PaymentRequirements,
    ) -> SettlementResponse:
        auth = payment_payload.payload.get("authorization", {})

        is_valid, reason = verify_payload(payment_payload, payment_requirements)
        if not is_valid:
            return SettlementResponse(
                success=False,
                errorReason=reason,
                payer=auth.get("from", ""),
                network=payment_requirements.network,
            )

        tx_hash = "0x" + secrets.token_hex(32)
        return SettlementResponse(
            success=True,
            payer=auth.get("from", ""),
            transaction=tx_hash,
            network=payment_requirements.network,
            amount=payment_requirements.amount,
        )

    def get_supported(self) -> dict[str, Any]:
        return self.config

    def verify_http(self, body: dict[str, Any]) -> dict[str, Any]:
        payload = PaymentPayload.from_dict(body.get("paymentPayload", {}))
        requirements = PaymentRequirements.from_dict(body.get("paymentRequirements", {}))
        result = self.verify(payload, requirements)
        return result.to_dict()

    def settle_http(self, body: dict[str, Any]) -> dict[str, Any]:
        payload = PaymentPayload.from_dict(body.get("paymentPayload", {}))
        requirements = PaymentRequirements.from_dict(body.get("paymentRequirements", {}))
        result = self.settle(payload, requirements)
        return result.to_dict()


class RemoteFacilitator:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(body).encode()
        req = Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except URLError as exc:
            return {"isValid": False, "invalidReason": f"facilitator_error: {exc.reason}"}

    def verify(
        self,
        payment_payload: PaymentPayload,
        payment_requirements: PaymentRequirements,
    ) -> VerifyResponse:
        body = {
            "x402Version": X402_VERSION,
            "paymentPayload": payment_payload.to_dict(),
            "paymentRequirements": payment_requirements.to_dict(),
        }
        result = self._post("/verify", body)
        return VerifyResponse.from_dict(result)

    def settle(
        self,
        payment_payload: PaymentPayload,
        payment_requirements: PaymentRequirements,
    ) -> SettlementResponse:
        body = {
            "x402Version": X402_VERSION,
            "paymentPayload": payment_payload.to_dict(),
            "paymentRequirements": payment_requirements.to_dict(),
        }
        result = self._post("/settle", body)
        return SettlementResponse.from_dict(result)

    def get_supported(self) -> dict[str, Any]:
        req = Request(f"{self.base_url}/supported")
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except URLError:
            return {"kinds": [], "extensions": [], "signers": {}}
