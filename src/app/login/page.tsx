import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { checkPassword, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const next = String(formData.get("next") || "/dashboard");
  if (!(await checkPassword(String(formData.get("password") ?? "")))) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next.startsWith("/dashboard") ? next : "/dashboard");
}

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  return (
    <form action={login} className="card p-6 flex flex-col gap-4 fade-up" style={{ ["--i" as string]: 2 }}>
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-2">
        <span className="label">Password</span>
        <input className="input" type="password" name="password" autoFocus required autoComplete="current-password" />
      </label>
      {sp.error && <p className="text-sm text-[#b4232c]">That password didn&apos;t match.</p>}
      <button className="btn" type="submit">
        Open dashboard
      </button>
    </form>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="label fade-up">Aangan Studio · Vaani</p>
        <h1 className="display text-5xl mt-3 mb-8 fade-up" style={{ ["--i" as string]: 1 }}>
          Every call,
          <br />
          answered.
        </h1>
        <Suspense>
          <LoginForm searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
