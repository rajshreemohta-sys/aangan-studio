import { EnquiryForm } from "./enquiry-form";

export const metadata = { title: "Enquire · Aangan Studio", description: "Tell us about your home — Vaani will call you back in a couple of minutes." };

/** A ready-made enquiry form: submitting it makes Vaani call the person back. */
export default function EnquirePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <p className="label fade-up">Aangan Studio · Pune</p>
        <h1 className="display text-5xl md:text-6xl mt-3 mb-4 fade-up" style={{ ["--i" as string]: 1 }}>
          Let&apos;s talk about your home.
        </h1>
        <p className="text-muted mb-8 fade-up" style={{ ["--i" as string]: 2 }}>
          Leave your number and Vaani, our assistant, will call you within a couple of minutes — any time of day.
        </p>
        <div className="card p-6 fade-up" style={{ ["--i" as string]: 3 }}>
          <EnquiryForm />
        </div>
      </div>
    </main>
  );
}
