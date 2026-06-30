from __future__ import annotations

import base64
import json
import time

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ed25519

    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def generate_cdp_jwt(
    api_key_id: str,
    api_key_secret: str,
    request_method: str,
    request_host: str,
    request_path: str,
    expires_in: int = 120,
) -> str:
    if not HAS_CRYPTOGRAPHY:
        raise ImportError(
            "cryptography library required for CDP JWT generation. "
            "Install with: pip install cryptography"
        )

    try:
        key_data = json.loads(api_key_secret)
        private_key_b64 = key_data["privateKey"]
    except (json.JSONDecodeError, KeyError, TypeError):
        private_key_b64 = api_key_secret

    raw_key = base64.b64decode(private_key_b64)

    if len(raw_key) == 64:
        seed = raw_key[:32]
    elif len(raw_key) == 32:
        seed = raw_key
    else:
        raise ValueError(f"Unexpected private key length: {len(raw_key)} bytes")

    private_key = ed25519.Ed25519PrivateKey.from_private_bytes(seed)

    now = int(time.time())
    header = {"alg": "EdDSA", "typ": "JWT"}
    payload = {
        "sub": api_key_id,
        "iss": "cdp",
        "aud": f"{request_host}{request_path}",
        "nbf": now - 30,
        "exp": now + expires_in,
        "iat": now,
    }

    message = _b64url(json.dumps(header, separators=(",", ":")).encode()) + "." + _b64url(
        json.dumps(payload, separators=(",", ":")).encode()
    )
    signature = private_key.sign(message.encode())

    return message + "." + _b64url(signature)
