import { connection } from "next/server";
import { recentFeed } from "@/lib/metrics";

export async function GET() {
  await connection();
  return Response.json({ items: await recentFeed(12) });
}
