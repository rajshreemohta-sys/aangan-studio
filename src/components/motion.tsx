"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@/lib/metrics";
import { REASON_LABELS } from "@/lib/classification";
import { OutcomeChip } from "./ui";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up from zero on load. */
export function CountUp({ value, format = "int", duration = 1100 }: { value: number; format?: "int" | "inr" | "pct" | "inr2" | "lakh"; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const total = reducedMotion() ? 0 : duration;
    const tick = (t: number) => {
      const p = total ? Math.min(1, (t - t0) / total) : 1;
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const text =
    format === "inr"
      ? `₹${Math.round(n).toLocaleString("en-IN")}`
      : format === "inr2"
        ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : format === "pct"
          ? `${Math.round(n)}%`
          : format === "lakh"
            ? `₹${(n / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 0 })}L`
            : Math.round(n).toLocaleString("en-IN");
  return (
    <span className="num" aria-label={String(value)}>
      {text}
    </span>
  );
}

/** Donut that draws itself in. */
export function Donut({ segments, size = 220, stroke = 26, center }: { segments: { label: string; value: number; color: string }[]; size?: number; stroke?: number; center: React.ReactNode }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  const starts = segments.map((_, i) => segments.slice(0, i).reduce((a, s) => a + (s.value / total) * C, 0));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1eee7" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const dash = Math.max(0, (s.value / total) * C - gap);
          return (
            <circle
              key={s.label}
              className="draw"
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${drawn ? dash : 0} ${C}`}
              strokeDashoffset={-starts[i]}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** Polls for new calls; new ones slide in at the top. */
export function LiveFeed({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState(initial);
  const known = useRef(new Set(initial.map((i) => i.id)));
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const res = await fetch("/api/feed", { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const { items: next } = (await res.json()) as { items: FeedItem[] };
      const added = next.filter((i) => !known.current.has(i.id)).map((i) => i.id);
      added.forEach((id) => known.current.add(id));
      if (added.length) setFresh(new Set(added));
      setItems(next);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  if (!items.length) return <p className="p-6 text-muted text-sm">No calls yet. When Vaani answers one, it appears here.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.id} className={fresh.has(i.id) ? "slide-in" : ""}>
          <Link href={`/dashboard/calls/${i.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#faf8f3] transition-colors">
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {i.name || "Unknown caller"}
                <span className="text-muted">{[i.locality, i.bhk].filter(Boolean).length ? ` · ${[i.locality, i.bhk].filter(Boolean).join(" ")}` : ""}</span>
              </p>
              <p className="text-xs text-muted mt-0.5 truncate">
                {ago(i.startedAt)} · {Math.round(i.durationSeconds / 60)} min{i.afterHours ? " · after hours" : ""}
                {i.direction === "outbound" ? " · callback" : ""}
                {i.outcome && i.outcome !== "QUALIFIED" && i.reasonCode ? ` · ${REASON_LABELS[i.reasonCode]}` : ""}
                {i.booked ? " · booked" : ""}
              </p>
            </div>
            <OutcomeChip outcome={i.outcome} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
