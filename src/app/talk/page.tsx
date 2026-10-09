import { VoiceCall } from "./voice-call";

export const metadata = {
  title: "Talk to Vaani · Aangan Studio",
  description: "Tell Aangan Studio about your home — talk to Vaani, our voice assistant, right in your browser. Any time of day.",
};

/** Public page: a browser voice call with Vaani. No phone line needed. */
export default function TalkPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl">
        <div className="text-center mb-10">
          <p className="label fade-up">Aangan Studio · Pune</p>
          <h1 className="display text-5xl md:text-6xl mt-3 fade-up" style={{ ["--i" as string]: 1 }}>
            Tell us about your home.
          </h1>
          <p className="text-muted mt-4 max-w-md mx-auto fade-up" style={{ ["--i" as string]: 2 }}>
            Talk to Vaani, our assistant, right here in your browser — in English, Hindi or Marathi, any time of day. It takes about five minutes, and a designer gets everything you share.
          </p>
        </div>
        <div className="card p-8 md:p-10 fade-up" style={{ ["--i" as string]: 3 }}>
          <VoiceCall />
        </div>
        <p className="text-xs text-muted text-center mt-6 fade-up" style={{ ["--i" as string]: 4 }}>
          Calls are recorded and transcribed so our team can follow up. You&apos;ll need to allow microphone access.
        </p>
      </div>
    </main>
  );
}
