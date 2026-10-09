"use client";

import { ConnectionState, Room, RoomEvent, Track, type Participant, type RemoteTrack, type TranscriptionSegment } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { startVoiceCall } from "./actions";

type Phase = "idle" | "connecting" | "waiting" | "live" | "ended" | "error";
type Line = { id: string; who: "Vaani" | "You"; text: string; final: boolean };

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिंदी" },
  { id: "mr", label: "मराठी" },
] as const;

export function VoiceCall() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<"en" | "hi" | "mr">("en");
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<"vaani" | "you" | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [seconds, setSeconds] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const captionsRef = useRef<HTMLDivElement>(null);

  // Call timer
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    captionsRef.current?.scrollTo({ top: captionsRef.current.scrollHeight });
  }, [lines]);

  // Leave the room if the page is closed mid-call.
  useEffect(() => () => void roomRef.current?.disconnect(), []);

  async function start() {
    setError(null);
    setLines([]);
    setSeconds(0);
    setPhase("connecting");

    // Ask for the microphone first, inside the click, so browsers allow it.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Please allow microphone access to talk to Vaani.");
      setPhase("error");
      return;
    }

    const res = await startVoiceCall(language);
    if (!res.ok) {
      setError(res.error);
      setPhase("error");
      return;
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const isVaani = (p?: Participant) => !!p && p.identity !== room.localParticipant.identity;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      audioRef.current?.appendChild(el);
      setPhase("live");
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((el) => el.remove()));
    room.on(RoomEvent.ParticipantConnected, () => setPhase((p) => (p === "waiting" ? "live" : p)));
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      setSpeaking(speakers.some(isVaani) ? "vaani" : speakers.length ? "you" : null);
    });
    room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant?: Participant) => {
      const who = isVaani(participant) ? "Vaani" : "You";
      setLines((prev) => {
        const next = [...prev];
        for (const s of segments) {
          const i = next.findIndex((l) => l.id === s.id);
          const line = { id: s.id, who, text: s.text, final: s.final } as Line;
          if (i >= 0) next[i] = line;
          else next.push(line);
        }
        return next.slice(-40);
      });
    });
    room.on(RoomEvent.Disconnected, () => {
      setSpeaking(null);
      setPhase((p) => (p === "error" ? p : "ended"));
      roomRef.current = null;
    });

    try {
      await room.connect(res.session.url, res.session.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.startAudio();
      setPhase(room.remoteParticipants.size ? "live" : "waiting");
    } catch (e) {
      console.error(e);
      setError("We couldn't connect the call. Please check your internet connection and try again.");
      setPhase("error");
      await room.disconnect();
    }
  }

  async function hangUp() {
    await roomRef.current?.disconnect();
  }

  async function toggleMute() {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    await room.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }

  const inCall = phase === "connecting" || phase === "waiting" || phase === "live";
  const status = {
    idle: "Tap to start talking",
    connecting: "Connecting…",
    waiting: "Vaani is joining…",
    live: muted ? "You're muted" : speaking === "vaani" ? "Vaani is speaking" : speaking === "you" ? "Listening…" : "Go ahead — Vaani is listening",
    ended: "Call ended",
    error: "Couldn't connect",
  }[phase];

  return (
    <div className="flex flex-col items-center text-center">
      {!inCall && phase !== "ended" && (
        <div className="flex gap-1.5 mb-8" role="group" aria-label="Language">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLanguage(l.id)}
              className={`chip cursor-pointer ${language === l.id ? "!bg-ink !text-white !border-ink" : "hover:border-ink"}`}
              aria-pressed={language === l.id}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative w-44 h-44 flex items-center justify-center">
        {phase === "live" && speaking && <span className={`voice-ring ${speaking === "vaani" ? "bg-blue/30" : "bg-lime/60"}`} aria-hidden />}
        <button
          type="button"
          onClick={inCall ? hangUp : start}
          disabled={phase === "connecting"}
          className={`relative w-36 h-36 rounded-full flex flex-col items-center justify-center text-white transition-colors shadow-[0_20px_50px_-20px_rgba(20,20,20,.5)] cursor-pointer disabled:cursor-default ${inCall ? "bg-[#c4342c] hover:bg-[#a82b24]" : "bg-ink hover:bg-[#2a2a2a]"}`}
          aria-label={inCall ? "End call" : "Start a voice call with Vaani"}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={inCall ? "rotate-[135deg] transition-transform" : "transition-transform"}>
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
          </svg>
          <span className="text-sm mt-2">{inCall ? "End call" : phase === "ended" ? "Call again" : "Talk to Vaani"}</span>
        </button>
      </div>

      <p className="mt-6 text-lg" aria-live="polite">
        {status}
        {phase === "live" && <span className="text-muted num"> · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>}
      </p>
      {error && <p className="text-sm text-[#b4232c] mt-2 max-w-sm">{error}</p>}
      {phase === "ended" && <p className="text-muted mt-2 max-w-sm">Thank you — our team will get back to you shortly.</p>}

      {inCall && (
        <button type="button" onClick={toggleMute} className="btn btn-ghost mt-5" disabled={phase !== "live"}>
          {muted ? "Unmute" : "Mute"}
        </button>
      )}

      {lines.length > 0 && (
        <div ref={captionsRef} className="mt-8 w-full max-h-64 overflow-auto text-left card p-4 space-y-2 text-[15px]" aria-label="Live captions">
          {lines.map((l) => (
            <p key={l.id} className={l.final ? "" : "text-muted"}>
              <span className={`label mr-2 ${l.who === "Vaani" ? "" : "!text-ink"}`}>{l.who}</span>
              {l.text}
            </p>
          ))}
        </div>
      )}
      <div ref={audioRef} className="hidden" />
    </div>
  );
}
