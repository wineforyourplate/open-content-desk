#input_type_name: GenerateDraftInput
#output_type_name: GenerateDraftResult
#function_name: generate_draft

from __future__ import annotations

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class GenerateDraftInput(BaseModel):
    idea_id: str
    perspective: str | None = None
    voice: str = "Clear Operator"
    format_type: str = "linkedin_post"


class GenerateDraftResult(BaseModel):
    content_piece_id: str
    idea_id: str
    status: str
    perspective: str
    voice: str
    format_type: str
    draft_text: str
    version: int


GenerateDraftInput.model_rebuild()
GenerateDraftResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


VOICE_GUIDES = {
    "Clear Operator": "plainspoken, specific, useful, no theatrics",
    "Contrarian Essayist": "sharp point of view, careful evidence, one memorable turn",
    "First Principles": "patient reasoning, define the underlying mechanism, avoid hype",
}


def _linkedin_draft(raw_input: str, perspective: str, voice: str) -> str:
    voice_note = VOICE_GUIDES.get(voice, VOICE_GUIDES["Clear Operator"])
    hook = raw_input.rstrip(".")
    return "\n\n".join(
        [
            f"{hook}.",
            "Most content starts too late. The team picks a format, opens a blank draft, and tries to manufacture a point of view from memory.",
            "That is backwards.",
            "The useful unit is the operating loop: what changed, what evidence exists, who the audience is, what claims are approved, and which guardrails the draft must respect.",
            f"From the {perspective.lower()} angle, the lesson is simple: content gets sharper when it starts from grounded context instead of a blank page.",
            "A Lemma pod makes that context operational by keeping ideas, evidence, drafts, checks, approvals, and queue state in one workspace.",
            f"Voice target: {voice_note}.",
        ]
    )


async def generate_draft(ctx: FunctionContext, data: GenerateDraftInput) -> GenerateDraftResult:
    if data.format_type != "linkedin_post":
        raise ValueError("Phase 3 only enables linkedin_post.")

    pod = Pod.from_env()
    idea = _record(pod.table("ideas").get(data.idea_id))
    raw_input = idea.get("raw_input") or ""
    perspective = data.perspective or idea.get("assigned_perspective") or "Practical lesson"
    voice = data.voice or "Clear Operator"
    draft_text = _linkedin_draft(raw_input, perspective, voice)

    content_piece = _record(pod.table("content_pieces").create(
        {
            "idea_id": data.idea_id,
            "perspective": perspective,
            "voice": voice,
            "format_type": "linkedin_post",
            "draft_text": draft_text,
            "version": 1,
            "status": "draft",
        },
    ))
    pod.table("ideas").update(
        data.idea_id,
        {
            "assigned_perspective": perspective,
            "assigned_voice": voice,
            "format_type": "linkedin_post",
            "status": "drafted",
        },
    )

    return GenerateDraftResult(
        content_piece_id=str(content_piece["id"]),
        idea_id=data.idea_id,
        status="draft",
        perspective=perspective,
        voice=voice,
        format_type="linkedin_post",
        draft_text=draft_text,
        version=1,
    )
