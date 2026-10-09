/** Applies db/schema.sql to DATABASE_URL.   npm run db:migrate */
import { readFileSync } from "node:fs";
import { sql } from "../src/lib/db";

const statements = readFileSync("db/schema.sql", "utf8")
  .replace(/--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const s of statements) await sql().query(s);
console.log(`Applied ${statements.length} statements.`);
