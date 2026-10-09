import { pollNewContacts } from "@/lib/callbacks";
import { env } from "@/lib/env";

export const maxDuration = 60;

/** Called every minute by Supabase pg_cron (Vercel Hobby crons only run daily). */
export async function POST(req: Request) {
  const secret = env("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    return Response.json(await pollNewContacts());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
