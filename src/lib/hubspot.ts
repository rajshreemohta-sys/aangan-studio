import { env, requireEnv } from "./env";
import type { Outcome } from "./classification";

/** HubSpot CRM over REST with a private-app token. */

type Obj = { id: string; properties: Record<string, string | null> };

async function hs<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${requireEnv("HUBSPOT_TOKEN")}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HubSpot ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

async function searchOne(object: string, property: string, value: string): Promise<Obj | null> {
  const r = await hs<{ results: Obj[] }>(`/crm/v3/objects/${object}/search`, {
    method: "POST",
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }], limit: 1 }),
  });
  return r.results[0] ?? null;
}

export type ContactInput = { name: string; email: string; phone: string; locality: string; source: string };

/** Finds the contact by email, then phone; creates it if neither matches. Returns id and whether it's new. */
export async function upsertContact(c: ContactInput): Promise<{ id: string; created: boolean }> {
  const [firstname, ...rest] = c.name.trim().split(/\s+/);
  const properties: Record<string, string> = {};
  if (firstname) properties.firstname = firstname;
  if (rest.length) properties.lastname = rest.join(" ");
  if (c.email) properties.email = c.email;
  if (c.phone) properties.phone = c.phone;
  if (c.locality) properties.city = `${c.locality}, Pune`;

  const existing = (c.email && (await searchOne("contacts", "email", c.email))) || (c.phone && (await searchOne("contacts", "phone", c.phone))) || null;
  if (existing) {
    if (Object.keys(properties).length) await hs(`/crm/v3/objects/contacts/${existing.id}`, { method: "PATCH", body: JSON.stringify({ properties }) });
    return { id: existing.id, created: false };
  }
  const created = await hs<Obj>("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties: { ...properties, hs_lead_status: "NEW" } }) });
  return { id: created.id, created: true };
}

function stageFor(outcome: Outcome): { pipeline: string; dealstage: string } {
  return {
    pipeline: env("HUBSPOT_PIPELINE_ID") ?? "default",
    dealstage: env(`HUBSPOT_STAGE_${outcome}`) ?? "appointmentscheduled",
  };
}

export async function upsertDeal(input: { dealId?: string | null; contactId: string; name: string; outcome: Outcome; description: string }): Promise<string> {
  const properties = { dealname: input.name, description: input.description.slice(0, 5000), ...stageFor(input.outcome) };
  if (input.dealId) {
    await hs(`/crm/v3/objects/deals/${input.dealId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
    return input.dealId;
  }
  const deal = await hs<Obj>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties,
      associations: [{ to: { id: input.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
    }),
  });
  return deal.id;
}

export async function createTask(input: { contactId: string; subject: string; body: string; dueInMinutes?: number; priority?: "HIGH" | "MEDIUM" }): Promise<string> {
  const task = await hs<Obj>("/crm/v3/objects/tasks", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_task_subject: input.subject,
        hs_task_body: input.body,
        hs_timestamp: new Date(Date.now() + (input.dueInMinutes ?? 60) * 60_000).toISOString(),
        hs_task_status: "NOT_STARTED",
        hs_task_priority: input.priority ?? "HIGH",
        hs_task_type: "CALL",
        ...(env("HUBSPOT_FRONT_DESK_OWNER_ID") ? { hubspot_owner_id: env("HUBSPOT_FRONT_DESK_OWNER_ID") } : {}),
      },
      associations: [{ to: { id: input.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] }],
    }),
  });
  return task.id;
}

/** Contacts created since `since`, oldest first — candidates for a Vaani callback. */
export async function recentContacts(since: Date): Promise<Obj[]> {
  const r = await hs<{ results: Obj[] }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "createdate", operator: "GTE", value: String(since.getTime()) }] }],
      properties: ["firstname", "lastname", "phone", "mobilephone", "email", "createdate"],
      sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
      limit: 50,
    }),
  });
  return r.results;
}

export async function ensurePipeline(): Promise<{ pipelineId: string; stages: Record<string, string> }> {
  const outcomes: Outcome[] = ["QUALIFIED", "HUMAN_REVIEW", "REJECTED", "ESCALATED", "INCOMPLETE", "NOT_ENQUIRY"];
  const existing = await hs<{ results: { id: string; label: string; stages: { id: string; label: string }[] }[] }>("/crm/v3/pipelines/deals");
  let pipeline = existing.results.find((p) => p.label === "Vaani enquiries");
  if (!pipeline) {
    pipeline = await hs("/crm/v3/pipelines/deals", {
      method: "POST",
      body: JSON.stringify({
        label: "Vaani enquiries",
        displayOrder: 1,
        stages: outcomes.map((o, i) => ({
          label: o,
          displayOrder: i,
          metadata: { probability: o === "QUALIFIED" ? "0.4" : o === "HUMAN_REVIEW" || o === "INCOMPLETE" ? "0.2" : "0.0" },
        })),
      }),
    });
  }
  return { pipelineId: pipeline!.id, stages: Object.fromEntries(pipeline!.stages.map((s) => [s.label, s.id])) };
}
