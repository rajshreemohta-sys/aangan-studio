import { connection } from "next/server";
import { Suspense } from "react";
import { QueuePage } from "@/components/queue-page";
import { Nav } from "@/components/ui";

export const metadata = { title: "Client care · Aangan Studio" };

async function Content() {
  await connection();
  return <QueuePage queue="care" />;
}

export default function Page() {
  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-8 pb-24">
      <Nav active="care" />
      <Suspense fallback={<p className="label py-24">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
