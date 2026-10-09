# Aangan Studio — Vaani call qualification

Aangan Studio (Pune interior design) was missing about half its enquiries. This system answers every enquiry call, day or night, with a voice agent (**Vaani**), then:

1. qualifies the lead against Nikhil's rubric ([`context/qualified.md`](context/qualified.md)) with Gemini,
2. books a free consultation with a designer on Google Calendar,
3. emails the designer a handoff note so they never re-ask anything,
4. puts every call that needs a person into a follow-up queue, and
5. shows Nikhil a dashboard of what happened and what it cost.

Phone only. WhatsApp and the web form are out of scope (see [Extending to other channels](#extending-to-other-channels)).

## Architecture

```mermaid
flowchart LR
    A[Caller rings studio number] --> V((Vaani voice agent<br/>prompts/vaani-agent.md))
    V -->|post-call webhook<br/>secret-verified| W["/api/vaani/webhook"]
    S["/dashboard/simulate<br/>(paste a transcript)"] --> PL

    W --> DB[(Neon Postgres<br/>calls)]
    W -->|after response| PL[pipeline.ts]
    PL --> G[Gemini classifier<br/>prompts/classifier.md<br/>strict JSON]
    G --> D{"decide()<br/>rubric in code"}

    D -->|QUALIFIED| CAL[Google Calendar<br/>freebusy → first slot<br/>matching preference] --> E1[Resend: designer handoff<br/>+ client confirmation]
    D -->|REJECTED| E2[Resend: warm decline<br/>no prices]
    D -->|HUMAN_REVIEW / INCOMPLETE| FU[Follow-up queue<br/>on the dashboard]
    D -->|ESCALATED| E3[Resend: ESCALATION_EMAIL<br/>+ top of follow-ups]

    PL --> DB2[(Neon Postgres<br/>leads · bookings · costs)]
    DB2 --> DASH["/dashboard<br/>KPIs · outcomes · costs · live feed"]
    DB2 --> LEADS["/dashboard/leads<br/>follow-ups · all leads"]
```

| Piece | Where |
|---|---|
| Vaani system prompt | [`prompts/vaani-agent.md`](prompts/vaani-agent.md) |
| Classifier prompt | [`prompts/classifier.md`](prompts/classifier.md) (+ `services.md`, `qualified.md` appended at runtime) |
| Decision rules (deterministic) | [`src/lib/classification.ts`](src/lib/classification.ts) → `decide()` |
| Post-call pipeline | [`src/lib/pipeline.ts`](src/lib/pipeline.ts) |
| Slot finding | [`src/lib/slots.ts`](src/lib/slots.ts) |
| Vaani webhook adapter | [`src/lib/vaani.ts`](src/lib/vaani.ts) |
| Calendar / Resend | `src/lib/google-calendar.ts`, `resend.ts` |
| Schema | [`db/schema.sql`](db/schema.sql) |
| Database access (Neon) | [`src/lib/db.ts`](src/lib/db.ts) |

### Decisions worth knowing

- **Vaani never judges fit and never quotes a price.** Nikhil asked for the agent to quote per-sq-ft pricing; `pricing.md` itself says no number should reach a client, and a quote made before anyone has seen the site anchors the conversation wrongly. Vaani uses the one deflection line from `pricing.md`. The classifier never sees `pricing.md` — only the internal budget yardstick (₹3.5L/room, ₹1,200/sq ft), and only to check a budget the caller volunteered.
- **Gemini scores, code decides.** The model returns pass/fail/unclear with an evidence quote for each of the 5 criteria; `decide()` applies the decision order, so the outcome can't drift with the prompt. The model's own outcome is stored as `model_outcome` for audit.
- **Unclear on its own never rejects.** The brief's literal rule ("2+ criteria failing/unclear → REJECTED") would reject T14 (timeline and decision-maker unclear) and T16 (scope, timeline, decision-maker unclear), both of which must be QUALIFIED or HUMAN_REVIEW. `qualified.md` says *"Two or more criteria **fail**: decline"* and *"unclear on 4 or 5: do not push, treat as qualified"*. So: any fail on 1–4 → REJECTED; a decision-maker fail plus anything shaky → REJECTED (alone → HUMAN_REVIEW); unclear on 1–3 or confidence < 0.7 → HUMAN_REVIEW; budget not mentioned counts as pass.
- **Frustrated new enquirer ≠ escalation.** ESCALATED is for existing clients, complaints about delivered work, or explicit requests for a person. A new caller annoyed that nobody rang back (T16) is classified normally and flagged in the handoff.
- **Email, not Telegram, for the designer handoff.** Designers live in Google Calendar and email already; the invite and the handoff land in the same inbox, the note is long-form and searchable, and there's no bot to install per designer.
- **No CRM — the dashboard is the CRM.** Anything a person has to act on (escalations, needs-review, incomplete calls, qualified leads with no matching slot, declines with no email to send to) lands in the follow-up queue on `/dashboard/leads`, escalations first, then oldest. The front desk marks each one done with a note.
- **No booking when no slot matches.** If nobody is free at a time the client said suits them in the next 7 working days (Mon–Sat, 10am–7pm IST, 2 h lead time), the lead stays QUALIFIED and goes to the follow-up queue, rather than booking the client into a time they said doesn't work.
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
| **Neon** | Postgres database (created: `aangan-studio-db`, Singapore, via the Vercel marketplace — the connection string is added to Vercel automatically) | `DATABASE_URL` |
| **Vaani** | The studio number pointed at the agent, and a webhook secret you choose | `VAANI_WEBHOOK_SECRET`, `VAANI_RATE_PER_MIN` |
| **Gemini** | API key from Google AI Studio | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_INR_PER_1M_INPUT`, `GEMINI_INR_PER_1M_OUTPUT` |
| **Google Calendar** | OAuth client (Desktop or Web) + a refresh token for a studio Google account that has *Make changes to events* on every designer's calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| **Resend** | API key and a verified sending domain | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_INR_PER_EMAIL`, `ESCALATION_EMAIL` |
| **App** | Choose a dashboard password; generate a session secret | `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `APP_URL` |

All variables are listed with comments in [`.env.example`](.env.example).

### 2. Local

```bash
npm install
cp .env.example .env.local      # fill in values (or: vercel env pull)
npm run db:migrate              # creates the tables in Neon
npm run eval                    # classifier test; writes data/eval-results.json
npm run seed                    # loads T01–T20 into the database (dry run: nothing is sent)
npm run dev
```

Open http://localhost:3000 → log in with `DASHBOARD_PASSWORD`.

### 3. Database

The schema is in [`db/schema.sql`](db/schema.sql); `npm run db:migrate` applies it (safe to re-run). The app talks to Neon over HTTP with `@neondatabase/serverless`; only the server holds `DATABASE_URL`.

Add your real designers (the seed adds three placeholders on `designers.example`), e.g. in the Neon SQL editor:

```sql
delete from designers where email like '%@designers.example';
insert into designers (name, email, calendar_id) values
  ('Designer Name', 'designer@aangan.studio', 'designer@aangan.studio');
```

### 4. Vaani

1. Paste [`prompts/vaani-agent.md`](prompts/vaani-agent.md) into the agent's system prompt. Add a `flag_escalation` function if Vaani supports custom functions.
2. Set the post-call webhook to `https://<your-app>/api/vaani/webhook` and the secret to `VAANI_WEBHOOK_SECRET`. The route accepts an HMAC-SHA256 signature (`x-vaani-signature`), a shared-secret header (`x-webhook-secret` or `Authorization: Bearer`), or `?secret=` in the URL — whichever Vaani supports.
3. `src/lib/vaani.ts` reads the webhook payload defensively (`call_id`/`id`, `transcript` as a string or a list of turns, `duration`/`duration_seconds`, …) because the post-call payload isn't documented publicly. Check one real payload (stored in `calls.raw_payload`) against `normaliseWebhook` and adjust field names if needed.

### 5. Deploy

The GitHub repo is connected to Vercel; every push to `main` deploys. Set the env vars above in Vercel → Project → Settings → Environment Variables.

## Dashboard

`/dashboard` (password: `DASHBOARD_PASSWORD`)

- **KPIs:** calls answered, % after hours (outside 10am–7pm or Sunday), median time to first response (enquiry → Vaani on the line; 0 for every inbound call, because Vaani picks up), qualified, booked, cost this month, cost per qualified lead, estimated pipeline (qualified × ₹11L, labelled as an estimate — the midpoint of the ₹8–14L average project value).
- **Outcomes** donut, **Call → Qualified → Booked** step tracker, **rejection reasons**, **costs by source**, **live call feed** (refreshes every 8 s). Date filter: 7 days, 30 days, this month, last month, all time.
- **Costs** are logged per call: Vaani minutes × `VAANI_RATE_PER_MIN`, Gemini `usageMetadata` tokens × your per-token price, Resend emails × `RESEND_INR_PER_EMAIL`.
- **Leads & follow-ups** (`/dashboard/leads`): the front desk's queue — every call that needs a person, with the one question to ask and a tap-to-call number — plus a searchable list of every lead filtered by outcome. Mark a follow-up done with a note; reopen it if needed.
- **Simulate call** (`/dashboard/simulate`): paste a transcript (or load T01–T20) and it runs the same pipeline as a real call. Tick *dry run* to classify and store without booking calendars or sending email.
- Each call has a detail page; designers get a signed link to the same view (no password) in their handoff email.

The seeded data is September's front-desk calls, so the transcripts show a person, not Vaani; the costs are what Vaani would have cost for the same minutes.

## Extending to other channels

The pipeline only needs a transcript and a timestamp, so WhatsApp and the web form plug in at `insertCall()` → `processCall()`:

- **WhatsApp Business:** a webhook that collects a thread until the customer goes quiet, then sends the thread as the transcript. Vaani's rules (never price, never reject) become the auto-reply prompt.
- **Web form:** map form fields to a `Field: value` transcript; most leads arrive with every field filled, so they qualify or route instantly. A Vaani outbound callback within 5 minutes of a form submission is the natural next step (the earlier HubSpot-triggered callback was removed with HubSpot).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run eval` | Classifier test on T01–T20 |
| `npm run db:migrate` | Create / update tables in Neon |
| `npm run seed` | Seed the database from the eval results (dry run) |
| `npm test` | Unit tests (decision rules, slot finder) |
| `npm run typecheck` | Route types + TypeScript |
