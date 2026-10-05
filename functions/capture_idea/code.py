#input_type_name: CaptureIdeaInput
#output_type_name: CaptureIdeaResult
#function_name: capture_idea

from __future__ import annotations

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class CaptureIdeaInput(BaseModel):
    raw_input: str = Field(..., min_length=1, max_length=2000)
    source: str = "desk"
    topic: str | None = None
    source_payload: dict | None = None


class CaptureIdeaResult(BaseModel):
    id: str
    raw_input: str
    source: str
    status: str
    topic: str
    message: str


CaptureIdeaInput.model_rebuild()
CaptureIdeaResult.model_rebuild()


ALLOWED_SOURCES = {"desk", "telegram", "email", "seed"}


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def _infer_topic(text: str) -> str:
    value = text.lower()
    if "agent" in value or "ai" in value:
        return "AI agents"
    if "price" in value or "pricing" in value or "workshop" in value:
        return "Workshops"
    if "founder" in value or "ship" in value or "funding" in value:
        return "Build log"
    if "email" in value or "system" in value:
        return "Productivity"
    if "fashion" in value:
        return "Fashion"
    return "Unsorted"


async def capture_idea(ctx: FunctionContext, data: CaptureIdeaInput) -> CaptureIdeaResult:
    raw_input = " ".join(data.raw_input.strip().split())
    source = data.source.lower().strip()
    if source not in ALLOWED_SOURCES:
        source = "desk"

    topic = data.topic.strip() if data.topic else _infer_topic(raw_input)
    pod = Pod.from_env()
    record = _record(pod.table("ideas").create(
        {
            "raw_input": raw_input,
            "source": source,
            "status": "new",
            "topic": topic,
            "source_payload": data.source_payload or {},
        },
    ))

    return CaptureIdeaResult(
        id=str(record["id"]),
        raw_input=raw_input,
        source=source,
        status="new",
        topic=topic,
        message="Captured. It's on your board.",
    )
