"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, User, LogOut,
  Check, BookOpen, PenLine, BookOpenCheck, Loader2, Send, Sun, Moon,
  TrendingUp, TrendingDown, Minus,
  FileText, HardDrive, Link2, ExternalLink,
} from "lucide-react";
import { useTheme } from "next-themes";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getActivityMeta } from "@/components/ActivityTrackerPage";
import {
  RECITATION_MAX, RECITATION_CRITERIA, toWeeklySeries, weeklyTrend, averageTotal,
  recitationBand, type RecitationSession,
} from "@/lib/recitation";

// ─── Types ───────────────────────────────────────────────
interface SelfReport {
  fajr: boolean; dhuhr: boolean; asr: boolean; maghrib: boolean; isha: boolean;
  quran: boolean; reading: boolean; writing: boolean;
}
type CustomData = Record<string, boolean>;
type DayKey = "sat"|"sun"|"mon"|"tue"|"wed"|"thu"|"fri";

const EMPTY: SelfReport = {
  fajr:false, dhuhr:false, asr:false, maghrib:false, isha:false,
  quran:false, reading:false, writing:false,
};
const PRAYERS: (keyof SelfReport)[] = ["fajr","dhuhr","asr","maghrib","isha"];
const PRAYER_SHORT = ["Faj","Dhu","Asr","Mag","Ish"];
const PRAYER_FULL  = ["Fajr","Dhuhr","Asr","Maghrib","Isha"];
const WEEK_ORDER: DayKey[] = ["sat","sun","mon","tue","wed","thu","fri"];
const DAY_LABEL: Record<DayKey,string> = {
  sat:"Saturday",sun:"Sunday",mon:"Monday",tue:"Tuesday",
  wed:"Wednesday",thu:"Thursday",fri:"Friday",
};
const DAY_SHORT: Record<DayKey,string> = {
  sat:"SA",sun:"SU",mon:"MO",tue:"TU",wed:"WE",thu:"TH",fri:"FR",
};

// ─── Class list (structure only — students come from DB) ─
interface PortalCourse { id:string; name:string; color:string; }
interface PortalClass  { id:string; grade:string; courseId:string; }

const PORTAL_COURSES: PortalCourse[] = [
  { id:"madrasa",       name:"Ihlamudheen Madrasa",   color:"#10b981" },
  { id:"english",     name:"English Madrasa",  color:"#3b82f6" },
  { id:"edu-support", name:"Edu Support",       color:"#a855f7" },
];

const ALL_CLASSES: PortalClass[] = [
  {id:"1a",   courseId:"madrasa",       grade:"Grade 1A"},
  {id:"1b",   courseId:"madrasa",       grade:"Grade 1B"},
  {id:"1c",   courseId:"madrasa",       grade:"Grade 1C"},
  {id:"2a",   courseId:"madrasa",       grade:"Grade 2A"},
  {id:"2b",   courseId:"madrasa",       grade:"Grade 2B"},
  {id:"3a",   courseId:"madrasa",       grade:"Grade 3A"},
  {id:"3b",   courseId:"madrasa",       grade:"Grade 3B"},
  {id:"4a",   courseId:"madrasa",       grade:"Grade 4A"},
  {id:"5a",   courseId:"madrasa",       grade:"Grade 5A"},
  {id:"6a",   courseId:"madrasa",       grade:"Grade 6A"},
  {id:"7a",   courseId:"madrasa",       grade:"Grade 7A"},
  {id:"8a",   courseId:"madrasa",       grade:"Grade 8A"},
  {id:"9a",   courseId:"madrasa",       grade:"Grade 9A"},
  {id:"10a",  courseId:"madrasa",       grade:"Grade 10A"},
  {id:"level1",courseId:"english",    grade:"Level 1"},
  {id:"level2",courseId:"english",    grade:"Level 2"},
  {id:"level3",courseId:"english",    grade:"Level 3"},
  {id:"level5",courseId:"english",    grade:"Level 5"},
  {id:"es1",   courseId:"edu-support",grade:"Grade 1"},
  {id:"es2",   courseId:"edu-support",grade:"Grade 2"},
  {id:"es3",   courseId:"edu-support",grade:"Grade 3"},
  {id:"es4",   courseId:"edu-support",grade:"Grade 4"},
  {id:"es5",   courseId:"edu-support",grade:"Grade 5"},
  {id:"es6",   courseId:"edu-support",grade:"Grade 6"},
];

// ─── Week helpers ─────────────────────────────────────────
function getWeekStart(offset=0): Date {
  const now=new Date(), day=now.getDay();
  const sat=new Date(now);
  sat.setDate(now.getDate()-(day===6?0:day+1)+offset*7);
  sat.setHours(0,0,0,0);
  return sat;
}
function weekKey(d:Date):string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function weekLabel(d:Date):string {
  const end=new Date(d); end.setDate(d.getDate()+5);
  const fmt=(x:Date)=>x.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
  return `${fmt(d)} – ${fmt(end)}`;
}
function todayDayKey():DayKey {
  const map:Record<number,DayKey>={6:"sat",0:"sun",1:"mon",2:"tue",3:"wed",4:"thu",5:"fri"};
  return map[new Date().getDay()]??"sat";
}

// ─── Supabase helpers ─────────────────────────────────────

// Look up a student by roll number across all classes — class is inferred from the DB record
async function findStudentByRoll(
  rollInput:string
): Promise<{id:string; name:string; grade:string; classId:string} | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase
    .from("students")
    .select("id, name, roll_no, class_id")
    .or(`id.eq.${rollInput},roll_no.eq.${rollInput}`)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  const hard = ALL_CLASSES.find(c=>c.id===row.class_id);
  let grade = hard?.grade ?? "";
  if (!grade) {
    // Class created in-app (id not in the static list, e.g. "c1777…") — resolve
    // its real display name so the portal works for every class, not just the
    // hard-coded grades.
    const { data: cl } = await supabase.from("classes").select("name").eq("id", row.class_id).maybeSingle();
    grade = (cl?.name as string) || row.class_id;
  }
  return {
    id: String(row.roll_no ?? row.id),
    name: row.name,
    grade,
    classId: row.class_id,
  };
}

async function fetchClassActivities(classId:string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const {data} = await supabase
    .from("class_custom_activities").select("activity_name")
    .eq("class_id",classId).order("position",{ascending:true});
  return (data??[]).map((r:Record<string,string>)=>r.activity_name);
}

async function fetchHiddenDefaults(classId:string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const {data} = await supabase
    .from("class_activity_config").select("hidden_defaults")
    .eq("class_id",classId).maybeSingle();
  return (data?.hidden_defaults??[]) as string[];
}

async function fetchReports(
  classId:string, rollNo:string, wKey:string, pin?:string
): Promise<{reports:Record<string,SelfReport>; customs:Record<string,CustomData>; submitted:Record<string,boolean>; pinRequired?:boolean}> {
  const empty = {reports:{},customs:{},submitted:{}};
  // Reads go through the server route (service role, single-student scoped) so
  // the public anon key can no longer dump the whole table. See
  // src/app/api/student-report/route.ts.
  try {
    const pinQ = pin ? `&pin=${encodeURIComponent(pin)}` : "";
    const res = await fetch(
      `/api/student-report?classId=${encodeURIComponent(classId)}&rollNo=${encodeURIComponent(rollNo)}&weekKey=${encodeURIComponent(wKey)}${pinQ}`
    );
    if (res.status === 401) return { ...empty, pinRequired: true };  // PIN missing or wrong
    if (!res.ok) return empty;
    const { rows } = (await res.json()) as { rows: Record<string,unknown>[] | null };
    if (!rows) return empty;
    const reports:Record<string,SelfReport>={};
    const customs:Record<string,CustomData>={};
    const submitted:Record<string,boolean>={};
    for (const row of rows) {
      const dk=row.day_key as string;
      reports[dk]={fajr:!!row.fajr,dhuhr:!!row.dhuhr,asr:!!row.asr,maghrib:!!row.maghrib,isha:!!row.isha,quran:!!row.quran,reading:!!row.reading,writing:!!row.writing};
      customs[dk]=typeof row.custom_data==="object"&&row.custom_data!==null?(row.custom_data as CustomData):{};
      submitted[dk]=!!row.submitted_at;
    }
    return {reports,customs,submitted};
  } catch { return empty; }
}

async function upsertReport(
  classId:string, rollNo:string, wKey:string, day:DayKey,
  report:SelfReport, customData:CustomData, isSubmit=false, pin?:string
): Promise<boolean> {
  // Writes go through the server route (service role, single-student scoped,
  // roster-validated). See src/app/api/student-report/route.ts.
  try {
    const res = await fetch("/api/student-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId, rollNo, weekKey: wKey, dayKey: day, report, customData, isSubmit, pin }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error("[SSR] save failed:", res.status, msg.slice(0, 200));
    }
    return res.ok;
  } catch (e) {
    console.error("[SSR] save error:", e);
    return false;
  }
}

// ─── Quran recitation (read-only, parent-facing) ──────────
// Reads go through the service-role route so the public anon key can't dump the
// table — single-student scoped + PIN-gated, mirroring /api/student-report.
async function fetchRecitation(
  classId: string, rollNo: string, pin?: string
): Promise<{ sessions: RecitationSession[]; pinRequired?: boolean; tableMissing?: boolean }> {
  try {
    const pinQ = pin ? `&pin=${encodeURIComponent(pin)}` : "";
    const res = await fetch(
      `/api/student-recitation?classId=${encodeURIComponent(classId)}&rollNo=${encodeURIComponent(rollNo)}${pinQ}`
    );
    if (res.status === 401) return { sessions: [], pinRequired: true };
    if (!res.ok) return { sessions: [] };
    const json = (await res.json()) as {
      sessions?: { date: string; pronunciation: number; tajweed: number; style: number; startStop: number; total: number; notes?: string; assessedBy?: string }[];
      tableMissing?: boolean;
    };
    const sessions: RecitationSession[] = (json.sessions ?? []).map((r, i) => ({
      id: `${rollNo}-${r.date}-${i}`,
      classId, studentId: rollNo, date: r.date,
      pronunciation: r.pronunciation, tajweed: r.tajweed, style: r.style, startStop: r.startStop,
      total: r.total, notes: r.notes, assessedBy: r.assessedBy,
    }));
    return { sessions, tableMissing: json.tableMissing };
  } catch { return { sessions: [] }; }
}

function fmtRecDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Class Notes / LMS (read-only, scoped to the student's class) ──────────
// Notes live in the shared `lms_notes` table and are populated by teachers/admins
// from /dashboard/lms. The query is filtered by class_id so a signed-in student
// only ever sees the learning materials for their own class.
interface ClassNote {
  id: string;
  title: string;
  description?: string;
  linkUrl: string;
  linkType: string;       // drive | youtube | doc | other
  teacherName: string;
  createdAt: string;
}

async function fetchClassNotes(classId: string): Promise<ClassNote[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from("lms_notes")
    .select("id, title, description, link_url, link_type, teacher_name, created_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) || undefined,
    linkUrl: r.link_url as string,
    linkType: (r.link_type as string) || "other",
    teacherName: r.teacher_name as string,
    createdAt: r.created_at as string,
  }));
}

function noteIcon(t: string) {
  if (t === "drive") return <HardDrive className="w-4 h-4 text-emerald" />;
  if (t === "doc") return <FileText className="w-4 h-4 text-blue" />;
  if (t === "youtube") return <BookOpen className="w-4 h-4 text-rose" />;
  return <Link2 className="w-4 h-4 text-muted-foreground" />;
}

function ClassNotesReport({ notes, loading, grade }: { notes: ClassNote[]; loading: boolean; grade: string }) {
  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-gold" /></div>;
  }
  if (notes.length === 0) {
    return (
      <div className="glass-card rounded-[20px] p-8 flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(201,168,76,0.1)" }}>
          <BookOpen className="w-7 h-7 text-gold/70" />
        </div>
        <p className="text-sm font-semibold text-foreground">No class notes yet</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Study materials and links shared by your teacher for {grade} will appear here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Class Notes · {grade}</span>
        <span className="text-[10px] text-muted-foreground">{notes.length} item{notes.length === 1 ? "" : "s"}</span>
      </div>
      {notes.map((n) => (
        <a key={n.id} href={n.linkUrl} target="_blank" rel="noopener noreferrer"
          className="glass-card rounded-2xl p-4 flex items-start gap-3 hover:bg-white/[0.04] transition-colors">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-foreground/[0.05]">
            {noteIcon(n.linkType)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground break-words">{n.title}</h3>
            {n.description && <p className="text-xs text-muted-foreground mt-1 break-words">{n.description}</p>}
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="truncate">By {n.teacherName}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{fmtRecDate(n.createdAt.slice(0, 10))}</span>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        </a>
      ))}
    </div>
  );
}

// Short, phone-legible labels for the four rubric criteria.
const REC_SHORT: Record<string,string> = {
  pronunciation: "Pronunciation",
  tajweed: "Tajweed",
  style: "Style",
  startStop: "Start & Stop",
};

// ─── Avatar helpers ───────────────────────────────────────

const AVATAR_BUCKET = "student-avatars";

function avatarPath(classId: string, studentId: string) {
  return `${classId}/${studentId}.jpg`;
}

export function getAvatarPublicUrl(classId: string, studentId: string): string {
  if (!isSupabaseConfigured()) return "";
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath(classId, studentId)).data.publicUrl;
}

async function compressToJpeg(file: File, maxKB = 50): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(src);
      const MAX = 320;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      let quality = 0.82;
      const attempt = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(new Blob()); return; }
          if (blob.size <= maxKB * 1024 || quality <= 0.12) resolve(blob);
          else { quality -= 0.1; attempt(); }
        }, "image/jpeg", quality);
      };
      attempt();
    };
    img.src = src;
  });
}

async function uploadAvatar(classId: string, studentId: string, file: File): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const blob = await compressToJpeg(file);
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(avatarPath(classId, studentId), blob, { upsert: true, contentType: "image/jpeg" });
  if (error) return null;
  return getAvatarPublicUrl(classId, studentId);
}

// ─── Session ──────────────────────────────────────────────
const SESSION_KEY="madrasa-student-session-v1";
interface Session {classId:string;rollNo:string;pin?:string;}
function loadSession():Session|null {
  try{const s=localStorage.getItem(SESSION_KEY);return s?JSON.parse(s):null;}catch{return null;}
}
function saveSession(s:Session){try{localStorage.setItem(SESSION_KEY,JSON.stringify(s));}catch{}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY);}catch{}}

// ─── Star Field ───────────────────────────────────────────
function MiniStarField() {
  const stars=useMemo(()=>Array.from({length:40},(_,i)=>({
    id:i,x:Math.random()*100,y:Math.random()*100,
    size:Math.random()*1.2+0.4,opacity:Math.random()*0.25+0.05,
  })),[]);
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {stars.map(star=>(
        <div key={star.id} className="absolute rounded-full"
          style={{left:`${star.x}%`,top:`${star.y}%`,width:star.size,height:star.size,backgroundColor:`rgba(255,255,255,${star.opacity})`}}/>
      ))}
      <div className="absolute top-16 right-8 w-12 h-12 rounded-full" style={{boxShadow:"inset -6px -2px 0 0 rgba(201,168,76,0.2)"}}/>
    </div>
  );
}

const spring={type:"spring" as const,stiffness:300,damping:20};

function StepWrapper({children,direction}:{children:React.ReactNode;direction:number}) {
  
  return (
    <motion.div
      initial={false?{opacity:0}:{x:direction*100,opacity:0}}
      animate={{x:0,opacity:1}}
      exit={false?{opacity:0}:{x:direction*-100,opacity:0}}
      transition={spring} className="w-full">
      {children}
    </motion.div>
  );
}

function PrayerButton({name,fullName,checked,onToggle}:{name:string;fullName:string;checked:boolean;onToggle:()=>void}) {
  return (
    <motion.button onClick={onToggle}
      className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-center transition-all"
      style={checked
        ?{background:"rgba(201,168,76,0.18)",border:"2px solid rgba(201,168,76,0.7)",boxShadow:"0 4px 16px rgba(201,168,76,0.25)"}
        :{background:"rgba(128,128,128,0.1)",border:"2px solid rgba(128,128,128,0.2)"}}
      animate={checked?{scale:[1,1.18,0.94,1]}:{scale:1}}
      transition={{duration:0.35,ease:"easeOut"}}
      aria-label={`${fullName} ${checked?"completed":"not completed"}`}>
      <span className="text-lg">
        {checked
          ?<Check className="w-5 h-5" style={{color:"#C9A84C"}}/>
          :<span className="inline-block w-5 h-5 rounded-full border-2 border-current opacity-30"/>}
      </span>
      <span className={`text-[11px] font-bold uppercase tracking-wide ${checked?"":"text-muted-foreground"}`}
        style={checked?{color:"#C9A84C"}:undefined}>{name}</span>
      <span className={`text-[9px] ${checked?"font-semibold":"opacity-40 text-muted-foreground"}`}
        style={checked?{color:"#C9A84C"}:undefined}>{checked?"✓":fullName}</span>
    </motion.button>
  );
}

function ActivityCard({icon,name,checked,onToggle,color,submitted=false}:{icon:React.ReactNode;name:string;checked:boolean;onToggle:()=>void;color:string;submitted?:boolean}) {
  const [magic,setMagic]=useState(false);
  const handleClick=()=>{ onToggle(); if(!checked){ setMagic(true); setTimeout(()=>setMagic(false),2000); } };
  return (
    <motion.button onClick={handleClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all"
      style={magic
        ?{background:`${color}30`,border:`2px solid ${color}`,boxShadow:`0 0 28px ${color}60, 0 0 8px ${color}80`}
        :checked
          ?{background:`${color}18`,border:`2px solid ${color}90`,boxShadow:`0 4px 20px ${color}30`}
          :{background:"rgba(128,128,128,0.08)",border:"2px solid rgba(128,128,128,0.18)"}}
      animate={checked?{scale:[1,1.15,0.96,1]}:{scale:1}}
      transition={{duration:0.35,ease:"easeOut"}}
      whileTap={{scale:0.94}}>
      <motion.div
        animate={magic?{scale:[1,1.5,1.2,1],rotate:[0,-15,15,-8,0]}:checked?{rotate:[0,-10,10,0],scale:[1,1.35,1]}:{}}
        transition={{duration:magic?0.6:0.4}}
        style={{color:checked?color:"rgba(128,128,128,0.5)"}}>
        {icon}
      </motion.div>
      <span className="text-xs font-bold" style={{color:checked?color:"rgba(128,128,128,0.6)"}}>{name}</span>
      <span className="text-[10px] font-semibold" style={{color:checked?color:"rgba(128,128,128,0.4)"}}>{checked?(submitted?"✓ Submitted":"✓ Done"):"Tap to mark"}</span>
    </motion.button>
  );
}

function CustomCard({name,checked,onToggle,submitted=false}:{name:string;checked:boolean;onToggle:()=>void;submitted?:boolean}) {
  const color="#a855f7";
  const { icon } = getActivityMeta(name);
  const [magic,setMagic]=useState(false);
  const handleClick=()=>{ onToggle(); if(!checked){ setMagic(true); setTimeout(()=>setMagic(false),2000); } };
  return (
    <motion.button onClick={handleClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all"
      style={magic
        ?{background:`${color}30`,border:`2px solid ${color}`,boxShadow:`0 0 28px ${color}60`}
        :checked
          ?{background:`${color}18`,border:`2px solid ${color}90`,boxShadow:`0 4px 20px ${color}30`}
          :{background:"rgba(128,128,128,0.08)",border:"2px solid rgba(128,128,128,0.18)"}}
      animate={checked?{scale:[1,1.15,0.96,1]}:{scale:1}}
      transition={{duration:0.35,ease:"easeOut"}}
      whileTap={{scale:0.94}}>
      <motion.span className="text-2xl"
        animate={magic?{scale:[1,1.5,1.2,1],rotate:[0,-15,15,0]}:checked?{scale:[1,1.4,1],rotate:[0,-15,15,0]}:{}}
        transition={{duration:magic?0.6:0.4}}
        style={{filter:checked?"none":"grayscale(1) opacity(0.4)"}}>
        {icon}
      </motion.span>
      <span className="text-xs font-bold text-center leading-tight" style={{color:checked?color:"rgba(128,128,128,0.6)"}}>{name}</span>
      <span className="text-[10px] font-semibold" style={{color:checked?color:"rgba(128,128,128,0.4)"}}>{checked?(submitted?"✓ Submitted":"✓ Done"):"Tap to mark"}</span>
    </motion.button>
  );
}

// ─── Submit Success Overlay ───────────────────────────────
function SubmitSuccess({onClose}:{onClose:()=>void}) {
  
  useEffect(()=>{const t=setTimeout(onClose,3500);return()=>clearTimeout(t);},[onClose]);
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center pb-12 px-5"
      style={{background:"rgba(0,0,0,0.5)",backdropFilter:"blur(4px)"}}
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
      <motion.div className="w-full max-w-sm rounded-2xl p-6 flex flex-col items-center gap-4"
        style={{background:"rgba(10,18,35,0.98)",border:"1px solid rgba(16,185,129,0.4)",boxShadow:"0 0 40px rgba(16,185,129,0.2)"}}
        initial={false?{opacity:0}:{y:80,opacity:0}}
        animate={false?{opacity:1}:{y:0,opacity:1}}
        exit={false?{opacity:0}:{y:80,opacity:0}}
        transition={{type:"spring",stiffness:300,damping:25}}>
        <motion.div className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.4)"}}
          initial={false?{}:{scale:0}} animate={{scale:1}} transition={{type:"spring",stiffness:400,damping:15}}>
          <Check className="w-8 h-8 text-emerald" strokeWidth={3}/>
        </motion.div>
        <div className="text-center">
          <p className="text-lg font-bold text-white">Report Submitted!</p>
          <p className="text-sm text-muted-foreground mt-1">Your teacher can now see today&apos;s complete report.</p>
          <p className="text-xs text-emerald mt-2 font-medium">✓ Saved &amp; visible to teacher in real time</p>
        </div>
        <motion.button onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-muted-foreground"
          style={{border:"1px solid rgba(255,255,255,0.1)"}}
          whileTap={{scale:0.97}}>
          Close
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ─── Recitation report (read-only) ────────────────────────
function RecStat({label,value,sub,accent}:{label:string;value:string;sub?:string;accent?:string}) {
  return (
    <div className="glass-card rounded-2xl p-3 flex flex-col">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`mt-1 text-2xl font-extrabold ${accent??"text-foreground"}`}>{value}</span>
      {sub&&<span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function RecitationReport({sessions,loading,tableMissing}:{sessions:RecitationSession[];loading:boolean;tableMissing:boolean}) {
  const ordered = useMemo(()=>[...sessions].sort((a,b)=>a.date.localeCompare(b.date)),[sessions]);
  const weekly  = useMemo(()=>toWeeklySeries(ordered),[ordered]);
  const trend   = useMemo(()=>weeklyTrend(weekly),[weekly]);
  const avg     = averageTotal(ordered);
  const best    = ordered.reduce((m,s)=>Math.max(m,s.total),0);
  const latest  = ordered.length?ordered[ordered.length-1]:null;

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-gold"/></div>;
  }
  if (tableMissing || ordered.length===0) {
    return (
      <div className="glass-card rounded-[20px] p-8 flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{background:"rgba(201,168,76,0.1)"}}>
          <BookOpenCheck className="w-7 h-7 text-gold/70"/>
        </div>
        <p className="text-sm font-semibold text-foreground">No recitation sessions yet</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your child&apos;s weekly Quran recitation progress and the teacher&apos;s coaching notes will appear here after the first one-on-one assessment.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-2.5">
        <RecStat label="Latest" value={latest?String(latest.total):"—"} sub={`/ ${RECITATION_MAX}`} accent={latest?recitationBand(latest.total).color:undefined}/>
        <RecStat label="Average" value={String(avg)} sub={`/ ${RECITATION_MAX} · ${recitationBand(avg).label}`}/>
        <RecStat label="Best" value={String(best)} sub={`/ ${RECITATION_MAX}`}/>
        <RecStat
          label="This week"
          value={trend.delta===null?"New":`${trend.delta>0?"+":""}${trend.delta}`}
          sub={trend.delta===null?"first week":"vs last week"}
          accent={trend.delta===null?undefined:trend.delta>0?"text-emerald":trend.delta<0?"text-rose":"text-muted-foreground"}
        />
      </div>

      {/* Weekly trend bars */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Weekly Progress</span>
          <span className="flex items-center gap-1 text-[11px] font-semibold">
            {trend.direction==="up"&&<TrendingUp className="w-3.5 h-3.5 text-emerald"/>}
            {trend.direction==="down"&&<TrendingDown className="w-3.5 h-3.5 text-rose"/>}
            {trend.direction==="flat"&&<Minus className="w-3.5 h-3.5 text-muted-foreground"/>}
            <span className="text-muted-foreground">avg / {RECITATION_MAX}</span>
          </span>
        </div>
        <div className={`flex items-end gap-2.5 overflow-x-auto pb-1 ${weekly.length<=3?"justify-center":""}`} style={{minHeight:112}}>
          {weekly.map((p)=>{
            const pct = RECITATION_MAX>0?Math.min(100,(p.avgTotal/RECITATION_MAX)*100):0;
            return (
              <div key={p.weekKey} className="flex flex-col items-center gap-1.5 flex-1 min-w-[44px] max-w-[72px]">
                <span className="text-xs font-bold text-gold">{p.avgTotal}</span>
                <div className="w-full rounded-t-lg bg-foreground/[0.06] flex items-end" style={{height:76}}>
                  <motion.div className="w-full rounded-t-lg" style={{background:"linear-gradient(180deg,#C9A84C,#10b981)"}}
                    initial={{height:0}} animate={{height:`${pct}%`}} transition={spring}/>
                </div>
                <span className="text-[10px] text-muted-foreground">W{p.weekKey.split("-W")[1]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Session history */}
      <div className="flex flex-col gap-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Session History</span>
        {[...ordered].reverse().map((s)=>{
          const band = recitationBand(s.total);
          return (
            <div key={s.id} className="glass-card rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{fmtRecDate(s.date)}</span>
                <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold ${band.bg} ${band.color}`}>{s.total}/{RECITATION_MAX} · {band.letter}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {RECITATION_CRITERIA.map((c)=>(
                  <div key={c.key} className="flex items-center justify-between rounded-xl bg-foreground/[0.04] border border-foreground/10 px-3 py-2">
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {REC_SHORT[c.key]}
                      <bdi dir="rtl" className="block font-['Amiri'] text-[0.95em] opacity-75">{c.labelAr}</bdi>
                    </span>
                    <span className="text-sm font-bold text-foreground whitespace-nowrap">{s[c.key]}<span className="text-[10px] font-normal text-muted-foreground">/{c.max}</span></span>
                  </div>
                ))}
              </div>
              {s.notes&&(
                <div className="text-xs leading-relaxed text-foreground/80 rounded-xl p-3 bg-foreground/[0.04] border border-foreground/10">
                  <span className="text-gold font-semibold">Coach&apos;s note: </span>{s.notes}
                </div>
              )}
              {s.assessedBy&&<span className="text-[11px] text-muted-foreground">Coached by {s.assessedBy}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────
type Step="course"|"class"|"roll"|"confirm"|"portfolio";
type PortfolioTab="activity"|"recitation"|"notes";

export default function StudentPortal() {
  

  // Onboarding
  const [step,          setStep]          = useState<Step>("roll");
  const [direction,     setDirection]     = useState(1);
  const [courseId,      setCourseId]      = useState("");
  const [classId,       setClassId]       = useState("");
  const [rollInput,     setRollInput]     = useState("");
  const [confirmedRoll, setConfirmedRoll] = useState("");
  const [studentName,   setStudentName]   = useState("");
  const [rollError,     setRollError]     = useState("");
  const [rollChecking,  setRollChecking]  = useState(false);
  // Real class display name (handles DB-created classes not in ALL_CLASSES).
  const [resolvedGrade, setResolvedGrade] = useState("");

  // Portfolio
  const [weekOffset,     setWeekOffset]     = useState(0);
  const [selectedDay,    setSelectedDay]    = useState<DayKey>(todayDayKey());
  const [weekReports,    setWeekReports]    = useState<Record<string,SelfReport>>({});
  const [customWeekData, setCustomWeekData] = useState<Record<string,CustomData>>({});
  const [submittedDays,  setSubmittedDays]  = useState<Record<string,boolean>>({});
  const [classActivities,setClassActivities]= useState<string[]>([]);
  const [hiddenDefaults, setHiddenDefaults] = useState<string[]>([]);
  const [autoSaving,     setAutoSaving]     = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  const [showSuccess,    setShowSuccess]    = useState(false);
  const [avatarUrl,      setAvatarUrl]      = useState("");
  const [avatarUploading,setAvatarUploading]= useState(false);
  // Optional per-student PIN (audit H3) — empty until the server says one is required.
  const [pin,            setPin]            = useState("");
  const [pinRequired,    setPinRequired]    = useState(false);
  const [pinInput,       setPinInput]       = useState("");
  const [pinError,       setPinError]       = useState("");

  // Quran recitation (read-only report tab)
  const [portfolioTab,   setPortfolioTab]   = useState<PortfolioTab>("activity");
  const [recSessions,    setRecSessions]    = useState<RecitationSession[]>([]);
  const [recLoading,     setRecLoading]     = useState(false);
  const [recTableMissing,setRecTableMissing]= useState(false);

  // Class Notes (read-only LMS tab) — scoped to the student's own class.
  const [classNotes,     setClassNotes]     = useState<ClassNote[]>([]);
  const [notesLoading,   setNotesLoading]   = useState(false);

  // Fall back to a synthesized class object when the id isn't in the static list
  // (DB-created classes) so the portfolio still renders for those students.
  const cls     = ALL_CLASSES.find(c=>c.id===classId)
                  ?? (classId ? { id:classId, grade:resolvedGrade||classId, courseId } : null);
  const wStart  = getWeekStart(weekOffset);
  const wKey    = weekKey(wStart);

  const todayRpt  = useMemo<SelfReport>(()=>weekReports[selectedDay]??{...EMPTY},[weekReports,selectedDay]);
  const todayCust = useMemo<CustomData>(()=>customWeekData[selectedDay]??{},[customWeekData,selectedDay]);

  const showPrayers = !hiddenDefaults.includes("prayers");
  const showQuran   = !hiddenDefaults.includes("quran");
  const showReading = !hiddenDefaults.includes("reading");
  const showWriting = !hiddenDefaults.includes("writing");

  const maxDay =
    (showPrayers?5:0)+(showQuran?1:0)+(showReading?1:0)+(showWriting?1:0)+classActivities.length;

  const dayScore =
    (showPrayers?[todayRpt.fajr,todayRpt.dhuhr,todayRpt.asr,todayRpt.maghrib,todayRpt.isha].filter(Boolean).length:0)+
    (showQuran&&todayRpt.quran?1:0)+(showReading&&todayRpt.reading?1:0)+(showWriting&&todayRpt.writing?1:0)+
    classActivities.filter(k=>todayCust[k]).length;

  const isPerfect = maxDay>0 && dayScore===maxDay;
  const isSubmitted = !!submittedDays[selectedDay];

  const weekTotal = WEEK_ORDER.reduce((sum,d)=>{
    const r=weekReports[d]??EMPTY, c=customWeekData[d]??{};
    return sum+
      (showPrayers?[r.fajr,r.dhuhr,r.asr,r.maghrib,r.isha].filter(Boolean).length:0)+
      (showQuran&&r.quran?1:0)+(showReading&&r.reading?1:0)+(showWriting&&r.writing?1:0)+
      classActivities.filter(k=>c[k]).length;
  },0);
  const maxWeek = maxDay*WEEK_ORDER.length;

  const goNext=(s:Step)=>{setDirection(1);setStep(s);};
  const goBack=(s:Step)=>{setDirection(-1);setStep(s);};

  // Restore session
  useEffect(()=>{
    const s=loadSession(); if(!s)return;
    const found=ALL_CLASSES.find(c=>c.id===s.classId);
    if(found) setCourseId(found.courseId);
    setClassId(s.classId);
    setConfirmedRoll(s.rollNo); setStudentName(s.rollNo);
    if(s.pin) setPin(s.pin);
    setSelectedDay(todayDayKey()); setStep("portfolio");
    setAvatarUrl(getAvatarPublicUrl(s.classId, s.rollNo));
    findStudentByRoll(s.rollNo).then(student=>{
      if(student){ setStudentName(student.name); setResolvedGrade(student.grade); }
    });
  },[]);

  // Load avatar when portfolio confirmed
  useEffect(()=>{
    if(!confirmedRoll||!classId||step!=="portfolio")return;
    setAvatarUrl(getAvatarPublicUrl(classId, confirmedRoll));
  },[confirmedRoll, classId, step]);

  // Load class config when portfolio opens
  useEffect(()=>{
    if(!classId||step!=="portfolio")return;
    Promise.all([fetchClassActivities(classId),fetchHiddenDefaults(classId)])
      .then(([acts,hidden])=>{setClassActivities(acts);setHiddenDefaults(hidden);});
  },[classId,step]);

  // Load reports when week/student changes; merge with sessionStorage submitted flags
  useEffect(()=>{
    if(!confirmedRoll||!classId)return;
    fetchReports(classId,confirmedRoll,wKey,pin).then((res)=>{
      if(res.pinRequired){
        setPinRequired(true);
        if(pin) setPinError("Incorrect PIN. Please try again.");  // we sent one and it was rejected
        return;
      }
      setPinRequired(false); setPinError("");
      const {reports,customs,submitted}=res;
      // Merge DB submitted state with sessionStorage (whichever says true wins)
      const merged: Record<string,boolean> = {...submitted};
      ["sat","sun","mon","tue","wed","thu","fri"].forEach(d=>{
        try{ if(sessionStorage.getItem(`sub-${classId}-${wKey}-${d}`)) merged[d]=true; }catch{}
      });
      setWeekReports(reports); setCustomWeekData(customs); setSubmittedDays(merged);
    });
  },[confirmedRoll,classId,wKey,pin]);

  // Lazy-load the recitation report when the parent opens that tab (refetched on
  // each open so a freshly-scored session shows up without a sign-out).
  useEffect(()=>{
    if(step!=="portfolio"||portfolioTab!=="recitation")return;
    if(!confirmedRoll||!classId)return;
    let cancelled=false;
    setRecLoading(true);
    fetchRecitation(classId,confirmedRoll,pin).then((res)=>{
      if(cancelled)return;
      setRecSessions(res.sessions);
      setRecTableMissing(!!res.tableMissing);
      setRecLoading(false);
    });
    return ()=>{cancelled=true;};
  },[step,portfolioTab,confirmedRoll,classId,pin]);

  // Lazy-load class notes (LMS) when the student opens that tab. Filtered by the
  // student's classId so they only ever see materials for their own class.
  useEffect(()=>{
    if(step!=="portfolio"||portfolioTab!=="notes")return;
    if(!classId)return;
    let cancelled=false;
    setNotesLoading(true);
    fetchClassNotes(classId).then((rows)=>{
      if(cancelled)return;
      setClassNotes(rows);
      setNotesLoading(false);
    });
    return ()=>{cancelled=true;};
  },[step,portfolioTab,classId]);

  // Auto-save on every toggle (silent, no spinner)
  const autoSave = useCallback(async(report:SelfReport, custom:CustomData) => {
    setAutoSaving(true);
    await upsertReport(classId,confirmedRoll,wKey,selectedDay,report,custom,false,pin);
    setAutoSaving(false);
  },[classId,confirmedRoll,wKey,selectedDay,pin]);

  const handleToggle = useCallback(async(field:keyof SelfReport)=>{
    const updated:SelfReport={...todayRpt,[field]:!todayRpt[field]};
    setWeekReports(prev=>({...prev,[selectedDay]:updated}));
    // If already submitted, revert to "Submit" so student can re-confirm new marks
    setSubmittedDays(prev=>prev[selectedDay]?{...prev,[selectedDay]:false}:prev);
    autoSave(updated,todayCust);
  },[todayRpt,todayCust,selectedDay,autoSave]);

  const handleCustomToggle = useCallback(async(key:string)=>{
    const updated:CustomData={...todayCust,[key]:!todayCust[key]};
    setCustomWeekData(prev=>({...prev,[selectedDay]:updated}));
    setSubmittedDays(prev=>prev[selectedDay]?{...prev,[selectedDay]:false}:prev);
    autoSave(todayRpt,updated);
  },[todayRpt,todayCust,selectedDay,autoSave]);

  // Explicit Submit — only mark done if the DB save actually succeeded,
  // otherwise the "Submitted" badge survives a refresh but the marks vanish.
  const handleSubmit = useCallback(async()=>{
    if(submitting)return;
    setSubmitting(true);
    const ok=await upsertReport(classId,confirmedRoll,wKey,selectedDay,todayRpt,todayCust,true,pin);
    setSubmitting(false);
    if(ok){
      setSubmittedDays(prev=>({...prev,[selectedDay]:true}));
      try{ sessionStorage.setItem(`sub-${classId}-${wKey}-${selectedDay}`,"1"); }catch{}
      setShowSuccess(true);
    } else {
      alert("Couldn't save your report — check your connection and try again.");
    }
  },[submitting,classId,confirmedRoll,wKey,selectedDay,todayRpt,todayCust,pin]);

  // Submit the entered PIN — re-triggers the load effect (pin is a dependency).
  const handlePinSubmit = useCallback(()=>{
    const entered = pinInput.trim();
    if(!entered) return;
    setPinError("");
    setPin(entered);
    saveSession({ classId, rollNo: confirmedRoll, pin: entered });
  },[pinInput,classId,confirmedRoll]);

  // Roll number validation — class is inferred from the DB record
  const handleConfirmRoll = useCallback(async()=>{
    if(!rollInput.trim())return;
    setRollError("");
    setRollChecking(true);
    const student=await findStudentByRoll(rollInput.trim());
    setRollChecking(false);
    if(!student){
      setRollError("Register number not found. Check your number or ask your teacher.");
      return;
    }
    setClassId(student.classId);
    const found=ALL_CLASSES.find(c=>c.id===student.classId);
    if(found) setCourseId(found.courseId);
    setResolvedGrade(student.grade);
    setConfirmedRoll(student.id);
    setStudentName(student.name);
    goNext("confirm");
  },[rollInput]);

  const handleAvatarPick = useCallback(async(e: React.ChangeEvent<HTMLInputElement>)=>{
    const file = e.target.files?.[0]; if(!file) return;
    e.target.value = "";
    setAvatarUploading(true);
    const url = await uploadAvatar(classId, confirmedRoll, file);
    setAvatarUploading(false);
    if(url) setAvatarUrl(url + "?t=" + Date.now()); // cache-bust
  },[classId, confirmedRoll]);

  const handleSignOut=()=>{
    clearSession();
    setStep("roll");setCourseId("");setClassId("");
    setRollInput("");setConfirmedRoll("");setStudentName("");setRollError("");setResolvedGrade("");
    setWeekReports({});setCustomWeekData({});setClassActivities([]);
    setHiddenDefaults([]);setSubmittedDays({});setAvatarUrl("");
    setPin("");setPinRequired(false);setPinInput("");setPinError("");
    setPortfolioTab("activity");setRecSessions([]);setRecTableMissing(false);
    setClassNotes([]);setNotesLoading(false);
  };

  const { theme, setTheme } = useTheme();

  return (
    <div className="relative min-h-screen flex flex-col items-center bg-background">
      <MiniStarField/>

      {/* Submit Success Overlay */}
      <AnimatePresence>
        {showSuccess&&<SubmitSuccess onClose={()=>setShowSuccess(false)}/>}
      </AnimatePresence>

      {/* PIN gate — shown only when this student's account is PIN-protected */}
      <AnimatePresence>
        {step==="portfolio"&&pinRequired&&(
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-5"
            style={{background:"rgba(0,0,0,0.55)",backdropFilter:"blur(4px)"}}
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
            <motion.div className="w-full max-w-sm rounded-2xl p-6 flex flex-col items-center gap-4 bg-card"
              style={{border:"1px solid rgba(201,168,76,0.4)",boxShadow:"0 0 40px rgba(201,168,76,0.15)"}}
              initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
              transition={{type:"spring",stiffness:300,damping:25}}>
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{background:"rgba(201,168,76,0.12)"}}>
                <User className="w-7 h-7 text-gold"/>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-foreground">Enter your PIN</p>
                <p className="text-xs text-muted-foreground mt-1">{studentName}{cls?` · ${cls.grade}`:""}</p>
              </div>
              <input
                type="password" inputMode="numeric" autoFocus value={pinInput}
                onChange={e=>{setPinInput(e.target.value);setPinError("");}}
                onKeyDown={e=>e.key==="Enter"&&handlePinSubmit()}
                placeholder="••••"
                className="w-full text-center text-2xl font-bold tracking-[8px] py-3 rounded-2xl bg-foreground/[0.04] text-foreground focus:outline-none"
                style={{border:`1.5px solid ${pinError?"rgba(244,63,94,0.5)":"rgba(201,168,76,0.3)"}`,caretColor:"#C9A84C"}}
              />
              {pinError&&<p className="text-xs text-rose text-center">{pinError}</p>}
              <button onClick={handlePinSubmit} disabled={!pinInput.trim()}
                className="w-full py-3 rounded-full bg-gold text-[#050d1a] font-bold text-sm disabled:opacity-40">
                Unlock
              </button>
              <button onClick={handleSignOut} className="text-xs text-muted-foreground hover:text-foreground">
                Not you? Sign out
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 w-full max-w-[420px] px-5 py-8 flex flex-col items-center">

        {/* Theme toggle */}
        <div className="absolute top-4 right-5">
          <button onClick={()=>setTheme(theme==="dark"?"light":"dark")}
            className="p-2 rounded-full glass-card text-muted-foreground hover:text-foreground transition-colors">
            {theme==="dark"?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}
          </button>
        </div>

        {/* Header */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={100} height={28} className="h-10 w-auto"/>
          <h1 className="text-sm font-bold text-foreground tracking-[0.2em] uppercase">Ihlamudheen Madrasa Training Institution</h1>
          <p className="text-[11px] text-muted-foreground">Student Activity Tracker</p>
        </div>

        <AnimatePresence mode="wait" initial={false}>

          {/* STEP 1: Course */}
          {step==="course"&&(
            <StepWrapper key="course" direction={direction}>
              <div className="glass-card rounded-[20px] p-6" style={{borderColor:"rgba(201,168,76,0.2)"}}>
                <h2 className="text-base font-semibold text-foreground mb-1">Select Your Course</h2>
                <p className="text-xs text-muted-foreground mb-5">Choose the course you are enrolled in</p>
                <div className="flex flex-col gap-3">
                  {PORTAL_COURSES.filter(c=>ALL_CLASSES.some(cl=>cl.courseId===c.id)).map(course=>(
                    <motion.button key={course.id}
                      onClick={()=>{setCourseId(course.id);goNext("class");}}
                      className="glass-card flex items-center gap-3 p-4 rounded-2xl text-left hover:bg-white/[0.06]"
                      whileHover={{y:-3}} transition={spring} style={{borderColor:"rgba(255,255,255,0.08)"}}>
                      <span className="w-3 h-3 rounded-full shrink-0" style={{backgroundColor:course.color}}/>
                      <span className="text-sm font-medium text-foreground">{course.name}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto"/>
                    </motion.button>
                  ))}
                </div>
              </div>
            </StepWrapper>
          )}

          {/* STEP 2: Class */}
          {step==="class"&&(
            <StepWrapper key="class" direction={direction}>
              <div className="glass-card rounded-[20px] p-6" style={{borderColor:"rgba(201,168,76,0.2)"}}>
                <button onClick={()=>goBack("course")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
                  <ChevronLeft className="w-3.5 h-3.5"/> Back
                </button>
                <h2 className="text-base font-semibold text-foreground mb-1">Select Your Class</h2>
                <p className="text-xs text-muted-foreground mb-5">Choose your grade</p>
                <div className="grid grid-cols-2 gap-3">
                  {ALL_CLASSES.filter(c=>c.courseId===courseId).map(cls=>(
                    <motion.button key={cls.id}
                      onClick={()=>{setClassId(cls.id);setRollInput("");setRollError("");goNext("roll");}}
                      className="glass-card rounded-2xl p-4 flex flex-col items-center gap-1 text-center hover:bg-white/[0.06]"
                      whileHover={{scale:1.03}} whileTap={{scale:0.97}} transition={spring}>
                      <span className="text-sm font-semibold text-foreground">{cls.grade}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </StepWrapper>
          )}

          {/* STEP 3: Roll Number (now the first/only login step) */}
          {step==="roll"&&(
            <StepWrapper key="roll" direction={direction}>
              <div className="stitch-border rounded-[20px]" style={{padding:"2px"}}>
              <div className="glass-card rounded-[20px] p-6 flex flex-col items-center" style={{border:"none",background:"var(--background)"}}>
                <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
                  style={{background:"rgba(201,168,76,0.1)",boxShadow:"0 0 30px rgba(201,168,76,0.15)"}}>
                  <User className="w-9 h-9 text-gold"/>
                </div>
                <h2 className="text-xl font-bold text-foreground mb-1">Sign In</h2>
                <p className="text-xs text-muted-foreground mb-6">Enter Your Roll Number</p>

                <input
                  type="number" inputMode="numeric" value={rollInput}
                  onChange={e=>{setRollInput(e.target.value);setRollError("");}}
                  onKeyDown={e=>e.key==="Enter"&&handleConfirmRoll()}
                  placeholder="e.g. 306" autoFocus
                  className="w-full text-center text-3xl font-bold tracking-[8px] py-4 rounded-2xl bg-foreground/[0.04] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                  style={{border:`1.5px solid ${rollError?"rgba(244,63,94,0.5)":"rgba(201,168,76,0.3)"}`,caretColor:"#C9A84C"}}
                />
                {rollError&&(
                  <motion.p initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}}
                    className="text-xs text-rose mt-3 text-center leading-relaxed">
                    {rollError}
                  </motion.p>
                )}
                <motion.button onClick={handleConfirmRoll}
                  disabled={!rollInput.trim()||rollChecking}
                  className="w-full mt-6 py-3.5 rounded-full bg-gold text-[#050d1a] font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  whileHover={rollInput&&!rollChecking?{scale:1.02}:{}}
                  whileTap={rollInput&&!rollChecking?{scale:0.98}:{}}
                  style={rollInput&&!rollChecking?{boxShadow:"0 0 20px rgba(201,168,76,0.3)"}:{}}>
                  {rollChecking&&<Loader2 className="w-4 h-4 animate-spin"/>}
                  {rollChecking?"Checking…":"Sign In →"}
                </motion.button>
              </div>
              </div>
            </StepWrapper>
          )}

          {/* STEP 4: Confirm */}
          {step==="confirm"&&(
            <StepWrapper key="confirm" direction={direction}>
              <div className="glass-card rounded-[20px] p-6 flex flex-col items-center" style={{borderColor:"rgba(201,168,76,0.2)"}}>
                <svg className="w-20 h-20 mb-4" viewBox="0 0 80 80" fill="none" aria-hidden="true">
                  <circle cx="40" cy="40" r="36" stroke="#10b981" strokeWidth="3" strokeDasharray="226" strokeDashoffset="0" strokeLinecap="round" style={{animation:"draw-check 0.8s ease-out forwards"}}/>
                  <path d="M24 42l10 10 22-24" stroke="#10b981" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset="0" style={{animation:"draw-check 0.6s ease-out 0.4s forwards"}}/>
                </svg>
                <h2 className="text-xl font-bold text-gold mb-1">{studentName}</h2>
                <p className="text-xs text-muted-foreground mb-6">{cls?.grade} · Reg No {confirmedRoll}</p>
                <div className="flex gap-3 w-full">
                  <motion.button
                    onClick={()=>{saveSession({classId,rollNo:confirmedRoll,pin});setSelectedDay(todayDayKey());goNext("portfolio");}}
                    className="flex-1 py-3 rounded-full bg-emerald text-white font-semibold text-sm"
                    whileHover={{scale:1.02}} whileTap={{scale:0.97}}>
                    Yes, that&apos;s me! ✓
                  </motion.button>
                  <motion.button onClick={()=>{setRollInput("");setRollError("");goBack("roll");}}
                    className="flex-1 py-3 rounded-full glass-card text-foreground font-semibold text-sm"
                    whileHover={{scale:1.02}} whileTap={{scale:0.97}}>
                    Not Me
                  </motion.button>
                </div>
              </div>
            </StepWrapper>
          )}

          {/* STEP 5: Portfolio */}
          {step==="portfolio"&&cls&&(
            <motion.div key="portfolio" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={spring}
              className="w-full flex flex-col gap-5">

              {/* Student header */}
              <div className="glass-card rounded-2xl p-4 flex items-center gap-3" style={{borderColor:"rgba(201,168,76,0.2)"}}>
                {/* Clickable avatar */}
                <label className="relative cursor-pointer shrink-0 group">
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarPick}/>
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-gold/40 bg-muted flex items-center justify-center">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt={studentName} className="w-full h-full object-cover"
                        onError={()=>setAvatarUrl("")}/>
                    ) : (
                      <User className="w-6 h-6 text-gold/60"/>
                    )}
                    {avatarUploading && (
                      <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-white"/>
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-[9px] text-white font-semibold text-center leading-tight px-1">TAP<br/>EDIT</span>
                  </div>
                </label>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-gold truncate">{studentName}</h2>
                  <p className="text-[11px] text-muted-foreground">{cls.grade} · Reg No {confirmedRoll}</p>
                </div>
                <motion.button onClick={handleSignOut} className="p-2 rounded-xl hover:bg-white/[0.06] text-muted-foreground hover:text-foreground shrink-0" whileTap={{scale:0.9}} aria-label="Sign out">
                  <LogOut className="w-4 h-4"/>
                </motion.button>
              </div>

              {/* View switch: daily activity ↔ Quran recitation.
                  Sticky so parents can flip views while scrolling a long report. */}
              <div className="glass-card rounded-2xl p-1 flex gap-1 sticky top-2 z-20 backdrop-blur-md">
                <button onClick={()=>setPortfolioTab("activity")}
                  className={`flex-1 min-h-[44px] px-1 rounded-xl text-[12px] font-bold leading-tight transition-all ${portfolioTab==="activity"?"bg-gold text-[#050d1a]":"text-muted-foreground hover:text-foreground"}`}>
                  Daily Activity
                </button>
                <button onClick={()=>setPortfolioTab("recitation")}
                  className={`flex-1 min-h-[44px] px-1 rounded-xl text-[12px] font-bold leading-tight transition-all ${portfolioTab==="recitation"?"bg-gold text-[#050d1a]":"text-muted-foreground hover:text-foreground"}`}>
                  Recitation
                </button>
                <button onClick={()=>setPortfolioTab("notes")}
                  className={`flex-1 min-h-[44px] px-1 rounded-xl text-[12px] font-bold leading-tight transition-all ${portfolioTab==="notes"?"bg-gold text-[#050d1a]":"text-muted-foreground hover:text-foreground"}`}>
                  Class Notes
                </button>
              </div>

              {portfolioTab==="activity"&&(<>

              {/* Week Navigator */}
              <div className="glass-card rounded-2xl px-4 py-3 flex items-center justify-between">
                <motion.button whileTap={{scale:0.9}} onClick={()=>setWeekOffset(w=>w-1)} className="p-1 text-muted-foreground">
                  <ChevronLeft className="w-4 h-4"/>
                </motion.button>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">
                    {weekOffset===0?"This Week":weekOffset===-1?"Last Week":`${Math.abs(weekOffset)} weeks ago`}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{weekLabel(wStart)}</p>
                </div>
                <motion.button whileTap={{scale:0.9}} onClick={()=>setWeekOffset(w=>Math.min(0,w+1))}
                  className={`p-1 ${weekOffset>=0?"opacity-20 cursor-not-allowed":"text-muted-foreground"}`} disabled={weekOffset>=0}>
                  <ChevronRight className="w-4 h-4"/>
                </motion.button>
              </div>

              {/* Weekly Progress */}
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Weekly Progress</span>
                  <span className="text-sm font-bold text-gold">{weekTotal} / {maxWeek} pts</span>
                </div>
                <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{background:"linear-gradient(90deg,#C9A84C,#10b981)"}}
                    initial={{width:0}} animate={{width:`${maxWeek>0?Math.min(100,(weekTotal/maxWeek)*100):0}%`}} transition={spring}/>
                </div>
                {/* Day pills */}
                <div className="flex items-center gap-1.5 mt-1">
                  {WEEK_ORDER.map(d=>{
                    const r=weekReports[d]??EMPTY, c=customWeekData[d]??{};
                    const ds=
                      (showPrayers?[r.fajr,r.dhuhr,r.asr,r.maghrib,r.isha].filter(Boolean).length:0)+
                      (showQuran&&r.quran?1:0)+(showReading&&r.reading?1:0)+(showWriting&&r.writing?1:0)+
                      classActivities.filter(k=>c[k]).length;
                    const perfect=maxDay>0&&ds===maxDay;
                    const partial=ds>0&&!perfect;
                    const submitted=!!submittedDays[d];
                    return (
                      <motion.button key={d} onClick={()=>setSelectedDay(d)}
                        className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all ${selectedDay===d?"text-gold":"text-muted-foreground"}`}
                        style={selectedDay===d?{border:"1px solid rgba(201,168,76,0.3)",background:"rgba(201,168,76,0.08)"}
                          :submitted?{border:"1px solid rgba(16,185,129,0.35)",background:"rgba(16,185,129,0.06)"}
                          :perfect?{border:"1px solid rgba(16,185,129,0.2)"}
                          :partial?{border:"1px solid rgba(245,158,11,0.15)"}
                          :{border:"1px solid rgba(255,255,255,0.04)"}}
                        whileTap={{scale:0.95}}>
                        <span>{DAY_SHORT[d]}</span>
                        <span className={submitted?"text-emerald":perfect?"text-emerald":partial?"text-amber":"text-white/20"}>
                          {submitted?"✓":ds>0?ds:"·"}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Auto-save indicator */}
              <AnimatePresence>
                {autoSaving&&(
                  <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                    className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <Loader2 className="w-2.5 h-2.5 animate-spin"/> Saving…
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Daily Activity Card */}
              <div className="glass-card rounded-[20px] p-5 flex flex-col gap-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{DAY_LABEL[selectedDay]}</span>
                  <div className="flex items-center gap-2">
                    {isSubmitted&&(
                      <span className="flex items-center gap-1 text-[10px] text-emerald font-semibold px-2 py-0.5 rounded-full bg-emerald-dim" style={{border:"1px solid rgba(16,185,129,0.3)"}}>
                        <Check className="w-2.5 h-2.5"/> Submitted
                      </span>
                    )}
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      isPerfect?"bg-emerald-dim text-emerald shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                      :dayScore>=Math.ceil(maxDay*0.6)?"bg-amber-dim text-amber"
                      :dayScore>0?"bg-blue-dim text-blue"
                      :"bg-white/[0.04] text-muted-foreground"}`}>
                      {dayScore}/{maxDay}
                    </span>
                  </div>
                </div>

                {/* Prayers */}
                {showPrayers&&(
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                      🕌 Prayers — {PRAYERS.filter(p=>todayRpt[p]).length}/5
                    </p>
                    <div className="grid grid-cols-5 gap-2">
                      {PRAYERS.map((p,i)=>(
                        <PrayerButton key={p} name={PRAYER_SHORT[i]} fullName={PRAYER_FULL[i]}
                          checked={todayRpt[p]} onToggle={()=>handleToggle(p)}/>
                      ))}
                    </div>
                  </div>
                )}

                {/* Standard Activities */}
                {(showQuran||showReading||showWriting)&&(
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Activities</p>
                    <div className={`grid gap-3 ${[showQuran,showReading,showWriting].filter(Boolean).length===1?"grid-cols-1":[showQuran,showReading,showWriting].filter(Boolean).length===2?"grid-cols-2":"grid-cols-3"}`}>
                      {showQuran  &&<ActivityCard icon={<BookOpenCheck className="w-7 h-7"/>} name="Quran"   checked={todayRpt.quran}   onToggle={()=>handleToggle("quran")}   color="#14b8a6" submitted={isSubmitted}/>}
                      {showReading&&<ActivityCard icon={<BookOpen      className="w-7 h-7"/>} name="Reading" checked={todayRpt.reading} onToggle={()=>handleToggle("reading")} color="#10b981" submitted={isSubmitted}/>}
                      {showWriting&&<ActivityCard icon={<PenLine       className="w-7 h-7"/>} name="Writing" checked={todayRpt.writing} onToggle={()=>handleToggle("writing")} color="#3b82f6" submitted={isSubmitted}/>}
                    </div>
                  </div>
                )}

                {/* Custom Activities */}
                {classActivities.length>0&&(
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                      {(()=>{
                        const seen: Record<string,boolean>={}; const types=classActivities.map(a=>getActivityMeta(a).label).filter(l=>seen[l]?false:(seen[l]=true));
                        const icon=getActivityMeta(classActivities[0]).icon;
                        return `${icon} ${types.length===1?types[0]+" Activities":"Extra Activities"}`;
                      })()}
                    </p>
                    <div className={`grid gap-3 ${classActivities.length===1?"grid-cols-1":classActivities.length===2?"grid-cols-2":"grid-cols-3"}`}>
                      {classActivities.map(act=>(
                        <CustomCard key={act} name={act} checked={!!todayCust[act]} onToggle={()=>handleCustomToggle(act)} submitted={isSubmitted}/>
                      ))}
                    </div>
                  </div>
                )}

                {/* Perfect day banner */}
                <AnimatePresence>
                  {isPerfect&&(
                    <motion.div initial={{opacity:0,scale:0.8}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:0.8}} transition={spring}
                      className="relative rounded-2xl p-3 flex items-center justify-center gap-2 overflow-hidden"
                      style={{background:"linear-gradient(135deg,rgba(201,168,76,0.1),rgba(16,185,129,0.1))",border:"1px solid rgba(201,168,76,0.2)"}}>
                      <span className="text-xl">⭐</span>
                      <span className="shimmer-text text-sm font-bold">Perfect day! Keep it up!</span>
                      <span className="text-xl">⭐</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── SUBMIT BUTTON ── */}
                <motion.button
                  onClick={handleSubmit}
                  disabled={submitting||dayScore===0}
                  className="w-full py-4 rounded-2xl flex items-center justify-center gap-2.5 font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={isSubmitted
                    ? {background:"linear-gradient(135deg,rgba(16,185,129,0.85),rgba(5,150,105,0.9))",color:"#fff",boxShadow:"0 0 24px rgba(16,185,129,0.35)"}
                    : dayScore>0
                      ? {background:"linear-gradient(135deg,rgba(201,168,76,0.9),rgba(16,185,129,0.8))",color:"#050d1a",boxShadow:"0 0 24px rgba(201,168,76,0.3)"}
                      : {background:"rgba(128,128,128,0.12)",border:"1px solid rgba(128,128,128,0.2)",color:"rgba(128,128,128,0.5)"}
                  }
                  whileHover={dayScore>0&&!submitting?{scale:1.02}:{}}
                  whileTap={dayScore>0&&!submitting?{scale:0.97}:{}}>
                  {submitting?(
                    <><Loader2 className="w-4 h-4 animate-spin"/> Submitting…</>
                  ):isSubmitted?(
                    <><Check className="w-4 h-4" strokeWidth={3}/> Submitted</>
                  ):(
                    <><Send className="w-4 h-4"/> Submit</>
                  )}
                </motion.button>

                {/* Helper text under submit */}
                <p className="text-center text-[10px] text-muted-foreground -mt-3">
                  {isSubmitted
                    ? "✓ Your teacher can see today's complete report"
                    : dayScore>0
                      ? "Tap Submit when you're done — your teacher will be able to see it"
                      : "Mark at least one activity above to submit your report"
                  }
                </p>
              </div>
              </>)}

              {portfolioTab==="recitation"&&(
                <RecitationReport sessions={recSessions} loading={recLoading} tableMissing={recTableMissing}/>
              )}

              {portfolioTab==="notes"&&(
                <ClassNotesReport notes={classNotes} loading={notesLoading} grade={cls.grade}/>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
