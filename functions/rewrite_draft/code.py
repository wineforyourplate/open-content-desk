#input_type_name: RewriteDraftInput
#output_type_name: RewriteDraftResult
#function_name: rewrite_draft

from __future__ import annotations

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class RewriteDraftInput(BaseModel):
    content_piece_id: str
    steering_instruction: str = Field(min_length=1, max_length=1200)


class RewriteDraftResult(BaseModel):
    content_piece_id: str
    status: str
    draft_text: str
    version: int
    steering_instruction: str


RewriteDraftInput.model_rebuild()
RewriteDraftResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def _rewrite_text(draft_text: str, instruction: str) -> str:
    paragraphs = [part.strip() for part in draft_text.split("\n\n") if part.strip()]
    if not paragraphs:
        return draft_text

    lowered = instruction.lower()
    if "hook" in lowered and ("direct" in lowered or "sharper" in lowered):
        original_hook = paragraphs[0].rstrip(".")
        paragraphs[0] = f"Here is the direct version: {original_hook.lower()}."

    if "cut" in lowered and ("ending" in lowered or "end" in lowered) and len(paragraphs) > 2:
        paragraphs = paragraphs[:-1]

    if "short" in lowered or "tighter" in lowered:
        paragraphs = [paragraph for paragraph in paragraphs if len(paragraph) <= 360]
        if not paragraphs:
            paragraphs = [draft_text.strip()]

    paragraphs.append(f"Revision note: {instruction.strip()}")
    return "\n\n".join(paragraphs)


async def rewrite_draft(ctx: FunctionContext, data: RewriteDraftInput) -> RewriteDraftResult:
    pod = Pod.from_env()
    piece = _record(pod.table("content_pieces").get(data.content_piece_id))
    if piece.get("status") not in {"draft", "approved", "queued"}:
        raise ValueError("Only draft, approved, or queued pieces can be rewritten in Phase 4.")

    draft_text = _rewrite_text(piece.get("draft_text") or "", data.steering_instruction)
    version = int(piece.get("version") or 1) + 1
    updated = _record(pod.table("content_pieces").update(
        data.content_piece_id,
        {
            "draft_text": draft_text,
            "version": version,
            "status": "draft",
            "approved_at": None,
            "shared_at": None,
        },
    ))

    return RewriteDraftResult(
        content_piece_id=str(updated["id"]),
        status="draft",
        draft_text=draft_text,
        version=version,
        steering_instruction=data.steering_instruction,
    )
