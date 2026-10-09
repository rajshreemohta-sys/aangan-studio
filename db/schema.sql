-- Aangan Studio — call qualification schema (Neon Postgres).
-- Applied by `npm run db:migrate`. Idempotent: safe to run again.

create table if not exists designers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  calendar_id text not null,
  active boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  vaani_call_id text unique,
  source text not null default 'vaani' check (source in ('vaani', 'simulated', 'seed')),
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  caller_phone text,
  raw_transcript text not null default '',
  summary text,
  duration_seconds integer not null default 0,
  started_at timestamptz not null default now(),
  -- When the enquiry first reached us. Equal to started_at for inbound calls.
  enquiry_at timestamptz not null default now(),
  after_hours boolean not null default false,
  escalation_flag boolean not null default false,
  recording_url text,
  status text not null default 'received' check (status in ('received', 'processing', 'done', 'failed')),
  error text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists calls_started_at_idx on calls (started_at desc);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique references calls (id) on delete cascade,
  outcome text not null check (outcome in ('QUALIFIED', 'HUMAN_REVIEW', 'REJECTED', 'ESCALATED', 'INCOMPLETE', 'NOT_ENQUIRY')),
  reason_code text not null,
  reason_detail text,
  model_outcome text,
  confidence numeric(3, 2),
  criteria jsonb not null default '[]',
  flags jsonb not null default '[]',
  missing_fields jsonb not null default '[]',
  clarifying_question text,
  client_reason text,
  summary text,
  language text,
  -- collected fields
  name text,
  phone text,
  email text,
  locality text,
  property_type text,
  bhk text,
  carpet_area text,
  scope text,
  execution_or_advice text,
  completion_date text,
  ownership text,
  decision_maker text,
  budget_volunteered text,
  consultation_preference text,
  visit_type text,
  lead_source text,
  -- front-desk follow-up queue (replaces CRM tasks)
  follow_up_status text not null default 'none' check (follow_up_status in ('none', 'open', 'done')),
  follow_up_reason text,
  follow_up_note text,
  follow_up_done_at timestamptz,
  routing jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists leads_created_at_idx on leads (created_at desc);
create index if not exists leads_outcome_idx on leads (outcome);
create index if not exists leads_follow_up_idx on leads (follow_up_status) where follow_up_status = 'open';

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references leads (id) on delete cascade,
  designer_id uuid references designers (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  visit_type text,
  calendar_event_id text,
  calendar_event_url text,
  status text not null default 'booked' check (status in ('booked', 'simulated', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists bookings_designer_idx on bookings (designer_id, starts_at);

create table if not exists costs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls (id) on delete cascade,
  source text not null check (source in ('vaani', 'gemini', 'resend', 'calendar')),
  units numeric not null default 0,
  unit_label text,
  amount_inr numeric(12, 4) not null default 0,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists costs_created_at_idx on costs (created_at desc);

-- Outbound calls Vaani makes for us: follow-up button, dropped-call callback, web enquiry.
create table if not exists dispatches (
  id uuid primary key default gen_random_uuid(),
  reason text not null check (reason in ('follow_up', 'dropped_call', 'web_enquiry')),
  phone text not null,
  name text,
  email text,
  notes text,
  -- the lead this callback is following up, if any
  lead_id uuid references leads (id) on delete set null,
  -- the inbound call that triggered an automatic callback, so each call triggers at most one
  source_call_id uuid unique references calls (id) on delete set null,
  vaani_call_id text unique,
  status text not null default 'queued' check (status in ('queued', 'dialling', 'no_answer', 'rejected', 'failed', 'completed')),
  error text,
  enquiry_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists dispatches_phone_idx on dispatches (phone, created_at desc);
create index if not exists dispatches_lead_idx on dispatches (lead_id, created_at desc);
