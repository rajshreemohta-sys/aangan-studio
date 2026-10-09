/** Environment access. Integrations that aren't configured are skipped, never faked. */

export class NotConfiguredError extends Error {}

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new NotConfiguredError(`Missing environment variable: ${name}`);
  return v;
}

export function numberEnv(name: string, fallback: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const has = (...names: string[]) => names.every((n) => env(n));

export const STUDIO_TZ = "Asia/Kolkata";

export function appUrl(): string {
  return (env("APP_URL") ?? (env("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}` : "http://localhost:3000")).replace(/\/$/, "");
}
