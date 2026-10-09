# Aangan Studio — Vaani call qualification

Aangan Studio (Pune interior design) was missing about half its enquiries. This system answers every enquiry call, day or night, with a voice agent (**Vaani**), then:

1. qualifies the lead against Nikhil's rubric ([`context/qualified.md`](context/qualified.md)) with Gemini,
2. books a free consultation with a designer on Google Calendar,
3. emails the designer a handoff note so they never re-ask anything,
4. syncs HubSpot, and
5. shows Nikhil a dashboard of what happened and what it cost.

Phone only. WhatsApp and the web form are out of scope (see [Extending to other channels](#extending-to-other-channels)).

## Architecture

```mermaid
flowchart LR
    subgraph Triggers
      A[Caller rings studio number] --> V
      H[New HubSpot contact] -->|pg_cron every minute| P["/api/hubspot/poll"]
      P -->|outbound call within ~1–2 min| V
    end

    V((Vaani voice agent<br/>prompts/vaani-agent.md)) -->|post-call webhook<br/>secret-verified| W["/api/vaani/webhook"]
    S["/dashboard/simulate<br/>(paste a transcript)"] --> PL

    W --> DB[(Supabase<br/>calls)]
    W -->|after response| PL[pipeline.ts]
    PL --> G[Gemini classifier<br/>prompts/classifier.md<br/>strict JSON]
    G --> D{"decide()<br/>rubric in code"}

    D -->|QUALIFIED| CAL[Google Calendar<br/>freebusy → first slot<br/>matching preference] --> E1[Resend: designer handoff<br/>+ client confirmation]
    D -->|REJECTED| E2[Resend: warm decline<br/>no prices]
    D -->|HUMAN_REVIEW / INCOMPLETE| T[HubSpot task<br/>for front desk]
    D -->|ESCALATED| E3[Resend: ESCALATION_EMAIL]
    D --> HS[HubSpot contact + deal<br/>stage = outcome]

    PL --> DB2[(Supabase<br/>leads · bookings · costs)]
    DB2 --> DASH["/dashboard<br/>KPIs · outcomes · costs · live feed"]
```

| Piece | Where |
|---|---|
| Vaani system prompt | [`prompts/vaani-agent.md`](prompts/vaani-agent.md) |
| Classifier prompt | [`prompts/classifier.md`](prompts/classifier.md) (+ `services.md`, `qualified.md` appended at runtime) |
| Decision rules (deterministic) | [`src/lib/classification.ts`](src/lib/classification.ts) → `decide()` |
| Post-call pipeline | [`src/lib/pipeline.ts`](src/lib/pipeline.ts) |
| Slot finding | [`src/lib/slots.ts`](src/lib/slots.ts) |
| Vaani adapter (webhook + outbound) | [`src/lib/vaani.ts`](src/lib/vaani.ts) |
| HubSpot / Calendar / Resend | `src/lib/hubspot.ts`, `google-calendar.ts`, `resend.ts` |
| Schema | [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) |
| Callback cron | [`supabase/cron.sql`](supabase/cron.sql) |

### Decisions worth knowing

- **Vaani never judges fit and never quotes a price.** Nikhil asked for the agent to quote per-sq-ft pricing; `pricing.md` itself says no number should reach a client, and a quote made before anyone has seen the site anchors the conversation wrongly. Vaani uses the one deflection line from `pricing.md`. The classifier never sees `pricing.md` — only the internal budget yardstick (₹3.5L/room, ₹1,200/sq ft), and only to check a budget the caller volunteered.
- **Gemini scores, code decides.** The model returns pass/fail/unclear with an evidence quote for each of the 5 criteria; `decide()` applies the decision order, so the outcome can't drift with the prompt. The model's own outcome is stored as `model_outcome` for audit.
- **Unclear on its own never rejects.** The brief's literal rule ("2+ criteria failing/unclear → REJECTED") would reject T14 (timeline and decision-maker unclear) and T16 (scope, timeline, decision-maker unclear), both of which must be QUALIFIED or HUMAN_REVIEW. `qualified.md` says *"Two or more criteria **fail**: decline"* and *"unclear on 4 or 5: do not push, treat as qualified"*. So: any fail on 1–4 → REJECTED; a decision-maker fail plus anything shaky → REJECTED (alone → HUMAN_REVIEW); unclear on 1–3 or confidence < 0.7 → HUMAN_REVIEW; budget not mentioned counts as pass.
- **Frustrated new enquirer ≠ escalation.** ESCALATED is for existing clients, complaints about delivered work, or explicit requests for a person. A new caller annoyed that nobody rang back (T16) is classified normally and flagged in the handoff.
- **Email, not Telegram, for the designer handoff.** Designers live in Google Calendar and email already; the invite and the handoff land in the same inbox, the note is long-form and searchable, and there's no bot to install per designer.
- **No booking when no slot matches.** If nobody is free at a time the client said suits them in the next 7 working days (Mon–Sat, 10am–7pm IST, 2 h lead time), the lead stays QUALIFIED and the front desk gets a HubSpot task, rather than booking the client into a time they said doesn't work.
- **Every external step is independent.** A failing or unconfigured integration is recorded on the lead (`routing.steps`) and shown on the call page; the rest still run.

## Classifier test

```bash
npm run eval
```

Runs the classifier on phone transcripts T01–T20 (T08 is a missed call, skipped) and checks each outcome. Latest run, 19/19:

| Expected | Calls | Result |
|---|---|---|
| QUALIFIED | T01 T05 T06 T12 T15 T17 T20 | ✓ all qualified |
| REJECTED | T03 location · T04 scope (advice only) · T07 timeline · T10 budget · T19 scope (restaurant) | ✓ all rejected, with the right reason |
| ESCALATED | T09 | ✓ |
| HUMAN_REVIEW | T18 | ✓ |
| QUALIFIED or HUMAN_REVIEW | T02 T11 T13 T14 T16 | ✓ T02 qualified; T11 T13 T14 T16 review (timeline never asked) |

Three consecutive runs all matched 19/19. Classifying all 19 costs about ₹10.50 in Gemini tokens (about ₹0.55 a call). Unit tests for the decision rules and slot finder: `npm test`.

## Setup

### 1. Accounts and keys you need

| Service | What to get | Env vars |
|---|---|---|
| **Supabase** | Project (created: `aangan-studio`, Mumbai). Connected to Vercel via the marketplace integration, which injects the keys. | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |
| **Vaani** | API token, the studio phone number the agent answers, and a webhook secret you choose | `VAANI_API_BASE`, `VAANI_API_KEY`, `VAANI_AGENT_NUMBER`, `VAANI_WEBHOOK_SECRET`, `VAANI_RATE_PER_MIN` |
| **Gemini** | API key from Google AI Studio | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_INR_PER_1M_INPUT`, `GEMINI_INR_PER_1M_OUTPUT` |
| **Google Calendar** | OAuth client (Desktop or Web) + a refresh token for a studio Google account that has *Make changes to events* on every designer's calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| **Resend** | API key and a verified sending domain | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_INR_PER_EMAIL`, `ESCALATION_EMAIL` |
| **HubSpot** | Private app token (contacts, deals, pipelines, tasks scopes) | `HUBSPOT_TOKEN`, `HUBSPOT_PIPELINE_ID`, `HUBSPOT_STAGE_*`, optional `HUBSPOT_FRONT_DESK_OWNER_ID` |
| **App** | Choose a dashboard password; generate secrets | `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `APP_URL` |

All variables are listed with comments in [`.env.example`](.env.example).

### 2. Local

```bash
npm install
cp .env.example .env.local      # fill in values
npm run eval                    # classifier test; writes data/eval-results.json
npm run seed                    # loads T01–T20 into Supabase (dry run: nothing is sent)
npm run dev
```

Open http://localhost:3000 → log in with `DASHBOARD_PASSWORD`.

### 3. Database

The schema is in `supabase/migrations/0001_init.sql` (already applied to the `aangan-studio` project). RLS is enabled on every table with no policies: only the server, using the secret key, can read or write.

Add your real designers (the seed adds three placeholders on `designers.example`):

```sql
delete from designers where email like '%@designers.example';
insert into designers (name, email, calendar_id) values
  ('Designer Name', 'designer@aangan.studio', 'designer@aangan.studio');
```

### 4. HubSpot

```bash
npm run hubspot:setup
```

Creates a **Vaani enquiries** deal pipeline with one stage per outcome and prints the `HUBSPOT_PIPELINE_ID` / `HUBSPOT_STAGE_*` values to paste into env.

### 5. Vaani

1. Paste [`prompts/vaani-agent.md`](prompts/vaani-agent.md) into the agent's system prompt. Add a `flag_escalation` function if Vaani supports custom functions.
2. Set the post-call webhook to `https://<your-app>/api/vaani/webhook` and the secret to `VAANI_WEBHOOK_SECRET`. The route accepts an HMAC-SHA256 signature (`x-vaani-signature`), a shared-secret header (`x-webhook-secret` or `Authorization: Bearer`), or `?secret=` in the URL — whichever Vaani supports.
3. `src/lib/vaani.ts` reads the webhook payload defensively (`call_id`/`id`, `transcript` as a string or a list of turns, `duration`/`duration_seconds`, …) because the post-call payload isn't documented publicly. Check one real payload (stored in `calls.raw_payload`) against `normaliseWebhook` and adjust field names if needed.

### 6. Callbacks within 5 minutes

Vercel Hobby crons only run daily, so Supabase pg_cron calls the poller every minute. After the first deploy, edit and run [`supabase/cron.sql`](supabase/cron.sql) in the Supabase SQL editor (replace `<APP_URL>` and `<CRON_SECRET>`). The poller looks at contacts created in the last 10 minutes, skips anyone already handled or who spoke to Vaani in the last hour, and dials the rest.

### 7. Deploy

The GitHub repo is connected to Vercel; every push to `main` deploys. Set the env vars above in Vercel → Project → Settings → Environment Variables.

## Dashboard

`/dashboard` (password: `DASHBOARD_PASSWORD`)

- **KPIs:** calls answered, % after hours (outside 10am–7pm or Sunday), median time to first response (enquiry → Vaani on the line; 0 for inbound, HubSpot-contact-created → call for callbacks), qualified, booked, cost this month, cost per qualified lead, estimated pipeline (qualified × ₹11L, labelled as an estimate — the midpoint of the ₹8–14L average project value).
- **Outcomes** donut, **Call → Qualified → Booked** step tracker, **rejection reasons**, **costs by source**, **live call feed** (refreshes every 8 s). Date filter: 7 days, 30 days, this month, last month, all time.
- **Costs** are logged per call: Vaani minutes × `VAANI_RATE_PER_MIN`, Gemini `usageMetadata` tokens × your per-token price, Resend emails × `RESEND_INR_PER_EMAIL`.
- **Simulate call** (`/dashboard/simulate`): paste a transcript (or load T01–T20) and it runs the same pipeline as a real call. Tick *dry run* to classify and store without booking calendars, sending email or touching HubSpot.
- Each call has a detail page; designers get a signed link to the same view (no password) in their handoff email.

The seeded data is September's front-desk calls, so the transcripts show a person, not Vaani; the costs are what Vaani would have cost for the same minutes.

## Extending to other channels

The pipeline only needs a transcript and a timestamp, so WhatsApp and the web form plug in at `insertCall()` → `processCall()`:

- **WhatsApp Business:** a webhook that collects a thread until the customer goes quiet, then sends the thread as the transcript. Vaani's rules (never price, never reject) become the auto-reply prompt.
- **Web form:** map form fields to a `Field: value` transcript; most leads arrive with every field filled, so they qualify or route instantly. Or create the HubSpot contact and let the 5-minute Vaani callback handle it — that path already exists.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run eval` | Classifier test on T01–T20 |
| `npm run seed` | Seed Supabase from the eval results (dry run) |
| `npm run hubspot:setup` | Create the HubSpot pipeline, print stage ids |
| `npm test` | Unit tests (decision rules, slot finder) |
| `npm run typecheck` | Route types + TypeScript |
