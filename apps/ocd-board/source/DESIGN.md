# OCD app design

## Purpose and persona

OCD is the calm working desk for a content operator who thinks privately and sometimes works with a team. The primary job is to capture an idea, shape it into a useful document, keep a few intentional versions together, and schedule the right version without leaving the post. **Commons** is the deliberately shared layer: one team can use a common board or create several boards for different working groups without making anyone's personal Board public.

## Page map

| Surface | URL | What it shows |
| --- | --- | --- |
| Board | `/` | Pipeline kanban of personal `posts`. |
| Board stage | `/board/spark` (and `refining`, `ready`, `live`) | Same board, focused on one stage. |
| Campaigns | `/campaigns` | Card grid of briefs. Filter by stage, type, and format. |
| Campaign | `/campaigns/:id` | Full-screen campaign editor. |
| Post | `/posts/:id` | Post overlay. Under a campaign: `/campaigns/:cid/posts/:pid`. |
| Commons | `/commons` | Shared boards the current member belongs to. |
| Commons board | `/commons/:boardId` | One shared board. |
| Shared note | `/commons/:boardId/notes/:noteId` | A shared note or campaign. |
| Milo | `/milo` | Chat with the `milo` agent. |
| Other | `/products`, `/calendar`, `/skills`, `/settings`, `/profile` | Matching tabs. |

Refresh and the back button keep you on the URL you can see. Older `?post=` and `?commons=` / `?commons_note=` links still open the same place, then the address bar rewrites to the path above.

- **Board** — each post's `content_formats` (`carousel`, `reel`, `post`, `blog`) is a tap-to-toggle chip, not a typed tag.
- **Campaigns** — a campaign **includes** one or more of the same content formats, stored as `content_formats` JSON. Opening a card uses the same full-screen editor chrome as a post. Shared campaign cards in Commons use this same card (stage strip, title, formats) — not a separate art treatment.
- **Post editor overlay** — one canonical document plus inline named versions from `posts.versions`; scheduling stores `posts.scheduled_version_id`. `posts.format_type` is the platform-native rendition (X Thread, Reddit); `content_formats` is the kind of piece.
- **Commons** — `commons_boards`, `commons_members`, and `commons_notes`; add a note directly, or copy a personal note into one. **Share** on a board copies `/commons/:boardId` (with the board name for the signed-out invite gate). A shared note or campaign copies `/commons/:boardId/notes/:noteId`. Invite is the path for adding someone new.
- **Milo / Calendar / Products / Skills / Settings / Profile** — as before.

## Core scenarios

1. Open a post from the board, use the back button to return, and collapse or restore the workspace sidebar.
2. Keep the original note intact, add an X/Reddit/custom version, switch between versions in the document, and edit without a social-network preview.
3. Schedule the post, explicitly select the version and destinations, then see the version name on the calendar.
4. Open Milo, ask it to save or find an idea, and receive a short answer grounded in the signed-in user's pod rows.
5. Create a Commons board, invite a collaborator with a role, and copy a personal note into it. The source note remains private and unchanged.
6. Open a Commons invite while signed out and understand, before authenticating, who invited you, what the board is for, what you can do, and that your personal Board will remain private.

## Commons invitation experience

- **Invite creation** — ask for email and board role in one compact dialog. If the person already belongs to the pod, add them immediately; otherwise use the SDK's organization invitation API with this Commons board as the post-authentication destination.
- **Before sign-in** — show the Commons name, inviter, purpose, lightweight board activity/member context, role, and one primary `Join Commons` action. Never expose note content in URL metadata or before membership is validated.
- **After sign-in, before access** — keep the same visual context, show the signed-in identity, and offer `Request access` or refresh while a native pod invitation is pending.
- **First accepted visit** — activate the matching `commons_members` row by signed-in email, open the invited board, and show a small welcome banner plus the quickest useful action: add a note.
- **Trust promise** — always state: only notes deliberately shared to Commons are visible; the personal Board stays private. A share is a snapshot copy, not a live link to the private record.
- **Revocation / expiry** — pending invitations are visible to board owners and can be revoked in a future management pass; native invitation expiry remains enforced by Lemma.

## Commons permission model

- `posts` stays RLS-on and personal.
- Commons tables are shared within the pod so collaboration and live updates work. `commons_members` filters the app experience per board and supplies owner/editor/contributor/viewer roles.
- Milo reads Commons membership/board metadata and can write a Commons note only after an explicit instruction naming the destination. It must never infer sharing permission from team context.
- A pod is the hard permission boundary. Multiple Commons are appropriate for trusted teams inside one pod; genuinely isolated teams or external clients require separate pods because a pod member with direct table/query access can technically inspect shared tables outside the app's board filter.

## First 30 seconds

The board opens directly on work at `/`. The sidebar can collapse to an icon rail. Opening a note shows its name in the navigation bar, a back control, the pipeline stage, metadata, and a compact version switcher above the document. Refreshing keeps you on the same URL. Commons from the sidebar opens the member's most recently used shared board at `/commons/:id`; an empty Commons opens on a strong `Create a Commons` state, not an abstract product tour.

## Layout and states

- Desktop: collapsible left navigation, full-width route, editor overlay, optional AI refinement rail.
- Mobile: single-column pages, compact editor header, horizontally scrollable version switcher.
- Loading: existing note loading moment and app auth fallback.
- Empty: actionable board, calendar, version, and chat prompts.
- Error: visible note/chat error with retry or a fresh-chat action.
- Invite: a full-screen, responsive pre-join composition at 375px and desktop; no private table fetch is required to understand the invitation.

## Hero moment and success check

The screenshottable moment is a teammate following an invite and landing directly in a warm, populated Commons that already explains its purpose—while the app explicitly confirms that their personal Board is still theirs alone.

Success scenario: create `Growth room` → invite a teammate as contributor → they open the link signed out and see the contextual invite → they authenticate/accept pod access → their pending membership activates → `Growth room` opens → they add a note → the owner sees it live → Milo still saves a generic “capture this” request to personal `posts`, and shares only after “send this to Growth room.”
