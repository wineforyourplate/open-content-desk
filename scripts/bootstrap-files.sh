#!/usr/bin/env bash
# Finish an install from the Lemma frontend. Run once after the import:
#
#   bash scripts/bootstrap-files.sh --pod <pod-id> [--server <cli-server>]
#
# The frontend import currently leaves a few things undone; this script:
#   1. creates every folder under files/ (each has a .folder.json)
#   2. uploads the bundled file contents (writing guides, voice profiles)
#   3. re-applies functions and agents, which restores their table/folder grants
#   4. builds and deploys any app with source that is still a DRAFT
#
# Safe to re-run: existing folders and files are skipped.
# Needs an authenticated Lemma CLI, python3, and Node.js + npm for step 4.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pod=""
server_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pod) pod="$2"; shift 2 ;;
    --server) server_args=(--server "$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$pod" ]] || { echo "usage: $0 --pod <pod-id> [--server <name>]" >&2; exit 2; }

lemma_pod() { lemma "${server_args[@]}" --pod "$pod" "$@"; }
json_field() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "== folders"
while IFS= read -r folder_json; do
  remote="/$(dirname "${folder_json#"$repo_root/files/"}")"
  if out="$(lemma_pod files mkdir "$remote" 2>&1)"; then
    echo "created $remote"
  elif grep -qi -E "exist|409|conflict" <<<"$out"; then
    echo "exists  $remote"
  else
    echo "$out" >&2; exit 1
  fi
done < <(find "$repo_root/files" -name .folder.json | sort)

echo "== files"
while IFS= read -r local_path; do
  remote="/${local_path#"$repo_root/files/"}"
  if out="$(lemma_pod files upload "$local_path" "$remote" 2>&1)"; then
    echo "uploaded $remote"
  elif grep -qi -E "exist|409|conflict" <<<"$out"; then
    echo "exists   $remote"
  else
    echo "$out" >&2; exit 1
  fi
done < <(find "$repo_root/files" -type f ! -name '.*' | sort)

echo "== grants"
for resource in functions agents; do
  [[ -d "$repo_root/$resource" ]] || continue
  out="$(lemma "${server_args[@]}" pods import "$repo_root/$resource" --pod "$pod" 2>&1)" || { echo "$out" >&2; exit 1; }
  echo "re-applied $resource"
done

echo "== apps"
server_json="$(lemma "${server_args[@]}" servers show --json)"
api_url="$(json_field "d['base_url']['value']" <<<"$server_json")"
auth_url="$(json_field "d['auth_url']['value']" <<<"$server_json")"
for source in "$repo_root"/apps/*/source; do
  [[ -f "$source/package.json" ]] || continue
  app="$(basename "$(dirname "$source")")"
  status="$(lemma_pod apps get "$app" --json 2>/dev/null | json_field "d.get('status')" || echo MISSING)"
  if [[ "$status" == "READY" ]]; then
    echo "ready    $app"
    continue
  fi
  echo "deploying $app (was $status)"
  (
    cd "$source"
    export VITE_LEMMA_API_URL="$api_url" VITE_LEMMA_AUTH_URL="$auth_url" VITE_LEMMA_POD_ID="$pod"
    npm ci --no-audit --no-fund >/dev/null
    npm run build >/dev/null
    lemma "${server_args[@]}" --pod "$pod" apps deploy "$app" . --dist-dir dist -y >/dev/null
  )
  echo "deployed $app"
done

lemma "${server_args[@]}" pods doctor "$pod" | tail -1
echo "Install finished."
