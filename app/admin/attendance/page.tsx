"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Fingerprint, LogIn, LogOut, UserRound, Users } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Panel, Spinner, StatCard } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import type { Attendance } from "@/lib/types";
import { btn, cx, inputClass } from "@/lib/ui";

const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
const nowTime = () => new Date().toTimeString().slice(0, 5); // HH:MM, local
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function AttendancePage() {
  const { staff, supabase, canEdit: editor, loading, loadAttendance } = useData();
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState<Attendance[] | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await loadAttendance(date));
    } catch (e) {
      toast((e as Error).message, true);
      setRows([]);
    }
  }, [loadAttendance, date]);

  useEffect(() => { load(); }, [load]);

  const byStaff = useMemo(() => {
    const m: Record<string, Attendance> = {};
    (rows || []).forEach((r) => { m[r.staff_id] = r; });
    return m;
  }, [rows]);

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const present = useMemo(() => activeStaff.filter((s) => byStaff[s.id]?.check_in).length, [activeStaff, byStaff]);

  // Save a manual check_in / check_out for a staff member on the selected date.
  const setTime = async (staffId: string, field: "check_in" | "check_out", value: string) => {
    const v = value || null;
    const existing = byStaff[staffId];
    let error;
    if (existing) {
      ({ error } = await supabase.from("attendance").update({ [field]: v, source: "manual" }).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("attendance").insert({ staff_id: staffId, work_date: date, [field]: v, source: "manual" }));
    }
    if (error) { toast(error.message, true); return; }
    await load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade grid gap-5">
      {/* Intro / device note */}
      <Panel>
        <div className="flex items-start gap-3">
          <Fingerprint size={20} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-[14px] text-muted">
            In &amp; out times come from the <b className="text-ink">ZKTeco fingerprint device</b> automatically.
            Each staff member is matched by their <b className="text-ink">device user&nbsp;id</b>.
            {editor && " You can also record or correct times by hand below."}
          </p>
        </div>
      </Panel>

      {/* Controls + stats */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <StatCard icon={UserRound} accent="teal" label="Present" value={`${present} / ${activeStaff.length}`} sub={date === todayStr() ? "Today" : date} />
        <Panel className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2.5 text-[13px] font-bold">
            <CalendarDays size={18} className="text-brand" /> Date
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)}
              className={cx(inputClass, "w-auto py-2")} />
          </label>
          {editor && (
            <Link href="/admin/staff" className={btn({ variant: "ghost", size: "sm" })}>
              <Users size={15} /> Manage staff
            </Link>
          )}
        </Panel>
      </div>

      {/* Attendance board */}
      <Panel title="Attendance">
        {rows === null ? (
          <Spinner />
        ) : activeStaff.length === 0 ? (
          <EmptyState>No active staff to show{editor ? " — add staff to get started." : "."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">Staff</th>
                  <th className="py-2 font-bold">Status</th>
                  <th className="py-2 font-bold">In</th>
                  <th className="py-2 font-bold">Out</th>
                  <th className="py-2 font-bold">Source</th>
                </tr>
              </thead>
              <tbody>
                {activeStaff.map((s) => {
                  const a = byStaff[s.id];
                  return (
                    <tr key={s.id} className="border-t border-line align-middle">
                      <td className="py-2.5">
                        <div className="font-bold">{s.name}</div>
                        <div className="text-[12px] text-muted">{s.designation || "Staff"}</div>
                      </td>
                      <td className="py-2.5"><StatusChip a={a} /></td>
                      <td className="py-2.5">
                        <TimeCell value={hhmm(a?.check_in ?? null)} editor={editor}
                          onSet={(v) => setTime(s.id, "check_in", v)} onNow={() => setTime(s.id, "check_in", nowTime())} icon={LogIn} />
                      </td>
                      <td className="py-2.5">
                        <TimeCell value={hhmm(a?.check_out ?? null)} editor={editor}
                          onSet={(v) => setTime(s.id, "check_out", v)} onNow={() => setTime(s.id, "check_out", nowTime())} icon={LogOut} />
                      </td>
                      <td className="py-2.5 text-[12px] capitalize text-muted">{a?.source || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

    </div>
  );
}

function StatusChip({ a }: { a?: Attendance }) {
  if (!a?.check_in && !a?.check_out) return <span className="inline-flex rounded-full bg-bad-bg px-2.5 py-0.5 text-[11.5px] font-bold text-bad">Absent</span>;
  if (a.check_in && !a.check_out) return <span className="inline-flex rounded-full bg-accent/20 px-2.5 py-0.5 text-[11.5px] font-bold" style={{ color: "var(--accent)" }}>In — no out</span>;
  return <span className="inline-flex rounded-full bg-good-bg px-2.5 py-0.5 text-[11.5px] font-bold text-good">Present</span>;
}

function TimeCell({
  value, editor, onSet, onNow, icon: Icon,
}: {
  value: string; editor: boolean; onSet: (v: string) => void; onNow: () => void; icon: typeof LogIn;
}) {
  if (!editor) return <span className="tnum">{value || "—"}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="time"
        defaultValue={value}
        key={value}
        onBlur={(e) => { if (e.target.value !== value) onSet(e.target.value); }}
        className={cx(inputClass, "w-[118px] py-1.5 text-[13px]")}
      />
      {!value && (
        <button onClick={onNow} title="Set current time" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-brand hover:text-brand">
          <Icon size={15} />
        </button>
      )}
    </span>
  );
}
