# Open Content Desk — Lemma pod

Open Content Desk turns rough ideas into grounded, platform-native content. Capture a thought from
your phone or the desk, shape it into real X threads, Reddit posts and newsletters, keep one inline
version per platform, and run campaigns around it, with AI agents doing the drafting.

## What's inside

```
agents/      rocky  (board manager: captures, clusters, answers "what ideas about X?")
             writer (drafts, rewrites, perspectives, claim-checks; format-native)
             milo   (chat operator: capture, find, organize, shape, plan; Commons)
functions/   save_post (+ legacy draft/claim-check helpers)
tables/      posts, campaigns, products, context_profile, skills, channels,
             commons_boards, commons_members, commons_notes, member_profiles,
             doc_comments, launch_dm_leads, ideas, content_pieces (legacy)
apps/        ocd-board          main board + editor + Commons (Vite/React, source included)
             campaign-workspace campaign planning view
             ai-at-work         published article page
surfaces/    whatsapp, resend-assistant (email)
files/       guides/ (per-format writing skills) · voices/ (voice profiles)
             notes/ + product-docs/ (created empty; filled per user)
payloads/    seed records and function-input fixtures
```

## Install

Install from GitHub through the Lemma frontend (install / remix), or with the CLI:

```sh
lemma pods create "Open Content Desk"
lemma pods import . --pod <pod-id> --with-files --set-pod-meta
```

App URL slugs are variables in `pod.json` (`ocd_board_slug`, etc.). Pass `--var ocd_board_slug=...`
if the default is taken.

After installing:
- Create an active `context_profile` row (see `payloads/context-profile.seed.json`), otherwise the
  Writer has nothing to ground drafts in.
- Connect surfaces (WhatsApp, email) to accounts in the target environment; account ids are not
  carried in the bundle.

## Developing the app

```sh
cd apps/ocd-board/source
cp .env.example .env.local      # set VITE_LEMMA_POD_ID to the pod UUID
npm install && npm run dev
npm run build && lemma apps deploy ocd-board . --dist-dir dist -y
```

Deployed apps read `window.__LEMMA_CONFIG__` (injected by the host), so one build runs on any
Lemma server. `.env.local` is only for local dev.

## Gotchas
- The SDK addresses pods by UUID, not slug.
- `/skills` is a reserved system folder; writing guides live in `/guides`.
- Every post is mirrored to `/notes/<id>.md` by two writers that must stay in sync:
  `functions/save_post` and `apps/ocd-board/source/src/notes.ts`.
