// Row shapes for the tables in supabase/migrations. Keep in sync with schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type BookingRow = {
  calendar_event_id: string | null;
  calendar_event_url: string | null;
  created_at: string;
  designer_id: string | null;
  ends_at: string;
  id: string;
  lead_id: string;
  starts_at: string;
  status: string;
  visit_type: string | null;
};

export type CallbackRow = {
  contact_created_at: string | null;
  created_at: string;
  detail: string | null;
  hubspot_contact_id: string;
  phone: string | null;
  status: string;
  vaani_call_id: string | null;
};

export type CallRow = {
  after_hours: boolean;
  caller_phone: string | null;
  created_at: string;
  direction: string;
  duration_seconds: number;
  enquiry_at: string;
  error: string | null;
  escalation_flag: boolean;
  hubspot_contact_id: string | null;
  id: string;
  raw_payload: Json | null;
  raw_transcript: string;
  recording_url: string | null;
  source: string;
  started_at: string;
  status: string;
  summary: string | null;
  vaani_call_id: string | null;
};

export type CostRow = {
  amount_inr: number;
  call_id: string | null;
  created_at: string;
  detail: Json | null;
  id: string;
  source: string;
  unit_label: string | null;
  units: number;
};

export type DesignerRow = {
  active: boolean;
  calendar_id: string;
  created_at: string;
  email: string;
  id: string;
  last_assigned_at: string | null;
  name: string;
};

export type LeadRow = {
  bhk: string | null;
  budget_volunteered: string | null;
  call_id: string;
  carpet_area: string | null;
  clarifying_question: string | null;
  client_reason: string | null;
  completion_date: string | null;
  confidence: number | null;
  consultation_preference: string | null;
  created_at: string;
  criteria: Json;
  decision_maker: string | null;
  email: string | null;
  execution_or_advice: string | null;
  flags: Json;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  id: string;
  language: string | null;
  lead_source: string | null;
  locality: string | null;
  missing_fields: Json;
  model_outcome: string | null;
  name: string | null;
  outcome: string;
  ownership: string | null;
  phone: string | null;
  property_type: string | null;
  reason_code: string;
  reason_detail: string | null;
  routing: Json;
  scope: string | null;
  summary: string | null;
  visit_type: string | null;
};
