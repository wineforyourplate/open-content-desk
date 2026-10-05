#input_type_name: ReviseUnsupportedClaimsInput
#output_type_name: ReviseUnsupportedClaimsResult
#function_name: revise_unsupported_claims

from __future__ import annotations

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class ReviseUnsupportedClaimsInput(BaseModel):
    content_piece_id: str


class ReviseUnsupportedClaimsResult(BaseModel):
    content_piece_id: str
    draft_text: str
    version: int
    revised_count: int


ReviseUnsupportedClaimsInput.model_rebuild()
ReviseUnsupportedClaimsResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


SAFE_REPLACEMENTS = {
    "Lemma auto-posts to social networks in V1.": "Lemma keeps publishing manual in this phase, so the content owner can review and share intentionally.",
    "Lemma removes the need for human decisions.": "Lemma keeps human decisions explicit in the workflow instead of hiding them in chat.",
    "Every company can replace all software with one pod immediately.": "A focused pod can replace a scattered tool loop when the use case has clear state, permissions, and review points.",
}


def _revise_text(draft_text: str, claim_check_result: dict | None) -> tuple[str, int]:
    revised = draft_text
    revised_count = 0
    labels = (claim_check_result or {}).get("labels") or []
    unsupported_claims = [item.get("claim") for item in labels if item.get("label") == "unsupported" and item.get("claim")]

    for claim in unsupported_claims:
        replacement = SAFE_REPLACEMENTS.get(
            claim,
            "Safer version: this needs either profile evidence or narrower wording before publishing.",
        )
        if claim in revised:
            revised = revised.replace(claim, replacement)
            revised_count += 1

    return revised, revised_count


async def revise_unsupported_claims(
    ctx: FunctionContext,
    data: ReviseUnsupportedClaimsInput,
) -> ReviseUnsupportedClaimsResult:
    pod = Pod.from_env()
    piece = _record(pod.table("content_pieces").get(data.content_piece_id))
    revised_text, revised_count = _revise_text(piece.get("draft_text") or "", piece.get("claim_check_result"))
    version = int(piece.get("version") or 1) + (1 if revised_count else 0)

    updated = _record(pod.table("content_pieces").update(
        data.content_piece_id,
        {
            "draft_text": revised_text,
            "version": version,
            "status": "draft",
            "claim_check_result": None,
        },
    ))

    return ReviseUnsupportedClaimsResult(
        content_piece_id=str(updated["id"]),
        draft_text=revised_text,
        version=version,
        revised_count=revised_count,
    )
