-- Aangan Studio — call qualification schema.
-- All access goes through the server with the service-role key; RLS is on with no
-- policies, so the anon/publishable key can read or write nothing.

create extension if not exists pgcrypto;

create table public.designers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  calendar_id text not null,
  active boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  vaani_call_id text unique,
  source text not null default 'vaani' check (source in ('vaani', 'simulated', 'seed')),
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  caller_phone text,
  hubspot_contact_id text,
  raw_transcript text not null default '',
  summary text,
  duration_seconds integer not null default 0,
  started_at timestamptz not null default now(),
  -- When the enquiry first reached us: call start for inbound, HubSpot contact creation for callbacks.
  enquiry_at timestamptz not null default now(),
  after_hours boolean not null default false,
  escalation_flag boolean not null default false,
  recording_url text,
  status text not null default 'received' check (status in ('received', 'processing', 'done', 'failed')),
  error text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
create index calls_started_at_idx on public.calls (started_at desc);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique references public.calls (id) on delete cascade,
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
  hubspot_contact_id text,
  hubspot_deal_id text,
  routing jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_outcome_idx on public.leads (outcome);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads (id) on delete cascade,
  designer_id uuid references public.designers (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  visit_type text,
  calendar_event_id text,
  calendar_event_url text,
  status text not null default 'booked' check (status in ('booked', 'simulated', 'cancelled')),
  created_at timestamptz not null default now()
);
create index bookings_designer_idx on public.bookings (designer_id, starts_at);

create table public.costs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls (id) on delete set null,
  source text not null check (source in ('vaani', 'gemini', 'resend', 'hubspot', 'calendar')),
  units numeric not null default 0,
  unit_label text,
  amount_inr numeric(12, 4) not null default 0,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index costs_created_at_idx on public.costs (created_at desc);

-- HubSpot contacts we've already called back (or deliberately skipped), so the poller never dials twice.
create table public.callbacks (
  hubspot_contact_id text primary key,
  phone text,
  contact_created_at timestamptz,
  status text not null check (status in ('queued', 'dialled', 'skipped', 'failed')),
  vaani_call_id text,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.designers enable row level security;
alter table public.calls enable row level security;
alter table public.leads enable row level security;
alter table public.bookings enable row level security;
alter table public.costs enable row level security;
alter table public.callbacks enable row level security;
