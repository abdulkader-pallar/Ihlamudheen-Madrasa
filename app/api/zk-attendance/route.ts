import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient, SERVICE_ROLE_KEY } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time API-key comparison to avoid timing side-channels.
function keysMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;      // HH:MM
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;            // YYYY-MM-DD

// POST /api/zk-attendance
// Called by the ZKTeco agent (zk_agent.py) for each fingerprint punch.
// Body: { apiKey, deviceUserId, punchTime: "HH:MM", punchDate: "YYYY-MM-DD" }
export async function POST(request: Request) {
  const expectedKey = process.env.ZK_API_KEY;
  if (!expectedKey) return NextResponse.json({ error: "ZK_API_KEY not configured on server" }, { status: 500 });
  if (!SERVICE_ROLE_KEY) return NextResponse.json({ error: "Service role key not configured on server" }, { status: 500 });

  let body: { apiKey?: string; deviceUserId?: number; punchTime?: string; punchDate?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!keysMatch(body.apiKey, expectedKey)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deviceUserId = Number(body.deviceUserId);
  const punchTime = body.punchTime;
  const punchDate = body.punchDate;
  if (!deviceUserId || !punchTime || !punchDate)
    return NextResponse.json({ error: "Missing deviceUserId / punchTime / punchDate" }, { status: 400 });
  if (!TIME_RE.test(punchTime) || !DATE_RE.test(punchDate))
    return NextResponse.json({ error: "Bad punchTime or punchDate format" }, { status: 400 });

  const supabase = createAdminClient();

  // Map the device enrolment number → staff member.
  const { data: staff } = await supabase
    .from("staff")
    .select("id, active")
    .eq("device_user_id", deviceUserId)
    .single();
  if (!staff) return NextResponse.json({ skipped: true, reason: `Device user ${deviceUserId} not mapped to any staff` });
  if (!staff.active) return NextResponse.json({ skipped: true, reason: `Staff for device user ${deviceUserId} is inactive` });

  // Today's row (if any) for this staff member.
  const { data: existing } = await supabase
    .from("attendance")
    .select("id, check_in, check_out")
    .eq("staff_id", staff.id)
    .eq("work_date", punchDate)
    .single();

  if (!existing) {
    // First punch of the day → check IN.
    const { error } = await supabase.from("attendance").insert({
      staff_id: staff.id, work_date: punchDate, check_in: punchTime, source: "device",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "check_in", punchTime, punchDate });
  }

  // A later punch → set / update check OUT (last punch of the day wins).
  // Guard: never let OUT be earlier than IN (ignore an out-of-order punch).
  if (existing.check_in && punchTime < existing.check_in) {
    return NextResponse.json({ skipped: true, reason: "Punch earlier than recorded check-in" });
  }
  const { error } = await supabase
    .from("attendance")
    .update({ check_out: punchTime })
    .eq("id", existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, action: "check_out", punchTime, punchDate });
}
