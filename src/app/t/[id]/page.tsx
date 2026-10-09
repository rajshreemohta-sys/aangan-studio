import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallView } from "@/components/call-view";
import { verifyTranscriptSignature } from "@/lib/auth";
import { callDetail } from "@/lib/metrics";

export const metadata = { title: "Call transcript · Aangan Studio", robots: { index: false } };

/** Signed link from the designer handoff email — no dashboard password needed. */
async function Transcript({ params, searchParams }: PageProps<"/t/[id]">) {
  const { id } = await params;
  const sig = (await searchParams).sig;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await verifyTranscriptSignature(id, typeof sig === "string" ? sig : undefined))) notFound();
  const detail = await callDetail(id);
  if (!detail) notFound();
  return (
    <>
      <div className="pt-10 pb-8 fade-up">
        <p className="label">Aangan Studio · call handoff</p>
        <h1 className="display text-5xl mt-3">{detail.lead?.name || "Caller"}</h1>
        <p className="text-muted mt-2">{[detail.lead?.locality, detail.lead?.bhk || detail.lead?.property_type].filter(Boolean).join(" · ")}</p>
      </div>
      <CallView detail={detail} internal={false} />
    </>
  );
}

export default function TranscriptPage(props: PageProps<"/t/[id]">) {
  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-8 pb-24">
      <Suspense fallback={<p className="label py-24">Loading…</p>}>
        <Transcript {...props} />
      </Suspense>
    </main>
  );
}
