import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallView } from "@/components/call-view";
import { Nav } from "@/components/ui";
import { callDetail } from "@/lib/metrics";

async function Detail({ params }: { params: PageProps<"/dashboard/calls/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await callDetail(id);
  if (!detail) notFound();
  return (
    <>
      <div className="pt-4 pb-8 fade-up">
        <Link href="/dashboard" className="label hover:text-ink">
          ← Dashboard
        </Link>
        <h1 className="display text-5xl mt-4">{detail.lead?.name || "Unknown caller"}</h1>
        <p className="text-muted mt-2">{[detail.lead?.locality, detail.lead?.bhk || detail.lead?.property_type].filter(Boolean).join(" · ") || "Details not collected"}</p>
      </div>
      <CallView detail={detail} internal />
    </>
  );
}

export default function CallPage(props: PageProps<"/dashboard/calls/[id]">) {
  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-8 pb-24">
      <Nav active="call" />
      <Suspense fallback={<p className="label py-24">Loading call…</p>}>
        <Detail params={props.params} />
      </Suspense>
    </main>
  );
}
