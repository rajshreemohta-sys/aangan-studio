import Link from "next/link";
import type { Outcome } from "@/lib/classification";
import { OUTCOME_LABELS } from "@/lib/classification";

export const OUTCOME_COLORS: Record<Outcome, string> = {
  QUALIFIED: "#3E8EDB",
  HUMAN_REVIEW: "#F4D4F0",
  REJECTED: "#141414",
  ESCALATED: "#D7F07A",
  INCOMPLETE: "#c9c5bb",
  NOT_ENQUIRY: "#e6e3da",
};

export const inr = (n: number, digits = 0) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;

export function OutcomeChip({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return <span className="chip text-muted">Processing…</span>;
  return (
    <span className="chip">
      <span className="dot" style={{ background: OUTCOME_COLORS[outcome], boxShadow: outcome === "HUMAN_REVIEW" || outcome === "ESCALATED" ? "inset 0 0 0 1px rgba(0,0,0,.12)" : undefined }} />
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

export function Window({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`window ${className}`}>
      <div className="window-bar">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function Nav({ active }: { active: "dashboard" | "simulate" | "call" }) {
  const link = (href: string, label: string, on: boolean) => (
    <Link href={href} className={`label hover:text-ink transition-colors ${on ? "!text-ink" : ""}`}>
      {label}
    </Link>
  );
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 py-6">
      <Link href="/dashboard" className="label !text-ink">
        Aangan Studio <span className="text-muted">· Vaani</span>
      </Link>
      <nav className="flex items-center gap-6">
        {link("/dashboard", "Dashboard", active === "dashboard")}
        {link("/dashboard/simulate", "Simulate call", active === "simulate")}
        <form action="/logout" method="post">
          <button className="label hover:text-ink cursor-pointer" type="submit">
            Log out
          </button>
        </form>
      </nav>
    </header>
  );
}

export function SectionHead({ label, title, children }: { label: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        <p className="label">{label}</p>
        <h2 className="display text-3xl md:text-4xl mt-2">{title}</h2>
      </div>
      {children}
    </div>
  );
}
