import type { CallRow } from "@/lib/database.types";
import { one } from "@/lib/db";
import { streamRecording } from "@/lib/vaani";

/** Plays a call's recording through the app, so the Vaani API key never reaches the browser. */
export async function GET(req: Request, ctx: RouteContext<"/api/recording/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const call = await one<Pick<CallRow, "vaani_call_id" | "recording_url">>("select vaani_call_id, recording_url from calls where id = $1", [id]);
  if (!call?.vaani_call_id || !call.recording_url) return new Response("No recording for this call", { status: 404 });

  const upstream = await streamRecording(call.vaani_call_id, req.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) return new Response("Recording unavailable", { status: 502 });
  const headers = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "audio/ogg", "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes" });
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
