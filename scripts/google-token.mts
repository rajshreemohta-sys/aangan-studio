/**
 * Gets a Google Calendar refresh token for the studio account and saves it to .env.local.
 *   npm run google:token
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a "Desktop app" OAuth client) in .env.local.
 * Opens Google's sign-in in your browser; sign in as the account that can edit every designer calendar.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local first.");
  process.exit(1);
}

const server = createServer();
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const redirectUri = `http://127.0.0.1:${port}`;

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/calendar",
  access_type: "offline",
  prompt: "consent",
}).toString();

console.log("Opening Google sign-in in your browser… If it doesn't open, paste this link into your browser:\n");
console.log(authUrl.toString(), "\n");
execFile("open", [authUrl.toString()]);

const code = await new Promise<string>((resolve, reject) => {
  server.on("request", (req, res) => {
    const params = new URL(req.url ?? "/", redirectUri).searchParams;
    const error = params.get("error");
    const got = params.get("code");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(error ? `<p>Google said: ${error}. You can close this tab.</p>` : "<p>Done — you can close this tab and go back to the terminal.</p>");
    if (error) reject(new Error(error));
    else if (got) resolve(got);
  });
});
server.close();

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
});
const data = (await res.json()) as { refresh_token?: string; error_description?: string };
if (!data.refresh_token) {
  console.error("Google didn't return a refresh token:", data.error_description ?? JSON.stringify(data));
  process.exit(1);
}

// Replace any earlier token in .env.local rather than adding a second line.
const envFile = ".env.local";
const lines = readFileSync(envFile, "utf8").split("\n").filter((l) => !l.startsWith("GOOGLE_REFRESH_TOKEN="));
writeFileSync(envFile, lines.join("\n").replace(/\n*$/, "\n"));
appendFileSync(envFile, `GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
console.log("Saved GOOGLE_REFRESH_TOKEN to .env.local. Tell Claude it's done.");
