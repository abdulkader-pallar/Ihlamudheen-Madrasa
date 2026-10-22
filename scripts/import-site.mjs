// One-time copy of another institution's books from its old Supabase project
// into Ihlamudheen's database, tagged with its institution id. Run after
// supabase/institutions.sql:
//
//   node scripts/import-site.mjs pmsa
//   node scripts/import-site.mjs gracevalley
//
// Reads <SITE>_SUPABASE_URL / <SITE>_SUPABASE_SECRET_KEY and Ihlamudheen's
// NEXT_PUBLIC_SUPABASE_URL / NEXT_SECRET_SUPABASE_SECRET_KEY from .env.local.
// Rows keep their ids, so running it again just overwrites the same rows.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const site = process.argv[2];
if (!["pmsa", "gracevalley"].includes(site)) throw new Error("Usage: node scripts/import-site.mjs <pmsa|gracevalley>");
const PREFIX = site.toUpperCase();

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const from = createClient(env[`${PREFIX}_SUPABASE_URL`], env[`${PREFIX}_SUPABASE_SECRET_KEY`], opts);
const to = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_SECRET_SUPABASE_SECRET_KEY,
  opts
);

// Parents before children so foreign keys resolve.
const TABLES = ["categories", "funds", "transactions", "staff", "attendance"];

for (const table of TABLES) {
  const { data, error } = await from.from(table).select("*");
  if (error) throw new Error(`read ${table}: ${error.message}`);
  // The old site's login accounts don't exist here, so drop who-created-it links.
  const rows = data.map(({ created_by, updated_by, ...r }) => ({ ...r, institution: site }));
  if (rows.length) {
    const { error: e } = await to.from(table).upsert(rows, { onConflict: "id" });
    if (e) throw new Error(`write ${table}: ${e.message}`);
  }
  console.log(`${table}: ${rows.length}`);
}
