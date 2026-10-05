#input_type_name: GeneratePerspectivesInput
#output_type_name: GeneratePerspectivesResult
#function_name: generate_perspectives

from __future__ import annotations

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class GeneratePerspectivesInput(BaseModel):
    idea_id: str | None = None
    raw_input: str | None = Field(default=None, max_length=2000)
    context_profile_id: str | None = None


class PerspectiveOption(BaseModel):
    label: str
    description: str
    why_it_fits: str


class ContextMapping(BaseModel):
    allowed_claims: list[str]
    proof_points: list[str]
    audience_signals: list[str]


class GeneratePerspectivesResult(BaseModel):
    idea_id: str | None
    raw_input: str
    context_mapping: ContextMapping
    perspectives: list[PerspectiveOption]


GeneratePerspectivesInput.model_rebuild()
PerspectiveOption.model_rebuild()
ContextMapping.model_rebuild()
GeneratePerspectivesResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def _items(response) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    if isinstance(payload, dict):
        return payload.get("items", [])
    return payload if isinstance(payload, list) else []


def _profile_items(profile: dict, key: str) -> list[str]:
    value = profile.get(key) or []
    return [str(item) for item in value if str(item).strip()]


def _select_relevant(items: list[str], text: str, limit: int) -> list[str]:
    lowered = text.lower()
    scored = []
    for item in items:
      item_lower = item.lower()
      score = sum(1 for word in lowered.split() if len(word) > 3 and word in item_lower)
      scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    selected = [item for score, item in scored if score > 0][:limit]
    if len(selected) < limit:
        selected.extend([item for item in items if item not in selected][:limit - len(selected)])
    return selected[:limit]


def _perspectives_for(text: str) -> list[PerspectiveOption]:
    lowered = text.lower()
    base = [
        PerspectiveOption(
            label="Contrarian take",
            description="Challenge the common way people think about this problem.",
            why_it_fits="The idea already has tension and can carry a sharper author point of view.",
        ),
        PerspectiveOption(
            label="Practical lesson",
            description="Turn the idea into a useful lesson from operating the brand, offer, or workflow.",
            why_it_fits="It connects the raw observation to what changes in real work.",
        ),
        PerspectiveOption(
            label="Pain post",
            description="Lead with the repeated pain the target audience keeps running into.",
            why_it_fits="The idea can be framed around a recognizable broken workflow.",
        ),
        PerspectiveOption(
            label="Before/after",
            description="Show the old way of working beside the pod-based way.",
            why_it_fits="It makes the value concrete without needing a long explanation.",
        ),
    ]
    if "ship" in lowered or "built" in lowered:
        base[1] = PerspectiveOption(
            label="Build log",
            description="Explain what was shipped, why it mattered, and what changed.",
            why_it_fits="The idea has enough build energy to work as a grounded shipping note.",
        )
    if "agent" in lowered or "ai" in lowered:
        base[3] = PerspectiveOption(
            label="Bold claim",
            description="Make a strong claim about how agent-powered operating loops should be built.",
            why_it_fits="The idea points at a belief, not just a feature update.",
        )
    return base


async def generate_perspectives(ctx: FunctionContext, data: GeneratePerspectivesInput) -> GeneratePerspectivesResult:
    pod = Pod.from_env()
    idea = None
    if data.idea_id:
        idea = _record(pod.table("ideas").get(data.idea_id))

    raw_input = (data.raw_input or (idea or {}).get("raw_input") or "").strip()
    if not raw_input:
        raise ValueError("Provide idea_id or raw_input.")

    if data.context_profile_id:
        profile_record = _record(pod.table("context_profile").get(data.context_profile_id))
    else:
        profiles = _items(pod.table("context_profile").list(limit=20))
        active_profiles = [row for row in profiles if row.get("status") == "active"]
        profile_record = active_profiles[0] if active_profiles else (profiles[0] if profiles else {})

    founder = profile_record.get("founder_json") or {}
    product = profile_record.get("product_json") or {}
    context_text = f"{raw_input} {' '.join(_profile_items(product, 'allowed_claims'))}"

    mapping = ContextMapping(
        allowed_claims=_select_relevant(_profile_items(product, "allowed_claims"), context_text, 3),
        proof_points=_select_relevant(_profile_items(product, "proof_points"), context_text, 3),
        audience_signals=_select_relevant(_profile_items(founder, "audience_signals"), context_text, 3),
    )

    return GeneratePerspectivesResult(
        idea_id=str((idea or {}).get("id")) if idea else data.idea_id,
        raw_input=raw_input,
        context_mapping=mapping,
        perspectives=_perspectives_for(raw_input),
    )
