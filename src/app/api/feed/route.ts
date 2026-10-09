import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { recentFeed } from "@/lib/metrics";

export async function GET() {
  if (!(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value))) return Response.json({ error: "unauthorised" }, { status: 401 });
  return Response.json({ items: await recentFeed(12) });
}
