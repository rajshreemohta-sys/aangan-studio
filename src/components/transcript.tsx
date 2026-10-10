/** Renders "Agent: …" / "Caller: …" lines as a readable conversation. */
export function Transcript({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return <p className="text-muted">No transcript — the call was missed or dropped.</p>;
  return (
    <div className="space-y-2.5">
      {lines.map((line, i) => {
        const m = line.match(/^(Agent|Vaani|Front Desk|Caller):\s*(.*)$/);
        if (!m) return <p key={i} className="label pt-2">{line}</p>;
        const agent = m[1] !== "Caller";
        return (
          <p key={i} className={agent ? "text-muted" : ""}>
            <span className={`label mr-2 ${agent ? "" : "!text-ink"}`}>{agent ? (m[1] === "Front Desk" ? "Front desk" : "Vaani") : "Caller"}</span>
            {m[2]}
          </p>
        );
      })}
    </div>
  );
}

export function Recording({ callId }: { callId: string }) {
  return (
    <audio controls preload="none" className="w-full h-10" src={`/api/recording/${callId}`}>
      Your browser can&apos;t play this recording.
    </audio>
  );
}
