// Run SQL on Ihlamudheen's Supabase database through the Supabase Management
// API, instead of pasting it into the SQL editor:
//
//   node scripts/run-sql.mjs supabase/some-migration.sql
//   node scripts/run-sql.mjs -e "select count(*) from public.units"
//
// Needs SUPABASE_ACCESS_TOKEN (a personal access token, sbp_…) in .env.local;
// the line may be commented out with #. The token can reach every project in
// the Supabase account, so it stays in .env.local only (gitignored).
import { readFileSync } from "node:fs";

const PROJECT = "iiathuvpstbqrtsskppq";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const token = env.match(/SUPABASE_ACCESS_TOKEN=\s*"?([^\s"]+)/)?.[1];
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not in .env.local");

const [arg, inline] = process.argv.slice(2);
if (!arg) throw new Error("Usage: node scripts/run-sql.mjs <file.sql> | -e \"<sql>\"");
const query = arg === "-e" ? inline : readFileSync(arg, "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const body = await res.text();
console.log(res.ok ? body : `Error ${res.status}: ${body}`);
process.exitCode = res.ok ? 0 : 1;
