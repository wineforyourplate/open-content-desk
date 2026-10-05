#!/usr/bin/env bash
# Upload Open Content Desk's public writing guides and voice profiles into a pod.
# Run once after installing from the Lemma frontend (the import creates the
# folders but not the file contents).
#
#   bash scripts/bootstrap-files.sh --pod <pod-id>
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lemma_cmd=(lemma "$@")

for local_path in "$repo_root"/files/guides/*.md "$repo_root"/files/voices/*.md; do
  remote_path="/${local_path#"$repo_root/files/"}"
  "${lemma_cmd[@]}" files upload "$local_path" "$remote_path" >/dev/null
  echo "uploaded $remote_path"
done

echo "Open Content Desk's writing guides and voice profiles are ready."
