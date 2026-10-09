"use client";

import { useActionState } from "react";
import { callWithVaani, type CallState } from "@/app/dashboard/leads/actions";

const STATUS: Record<string, string> = {
  queued: "Vaani is placing the call…",
  dialling: "Vaani is calling",
  no_answer: "No answer last time",
  rejected: "They declined the call",
  failed: "Last call failed",
  completed: "Vaani spoke to them",
};

export function CallButton({ leadId, hasPhone, lastStatus, lastAt }: { leadId: string; hasPhone: boolean; lastStatus: string | null; lastAt: string | null }) {
  const [state, action, pending] = useActionState<CallState, FormData>(callWithVaani, {});
  const busy = lastStatus === "dialling" || lastStatus === "queued";
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="lead_id" value={leadId} />
      <button className="btn btn-ghost !py-2 whitespace-nowrap" type="submit" disabled={!hasPhone || pending || busy} title={hasPhone ? undefined : "No phone number on file"}>
        {pending ? "Starting call…" : "Call with Vaani"}
      </button>
      {(state.message || state.error || lastStatus) && (
        <span className={`text-xs ${state.error ? "text-[#b4232c]" : "text-muted"}`}>
          {state.error ?? state.message ?? `${STATUS[lastStatus!] ?? lastStatus}${lastAt ? ` · ${new Date(lastAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}`}
        </span>
      )}
    </form>
  );
}
