#input_type_name: ApproveContentPieceInput
#output_type_name: ApproveContentPieceResult
#function_name: approve_content_piece

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class ApproveContentPieceInput(BaseModel):
    content_piece_id: str


class ApproveContentPieceResult(BaseModel):
    content_piece_id: str
    idea_id: str
    status: str
    approved_at: str


ApproveContentPieceInput.model_rebuild()
ApproveContentPieceResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


async def approve_content_piece(
    ctx: FunctionContext,
    data: ApproveContentPieceInput,
) -> ApproveContentPieceResult:
    pod = Pod.from_env()
    piece = _record(pod.table("content_pieces").get(data.content_piece_id))
    if piece.get("status") == "shared":
        raise ValueError("Shared pieces cannot be approved again.")

    approved_at = datetime.now(timezone.utc).isoformat()
    updated = _record(pod.table("content_pieces").update(
        data.content_piece_id,
        {
            "status": "approved",
            "approved_at": approved_at,
            "shared_at": None,
        },
    ))
    pod.table("ideas").update(
        str(piece["idea_id"]),
        {
            "status": "approved",
            "assigned_voice": piece.get("voice"),
            "format_type": piece.get("format_type"),
        },
    )

    return ApproveContentPieceResult(
        content_piece_id=str(updated["id"]),
        idea_id=str(piece["idea_id"]),
        status="approved",
        approved_at=approved_at,
    )
