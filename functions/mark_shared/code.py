#input_type_name: MarkSharedInput
#output_type_name: MarkSharedResult
#function_name: mark_shared

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class MarkSharedInput(BaseModel):
    content_piece_id: str


class MarkSharedResult(BaseModel):
    content_piece_id: str
    idea_id: str
    status: str
    shared_at: str


MarkSharedInput.model_rebuild()
MarkSharedResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


async def mark_shared(ctx: FunctionContext, data: MarkSharedInput) -> MarkSharedResult:
    pod = Pod.from_env()
    piece = _record(pod.table("content_pieces").get(data.content_piece_id))
    if piece.get("status") not in {"approved", "queued"}:
        raise ValueError("Only approved or queued pieces can be marked shared.")

    shared_at = datetime.now(timezone.utc).isoformat()
    updated = _record(pod.table("content_pieces").update(
        data.content_piece_id,
        {
            "status": "shared",
            "shared_at": shared_at,
        },
    ))
    pod.table("ideas").update(
        str(piece["idea_id"]),
        {
            "status": "approved",
        },
    )

    return MarkSharedResult(
        content_piece_id=str(updated["id"]),
        idea_id=str(piece["idea_id"]),
        status="shared",
        shared_at=shared_at,
    )
