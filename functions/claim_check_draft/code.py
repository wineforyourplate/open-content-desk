#input_type_name: ClaimCheckDraftInput
#output_type_name: ClaimCheckDraftResult
#function_name: claim_check_draft

from __future__ import annotations

from datetime import datetime, timezone
import re

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class ClaimLabel(BaseModel):
    claim: str
    label: str
    reason: str
    evidence: str | None = None


class ClaimCheckDraftInput(BaseModel):
    content_piece_id: str


class ClaimCheckDraftResult(BaseModel):
    content_piece_id: str
    labels: list[ClaimLabel]
    summary: str
    checked_at: str


ClaimCheckDraftInput.model_rebuild()
ClaimLabel.model_rebuild()
ClaimCheckDraftResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def _items(response) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    if isinstance(payload, dict):
        return payload.get("items", [])
    return payload if isinstance(payload, list) else []


def _split_claims(text: str) -> list[str]:
    rough = re.split(r"(?<=[.!?])\s+|\n\n+", text)
    return [part.strip() for part in rough if len(part.strip()) > 20]


def _profile_lists(profile: dict) -> tuple[list[str], list[str], list[str]]:
    product = profile.get("product_json") or {}
    return (
        list(product.get("allowed_claims") or []),
        list(product.get("blocked_claims") or []),
        list(product.get("proof_points") or []),
    )


def _contains_any(value: str, needles: list[str]) -> str | None:
    lowered = value.lower()
    for needle in needles:
        if needle.lower() in lowered or lowered in needle.lower():
            return needle
    return None


def _label_claim(claim: str, allowed: list[str], blocked: list[str], proof_points: list[str]) -> ClaimLabel:
    blocked_match = _contains_any(claim, blocked)
    if blocked_match:
        return ClaimLabel(
            claim=claim,
            label="unsupported",
            reason="Matches a guardrail or blocked claim in the context profile.",
            evidence=blocked_match,
        )

    lowered = claim.lower()
    if any(term in lowered for term in ["auto-post", "removes the need", "replace all software", "guarantee"]):
        return ClaimLabel(
            claim=claim,
            label="unsupported",
            reason="Makes a capability or guarantee the context profile does not allow.",
            evidence=None,
        )

    supported_match = _contains_any(claim, allowed + proof_points)
    if supported_match:
        return ClaimLabel(
            claim=claim,
            label="supported",
            reason="Grounded in the context profile.",
            evidence=supported_match,
        )

    if any(term in lowered for term in ["valuable", "better", "best", "changes", "confidence", "useful"]):
        return ClaimLabel(
            claim=claim,
            label="weak",
                reason="Plausible framing, but it needs stronger evidence from the context profile.",
            evidence=None,
        )

    return ClaimLabel(
        claim=claim,
        label="weak",
        reason="Not directly supported by the current context profile.",
        evidence=None,
    )


async def claim_check_draft(ctx: FunctionContext, data: ClaimCheckDraftInput) -> ClaimCheckDraftResult:
    pod = Pod.from_env()
    piece = _record(pod.table("content_pieces").get(data.content_piece_id))
    profiles = _items(pod.table("context_profile").list(limit=20))
    active_profiles = [row for row in profiles if row.get("status") == "active"]
    profile = active_profiles[0] if active_profiles else (profiles[0] if profiles else {})
    allowed, blocked, proof_points = _profile_lists(profile)

    labels = [_label_claim(claim, allowed, blocked, proof_points) for claim in _split_claims(piece.get("draft_text") or "")]
    if not labels:
        labels = [
            ClaimLabel(
                claim="No checkable claims found.",
                label="weak",
                reason="The draft does not contain enough concrete claims to verify.",
                evidence=None,
            )
        ]

    checked_at = datetime.now(timezone.utc).isoformat()
    result = {
        "checked_at": checked_at,
        "labels": [label.model_dump() for label in labels],
        "summary": _summary(labels),
    }
    pod.table("content_pieces").update(data.content_piece_id, {"claim_check_result": result})

    return ClaimCheckDraftResult(
        content_piece_id=data.content_piece_id,
        labels=labels,
        summary=result["summary"],
        checked_at=checked_at,
    )


def _summary(labels: list[ClaimLabel]) -> str:
    counts = {"supported": 0, "weak": 0, "unsupported": 0}
    for label in labels:
        counts[label.label] = counts.get(label.label, 0) + 1
    return f"{counts['supported']} supported, {counts['weak']} weak, {counts['unsupported']} unsupported."
