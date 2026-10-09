"use client";

import { useActionState } from "react";
import { submitEnquiry, type EnquiryState } from "./actions";

export function EnquiryForm() {
  const [state, action, pending] = useActionState<EnquiryState, FormData>(submitEnquiry, {});
  if (state.ok)
    return (
      <div className="py-6">
        <p className="display text-3xl">Thank you.</p>
        <p className="text-muted mt-2">Vaani will call you in the next couple of minutes.</p>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Your name</span>
        <input className="input" name="name" required autoComplete="name" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Mobile number</span>
        <input className="input" name="phone" type="tel" required autoComplete="tel" placeholder="98765 43210" />
      </label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">Email (optional)</span>
          <input className="input" name="email" type="email" autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Area (optional)</span>
          <input className="input" name="locality" placeholder="e.g. Baner" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">What are you planning? (optional)</span>
        <textarea className="input min-h-24" name="message" />
      </label>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state.error && <p className="text-sm text-[#b4232c]">{state.error}</p>}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Call me back"}
      </button>
      <p className="text-xs text-muted">By submitting you agree to receive a call from Aangan Studio about your enquiry.</p>
    </form>
  );
}
