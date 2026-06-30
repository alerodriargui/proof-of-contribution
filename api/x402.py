from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Any


X402_VERSION = 2
BASE_HEADER = "PAYMENT-REQUIRED"
SIGNATURE_HEADER = "PAYMENT-SIGNATURE"
RESPONSE_HEADER = "PAYMENT-RESPONSE"


@dataclass
class ResourceInfo:
    url: str
    description: str = ""
    mimeType: str = "application/json"
    serviceName: str = ""
    tags: list[str] = field(default_factory=list)
    iconUrl: str = ""


@dataclass
class PaymentRequirements:
    scheme: str = "exact"
    network: str = "eip155:8453"
    amount: str = "100000"
    asset: str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    payTo: str = ""
    maxTimeoutSeconds: int = 60
    extra: dict[str, Any] = field(default_factory=lambda: {"name": "USDC", "version": "2"})

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v != "" and v is not None}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PaymentRequirements:
        return cls(
            scheme=d.get("scheme", "exact"),
            network=d.get("network", "eip155:8453"),
            amount=d.get("amount", "100000"),
            asset=d.get("asset", ""),
            payTo=d.get("payTo", ""),
            maxTimeoutSeconds=d.get("maxTimeoutSeconds", 60),
            extra=d.get("extra", {}),
        )


@dataclass
class PaymentRequired:
    x402Version: int = X402_VERSION
    error: str = ""
    resource: ResourceInfo = field(default_factory=ResourceInfo)
    accepts: list[PaymentRequirements] = field(default_factory=list)
    extensions: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "x402Version": self.x402Version,
            "error": self.error,
            "resource": {k: v for k, v in asdict(self.resource).items() if v != "" and v is not None},
            "accepts": [r.to_dict() for r in self.accepts],
            "extensions": self.extensions,
        }


@dataclass
class PaymentAuthorization:
    from_addr: str = ""
    to: str = ""
    value: str = ""
    validAfter: str = ""
    validBefore: str = ""
    nonce: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "from": self.from_addr,
            "to": self.to,
            "value": self.value,
            "validAfter": self.validAfter,
            "validBefore": self.validBefore,
            "nonce": self.nonce,
        }

    @classmethod
    def from_dict(cls, d: dict[str, str]) -> PaymentAuthorization:
        return cls(
            from_addr=d.get("from", ""),
            to=d.get("to", ""),
            value=d.get("value", ""),
            validAfter=d.get("validAfter", ""),
            validBefore=d.get("validBefore", ""),
            nonce=d.get("nonce", ""),
        )


@dataclass
class PaymentPayload:
    x402Version: int = X402_VERSION
    resource: ResourceInfo | None = None
    accepted: PaymentRequirements = field(default_factory=PaymentRequirements)
    payload: dict[str, Any] = field(default_factory=dict)
    extensions: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "x402Version": self.x402Version,
            "accepted": self.accepted.to_dict(),
            "payload": self.payload,
            "extensions": self.extensions,
        }
        if self.resource:
            d["resource"] = {k: v for k, v in asdict(self.resource).items() if v != "" and v is not None}
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PaymentPayload:
        resource = None
        if "resource" in d:
            rd = d["resource"]
            resource = ResourceInfo(
                url=rd.get("url", ""),
                description=rd.get("description", ""),
                mimeType=rd.get("mimeType", "application/json"),
                serviceName=rd.get("serviceName", ""),
                tags=rd.get("tags", []),
                iconUrl=rd.get("iconUrl", ""),
            )
        return cls(
            x402Version=d.get("x402Version", X402_VERSION),
            resource=resource,
            accepted=PaymentRequirements.from_dict(d.get("accepted", {})),
            payload=d.get("payload", {}),
            extensions=d.get("extensions", {}),
        )


@dataclass
class SettlementResponse:
    success: bool = False
    errorReason: str = ""
    payer: str = ""
    transaction: str = ""
    network: str = ""
    amount: str = ""
    extensions: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "success": self.success,
            "transaction": self.transaction,
            "network": self.network,
        }
        if self.payer:
            d["payer"] = self.payer
        if self.errorReason:
            d["errorReason"] = self.errorReason
        if self.amount:
            d["amount"] = self.amount
        if self.extensions:
            d["extensions"] = self.extensions
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SettlementResponse:
        return cls(
            success=d.get("success", False),
            errorReason=d.get("errorReason", ""),
            payer=d.get("payer", ""),
            transaction=d.get("transaction", ""),
            network=d.get("network", ""),
            amount=d.get("amount", ""),
            extensions=d.get("extensions", {}),
        )


@dataclass
class VerifyResponse:
    isValid: bool = False
    invalidReason: str = ""
    payer: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"isValid": self.isValid}
        if self.invalidReason:
            d["invalidReason"] = self.invalidReason
        if self.payer:
            d["payer"] = self.payer
        if self.extra:
            d["extra"] = self.extra
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> VerifyResponse:
        return cls(
            isValid=d.get("isValid", False),
            invalidReason=d.get("invalidReason", ""),
            payer=d.get("payer", ""),
            extra=d.get("extra", {}),
        )


def encode_header(obj: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode()


def decode_header(value: str) -> dict[str, Any]:
    try:
        raw = base64.b64decode(value).decode()
        return json.loads(raw)
    except (json.JSONDecodeError, base64.binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError(f"Invalid x402 header: {exc}")


def make_payment_required(
    url: str,
    description: str = "",
    pay_to: str = "",
    amount: str = "100000",
    network: str = "eip155:8453",
    error: str = "PAYMENT-SIGNATURE header is required",
    service_name: str = "Proof of Contribution API",
) -> PaymentRequired:
    return PaymentRequired(
        error=error,
        resource=ResourceInfo(
            url=url,
            description=description,
            mimeType="application/json",
            serviceName=service_name,
            tags=["crypto", "open-source", "contributions"],
        ),
        accepts=[
            PaymentRequirements(
                amount=amount,
                network=network,
                payTo=pay_to,
            )
        ],
    )


def verify_payload(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
) -> tuple[bool, str]:
    if payload.x402Version != X402_VERSION:
        return False, "invalid_x402_version"
    if payload.accepted.scheme != requirements.scheme:
        return False, "invalid_scheme"
    if payload.accepted.network != requirements.network:
        return False, "invalid_network"
    if payload.accepted.asset != requirements.asset:
        return False, "invalid_payload"
    if payload.accepted.amount != requirements.amount:
        return False, "invalid_exact_evm_payload_authorization_value_mismatch"

    auth = payload.payload.get("authorization", {})
    if not auth.get("signature") and not payload.payload.get("signature"):
        return False, "invalid_exact_evm_payload_signature"
    if not auth.get("from"):
        return False, "invalid_payload"

    now = int(time.time())
    valid_after = int(auth.get("validAfter", 0))
    valid_before = int(auth.get("validBefore", 0))
    if now < valid_after:
        return False, "invalid_exact_evm_payload_authorization_valid_after"
    if now > valid_before:
        return False, "invalid_exact_evm_payload_authorization_valid_before"

    return True, ""
