#input_type_name: SavePostInput
#output_type_name: SavePostResult
#function_name: save_post

from __future__ import annotations

import json

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class SavePostInput(BaseModel):
    post_id: str | None = None
    title: str | None = None
    body_md: str | None = None
    blocks_json: str | None = None
    stage: str | None = None
    voice: str | None = None
    format_type: str | None = None
    applied_skill: str | None = None
    campaign_id: str | None = None
    product_id: str | None = None
    source_idea_id: str | None = None
    channel: str | None = None
    perspectives_json: str | None = None
    claim_check_json: str | None = None
    tags_json: str | None = None
    content_formats_json: str | None = None


class SavePostResult(BaseModel):
    post_id: str
    action: str
    stage: str | None = None
    note_path: str | None = None
    message: str


SavePostInput.model_rebuild()
SavePostResult.model_rebuild()


def _record(response) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def _parse_json(value):
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    return json.loads(value)


def _name_for(pod: Pod, table: str, row_id) -> str:
    """Best-effort human name for a foreign-key id, for note frontmatter/RAG."""
    if not row_id:
        return ""
    try:
        rec = _record(pod.table(table).get(str(row_id)))
        if isinstance(rec, dict):
            return str(rec.get("name") or "")
    except Exception:
        pass
    return str(row_id)


TARGET_PLATFORMS = ("twitter", "reddit", "instagram")


def _versions_of(record: dict) -> list[dict]:
    """The post's inline platform versions (posts.versions), tolerant of a JSON string."""
    value = record.get("versions")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _version_body(version: dict) -> str:
    body = str(version.get("body_md") or "").strip()
    if body:
        return body
    blocks = version.get("blocks")
    if isinstance(blocks, list):
        texts = [
            str(b.get("text") or "").strip()
            for b in blocks
            if isinstance(b, dict) and b.get("type") in ("text", "tweet", "title")
        ]
        return "\n\n".join(t for t in texts if t).strip()
    return ""


def _write_note(pod: Pod, record: dict) -> str | None:
    """Mirror a post to a searchable markdown note at /notes/<id>.md.

    Frontmatter, then the original document, then one `## …` section per platform
    version. The app writes the SAME shape from src/notes.ts — change one, change
    the other. This file is the agents' RAG memory of the board; failures here
    must never break the save.
    """
    post_id = str(record.get("id") or "")
    if not post_id:
        return None
    try:
        product = _name_for(pod, "products", record.get("product_id"))
        campaign = _name_for(pod, "campaigns", record.get("campaign_id"))
        title = str(record.get("title") or "Untitled")
        versions = _versions_of(record)
        platforms = [
            p for p in TARGET_PLATFORMS
            if any(v.get("platform") == p for v in versions)
        ]

        fm = [
            "---",
            f"title: {json.dumps(title)}",
            f"stage: {record.get('stage') or 'spark'}",
            f"product: {json.dumps(product)}",
            f"campaign: {json.dumps(campaign)}",
            f"source: {record.get('channel') or 'desk'}",
            f"format: {record.get('format_type') or ''}",
            f"content_formats: {record.get('content_formats') or []}",
            f"platforms: [{', '.join(platforms)}]",
            f"version_count: {len(versions)}",
            f"updated: {record.get('updated_at') or ''}",
            "---",
        ]

        chunks: list[str] = [f"# {title}"]
        body = str(record.get("body_md") or "").strip()
        if body:
            chunks.append(body)

        for version in versions:
            platform = version.get("platform") or ""
            platform = platform if platform in TARGET_PLATFORMS else ""
            meta = " · ".join(x for x in (platform, version.get("format_type") or "") if x)
            name = version.get("name") or "Untitled version"
            # Post bodies carry their own headings, so a heading alone can't mark a
            # boundary. The rule is the visual break; the comment is the machine one.
            chunks.append("---")
            chunks.append(
                f'<!-- ocd:version platform="{platform}" name="{name.replace(chr(34), chr(39))}" -->'
            )
            chunks.append(f"## {name}{f' ({meta})' if meta else ''}")
            version_title = str(version.get("title") or "")
            if version_title and version_title != title:
                chunks.append(f"**{version_title}**")
            chunks.append(_version_body(version) or "_Empty version._")

        path = f"/notes/{post_id}.md"
        pod.files.write_text(path, "\n".join(fm) + "\n\n" + "\n\n".join(chunks) + "\n")
        return path
    except Exception:
        return None


async def save_post(ctx: FunctionContext, data: SavePostInput) -> SavePostResult:
    fields: dict = {}
    for key in ("title", "body_md", "stage", "voice", "format_type",
                "applied_skill", "campaign_id", "product_id", "source_idea_id",
                "channel"):
        value = getattr(data, key)
        if value is not None:
            fields[key] = value

    blocks = _parse_json(data.blocks_json)
    if blocks is not None:
        fields["blocks"] = blocks
    perspectives = _parse_json(data.perspectives_json)
    if perspectives is not None:
        fields["perspectives"] = perspectives
    claim = _parse_json(data.claim_check_json)
    if claim is not None:
        fields["claim_check_result"] = claim
    tags = _parse_json(data.tags_json)
    if tags is not None:
        fields["tags"] = tags
    content_formats = _parse_json(data.content_formats_json)
    if content_formats is not None:
        fields["content_formats"] = content_formats

    pod = Pod.from_env()
    if data.post_id:
        record = _record(pod.table("posts").update(data.post_id, fields))
        action = "updated"
    else:
        fields.setdefault("stage", "spark")
        record = _record(pod.table("posts").create(fields))
        action = "created"

    note_path = _write_note(pod, record if isinstance(record, dict) else {})

    return SavePostResult(
        post_id=str(record.get("id") or data.post_id or ""),
        action=action,
        stage=fields.get("stage") or (record.get("stage") if isinstance(record, dict) else None),
        note_path=note_path,
        message=f"Post {action}." + (f" Note at {note_path}." if note_path else ""),
    )
