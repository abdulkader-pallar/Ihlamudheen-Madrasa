"use client";

import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  motion, AnimatePresence,
  useMotionValue, useSpring, useTransform, useReducedMotion,
} from "framer-motion";
import {
  ChevronLeft, ChevronRight, Activity, Copy, Check,
  BookOpen, PenLine, Sparkles, Pencil, X, Plus, RotateCcw,
  AlertTriangle, Download, Eye, EyeOff, Users,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getAvatarPublicUrl } from "@/components/StudentPortal";

// ─── Smart activity type detection ────────────────────────
export function getActivityMeta(name: string): { icon: string; label: string } {
  const n = name.toLowerCase();
  if (/read|book|story|قراءة/.test(n))           return { icon: "📚", label: "Reading" };
  if (/writ|essay|كتاب/.test(n))                  return { icon: "✏️",  label: "Writing" };
  if (/quran|قرآن|tilawa|recit|قران/.test(n))     return { icon: "📖", label: "Quran" };
  if (/hadith|حديث/.test(n))                      return { icon: "📜", label: "Hadith" };
  if (/arabic|عرب|لغة/.test(n))                   return { icon: "🔤", label: "Arabic" };
  if (/math|حساب|number/.test(n))                 return { icon: "🔢", label: "Maths" };
  if (/pray|صلاة/.test(n))                         return { icon: "🕌", label: "Prayer" };
  if (/sport|exercise|gym/.test(n))               return { icon: "🏃", label: "Sports" };
  if (/dua|دعاء/.test(n))                          return { icon: "🤲", label: "Dua" };
  if (/memoris|hifz|حفظ/.test(n))                 return { icon: "🧠", label: "Memorisation" };
  if (/homework|واجب/.test(n))                     return { icon: "📝", label: "Homework" };
  if (/science|علوم/.test(n))                      return { icon: "🔬", label: "Science" };
  return { icon: "⭐", label: "Activity" };
}

// ─── Types ───────────────────────────────────────────────
interface Student {
  id: string; name: string; rollNumber: string; selfReported: boolean;
  prayers: boolean[]; quran: boolean; reading: boolean; writing: boolean;
  custom: Record<string, boolean>;
}
interface GradeData  { grade: string; classId: string; }
interface ProgramData{ name: string; grades: GradeData[]; }

type DefaultKey = "prayers" | "quran" | "reading" | "writing";
const ALL_DEFAULTS: DefaultKey[] = ["prayers","quran","reading","writing"];
const DEFAULT_LABELS: Record<DefaultKey,string> = {
  prayers:"🕌 Prayers", quran:"📖 Quran", reading:"📚 Reading", writing:"✏️ Writing",
};

// ─── Course → program name mapping (course_id comes from classes table) ──────
const COURSE_META: Record<string, { name: string; order: number }> = {
  "1": { name: "Ihlamudheen Madrasa",  order: 0 },
  "2": { name: "English Madrasa", order: 1 },
  "4": { name: "Edu Support",    order: 2 },
};

// Hardcoded fallback so the UI is immediately usable while the DB fetch is in flight.
// The DB fetch overwrites this once it resolves (fixes Edu Support class IDs etc.)
const PROGRAMS_FALLBACK: ProgramData[] = [
  {
    name: "Ihlamudheen Madrasa",
    grades: [
      {grade:"Grade 1A",classId:"1a"},{grade:"Grade 1B",classId:"1b"},{grade:"Grade 1C",classId:"1c"},
      {grade:"Grade 2A",classId:"2a"},{grade:"Grade 2B",classId:"2b"},
      {grade:"Grade 3A",classId:"3a"},{grade:"Grade 3B",classId:"3b"},
      {grade:"Grade 4A",classId:"4a"},{grade:"Grade 5A",classId:"5a"},
      {grade:"Grade 6A",classId:"6a"},{grade:"Grade 7A",classId:"7a"},
      {grade:"Grade 8A",classId:"8a"},{grade:"Grade 9A",classId:"9a"},{grade:"Grade 10A",classId:"10a"},
    ],
  },
  {
    name: "English Madrasa",
    grades: [
      {grade:"Level 1",classId:"level1"},{grade:"Level 2",classId:"level2"},
      {grade:"Level 3",classId:"level3"},{grade:"Level 5",classId:"level5"},
    ],
  },
  { name: "Edu Support", grades: [] },
];

const PRAYER_NAMES = ["Fajr","Dhuhr","Asr","Maghrib","Isha"];
const DAYS = ["Sat","Sun","Mon","Tue","Wed","Thu","Fri"];

// Resolves after `ms` milliseconds with a null result — used with Promise.race
// to prevent Supabase queries from hanging indefinitely on slow mobile connections.
function withTimeout<T>(thenable: PromiseLike<T>, ms: number): Promise<T | null> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// ─── Student roster cache: in-memory + localStorage ──────
// Layer 1 — module-level Map: survives class-tab switching within the
//            same page session. Zero serialisation cost. Cleared on refresh.
// Layer 2 — localStorage: survives page refresh / tab reopen.
// Both layers store only {id, name, rollNumber} — no checkbox state.
// The realtime subscription keeps both layers up-to-date on any DB change.

const CACHE_VERSION = "v1";
// Layer 1: in-memory (lives as long as the JS module is loaded)
type RosterEntry = { id: string; name: string; rollNumber: string };
const memoryCache = new Map<string, RosterEntry[]>();

function rosterToStudents(roster: RosterEntry[]): Student[] {
  return roster.map(s => ({
    ...s,
    selfReported: false,
    prayers: [false, false, false, false, false],
    quran: false, reading: false, writing: false,
    custom: {},
  }));
}

function studentCacheKey(classId: string) {
  return `activity-students-${CACHE_VERSION}-${classId}`;
}

/** Read from memory first, then localStorage. Returns null if neither has data. */
function loadCachedStudents(classId: string): Student[] | null {
  // Layer 1: in-memory
  const mem = memoryCache.get(classId);
  if (mem) return rosterToStudents(mem);
  // Layer 2: localStorage
  try {
    const raw = localStorage.getItem(studentCacheKey(classId));
    if (!raw) return null;
    const parsed: RosterEntry[] = JSON.parse(raw);
    memoryCache.set(classId, parsed); // warm memory cache for next switch
    return rosterToStudents(parsed);
  } catch { return null; }
}

/** Write to both memory and localStorage. */
function saveCachedStudents(classId: string, students: Student[]) {
  const roster = students.map(({ id, name, rollNumber }) => ({ id, name, rollNumber }));
  memoryCache.set(classId, roster);
  try {
    localStorage.setItem(studentCacheKey(classId), JSON.stringify(roster));
  } catch {}
}

// ─── Supabase: Students ───────────────────────────────────
async function fetchClassStudents(classId: string): Promise<Student[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const result = await withTimeout(
      supabase
        .from("students")
        .select("id, name, roll_no")
        .eq("class_id", classId)
        .order("name"),
      8000
    );
    if (!result) return []; // timed out
    const { data, error } = result as { data: { id: string; name: string; roll_no: string | null }[] | null; error: unknown };
    if (error || !data) return [];
    return data.map(s => ({
      id: s.id,
      name: s.name,
      rollNumber: s.roll_no ?? s.id,
      selfReported: false,
      prayers: [false,false,false,false,false],
      quran: false, reading: false, writing: false,
      custom: {},
    }));
  } catch {
    return [];
  }
}

// ─── Supabase: Custom activities ─────────────────────────
async function dbLoadActivities(classId:string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const result = await withTimeout(
    supabase.from("class_custom_activities").select("activity_name")
      .eq("class_id",classId).order("position",{ascending:true}),
    8000
  );
  if (!result) return [];
  const { data } = result as { data: Record<string,string>[] | null };
  return (data??[]).map((r)=>r.activity_name);
}
async function dbAddActivity(classId:string, name:string, position:number) {
  if (!isSupabaseConfigured()) return;
  await supabase.from("class_custom_activities")
    .upsert({class_id:classId,activity_name:name,position},{onConflict:"class_id,activity_name"});
}
async function dbRemoveActivity(classId:string, name:string) {
  if (!isSupabaseConfigured()) return;
  await supabase.from("class_custom_activities").delete().eq("class_id",classId).eq("activity_name",name);
}
async function dbLoadConfig(classId:string): Promise<DefaultKey[]> {
  if (!isSupabaseConfigured()) return [];
  const {data} = await supabase.from("class_activity_config")
    .select("hidden_defaults").eq("class_id",classId).maybeSingle();
  return (data?.hidden_defaults??[]) as DefaultKey[];
}
async function dbSaveConfig(classId:string, hidden:DefaultKey[]) {
  if (!isSupabaseConfigured()) return;
  await supabase.from("class_activity_config")
    .upsert({class_id:classId,hidden_defaults:hidden,updated_at:new Date().toISOString()},{onConflict:"class_id"});
}

// ─── CSV Export ───────────────────────────────────────────
function exportCSV(students:Student[], grade:string, program:string,
  hiddenDefaults:DefaultKey[], customActivities:string[],
  getScore:(s:Student)=>number, maxScore:number) {
  const showP = !hiddenDefaults.includes("prayers");
  const showQ = !hiddenDefaults.includes("quran");
  const showR = !hiddenDefaults.includes("reading");
  const showW = !hiddenDefaults.includes("writing");
  const headers = ["Student","Roll #"];
  if (showP) headers.push("Fajr","Dhuhr","Asr","Maghrib","Isha","All Prayers");
  if (showQ) headers.push("Quran");
  if (showR) headers.push("Reading");
  if (showW) headers.push("Writing");
  customActivities.forEach(a=>headers.push(a));
  headers.push("Score",`Max (${maxScore})`,"% Score");
  const rows = students.map(s=>{
    const row:string[]=[s.name,s.rollNumber];
    if (showP){s.prayers.forEach(p=>row.push(p?"1":"0"));row.push(s.prayers.every(Boolean)?"1":"0");}
    if (showQ) row.push(s.quran?"1":"0");
    if (showR) row.push(s.reading?"1":"0");
    if (showW) row.push(s.writing?"1":"0");
    customActivities.forEach(a=>row.push(s.custom[a]?"1":"0"));
    const score=getScore(s);
    row.push(String(score),String(maxScore),`${maxScore>0?((score/maxScore)*100).toFixed(0):0}%`);
    return row;
  });
  const date=new Date().toISOString().slice(0,10);
  const csv=[`# Activity Report — ${grade} (${program}) — ${date}`,"# 1=Done 0=Not done","",
    headers.join(","),...rows.map(r=>r.map(v=>`"${v}"`).join(","))].join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`madrasa-activity-${grade.toLowerCase().replace(/\s+/g,"-")}-${date}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Star Field ──────────────────────────────────────────
function StarField() {
  const prefersReduced=useReducedMotion();
  const stars=useMemo(()=>Array.from({length:80},(_,i)=>({
    id:i,x:Math.random()*100,y:Math.random()*100,
    size:Math.random()*1.5+0.5,opacity:Math.random()*0.3+0.05,duration:Math.random()*8+6,
  })),[]);
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {stars.map(s=>(
        <motion.div key={s.id} className="absolute rounded-full"
          style={{left:`${s.x}%`,top:`${s.y}%`,width:s.size,height:s.size,backgroundColor:`rgba(255,255,255,${s.opacity})`}}
          animate={prefersReduced?{}:{y:[0,-20,0],opacity:[s.opacity,s.opacity*1.5,s.opacity]}}
          transition={{duration:s.duration,repeat:Infinity,ease:"linear"}}/>
      ))}
    </div>
  );
}

// ─── 3D Tilt Card ────────────────────────────────────────
function TiltCard({children,className=""}:{children:React.ReactNode;className?:string}) {
  const prefersReduced=useReducedMotion();
  const ref=useRef<HTMLDivElement>(null);
  const x=useMotionValue(0),y=useMotionValue(0);
  const rotateX=useSpring(useTransform(y,[-0.5,0.5],[6,-6]),{stiffness:300,damping:20});
  const rotateY=useSpring(useTransform(x,[-0.5,0.5],[-6,6]),{stiffness:300,damping:20});
  const onMove=useCallback((e:React.MouseEvent<HTMLDivElement>)=>{
    if(prefersReduced||!ref.current)return;
    const r=ref.current.getBoundingClientRect();
    x.set((e.clientX-r.left)/r.width-0.5);y.set((e.clientY-r.top)/r.height-0.5);
  },[prefersReduced,x,y]);
  return (
    <motion.div ref={ref} className={className}
      style={{perspective:1000,rotateX:prefersReduced?0:rotateX,rotateY:prefersReduced?0:rotateY,transformStyle:"preserve-3d"}}
      onMouseMove={onMove} onMouseLeave={()=>{x.set(0);y.set(0);}}>
      {children}
    </motion.div>
  );
}

// ─── Checkbox ────────────────────────────────────────────
function Checkbox({checked,onChange,color}:{checked:boolean;onChange:()=>void;color:string}) {
  const prefersReduced=useReducedMotion();
  const [pulse,setPulse]=useState(false);
  const m:Record<string,{bg:string;border:string;glow:string}>={
    gold:   {bg:"bg-[#C9A84C]",border:"border-[#C9A84C]",glow:"shadow-[0_0_12px_rgba(201,168,76,0.4)]"},
    teal:   {bg:"bg-[#14b8a6]",border:"border-[#14b8a6]",glow:"shadow-[0_0_12px_rgba(20,184,166,0.4)]"},
    emerald:{bg:"bg-[#10b981]",border:"border-[#10b981]",glow:"shadow-[0_0_12px_rgba(16,185,129,0.4)]"},
    blue:   {bg:"bg-[#3b82f6]",border:"border-[#3b82f6]",glow:"shadow-[0_0_12px_rgba(59,130,246,0.4)]"},
    purple: {bg:"bg-[#a855f7]",border:"border-[#a855f7]",glow:"shadow-[0_0_12px_rgba(168,85,247,0.4)]"},
  };
  const c=m[color]??m.purple;
  return (
    <button onClick={()=>{if(!checked)setPulse(true);onChange();}}
      className={`relative w-7 h-7 rounded-lg border-[1.5px] flex items-center justify-center transition-all duration-200 ${checked?`${c.bg} ${c.border} ${c.glow}`:`border-slate-300 dark:border-white/20 bg-white dark:bg-transparent hover:${c.border}`}`}
      aria-label={checked?"Mark incomplete":"Mark complete"}>
      <AnimatePresence>
        {checked&&<motion.div initial={prefersReduced?{opacity:1}:{scale:0}} animate={prefersReduced?{opacity:1}:{scale:[0,1.2,1]}} exit={{scale:0,opacity:0}} transition={{type:"spring",stiffness:300,damping:20}}><Check className="w-4 h-4 text-white" strokeWidth={3}/></motion.div>}
      </AnimatePresence>
      {pulse&&checked&&<span className="absolute inset-0 rounded-lg ring-pulse-once" onAnimationEnd={()=>setPulse(false)}/>}
    </button>
  );
}

// ─── Score Pill ──────────────────────────────────────────
function ScorePill({score,total}:{score:number;total:number}) {
  const pct=total>0?(score/total)*100:0;
  let cls="text-rose bg-rose-dim shadow-[0_0_10px_rgba(244,63,94,0.3)]";
  if(pct>=100) cls="text-emerald bg-emerald-dim shadow-[0_0_10px_rgba(16,185,129,0.3)]";
  else if(pct>=75) cls="text-blue bg-blue-dim shadow-[0_0_10px_rgba(59,130,246,0.3)]";
  else if(pct>=50) cls="text-amber bg-amber-dim shadow-[0_0_10px_rgba(245,158,11,0.3)]";
  return (
    <motion.span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${cls}`}
      key={score} initial={{scale:0.8}} animate={{scale:1}} transition={{type:"spring",stiffness:300,damping:20}}>
      {score}/{total}
    </motion.span>
  );
}

// ─── Reset Warning ────────────────────────────────────────
function ResetDialog({gradeName,onConfirm,onCancel}:{gradeName:string;onConfirm:()=>void;onCancel:()=>void}) {
  const prefersReduced=useReducedMotion();
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)"}}
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onCancel}>
      <motion.div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
        style={{background:"rgba(10,18,35,0.98)",border:"1px solid rgba(244,63,94,0.3)"}}
        initial={prefersReduced?{opacity:0}:{scale:0.85,opacity:0,y:20}}
        animate={prefersReduced?{opacity:1}:{scale:1,opacity:1,y:0}}
        exit={prefersReduced?{opacity:0}:{scale:0.85,opacity:0,y:20}}
        transition={{type:"spring",stiffness:300,damping:25}} onClick={e=>e.stopPropagation()}>
        <div className="flex justify-center">
          <motion.div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{background:"rgba(244,63,94,0.12)",border:"1px solid rgba(244,63,94,0.3)"}}
            animate={prefersReduced?{}:{scale:[1,1.06,1]}} transition={{duration:1.8,repeat:Infinity}}>
            <AlertTriangle className="w-8 h-8 text-rose"/>
          </motion.div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-bold text-white">Reset Activity Columns?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This will restore all <span className="text-white font-medium">default activities</span> and remove <span className="text-white font-medium">custom activities</span> for{" "}
            <span className="text-[#C9A84C] font-semibold">{gradeName}</span>.
          </p>
          <p className="text-xs text-emerald font-medium">✓ Student marks will NOT be cleared.</p>
        </div>
        <div className="flex gap-3">
          <motion.button onClick={onCancel}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-muted-foreground"
            style={{border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)"}}
            whileHover={{background:"rgba(255,255,255,0.08)"}} whileTap={{scale:0.97}}>
            Cancel
          </motion.button>
          <motion.button onClick={onConfirm}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
            style={{background:"rgba(244,63,94,0.85)"}}
            whileHover={{background:"rgba(244,63,94,1)"}} whileTap={{scale:0.97}}>
            Yes, Reset Columns
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────
export default function ActivityTrackerPage() {
  const prefersReduced=useReducedMotion();
  const spring={type:"spring" as const,stiffness:300,damping:20};

  const [activeProgram,    setActiveProgram]    = useState(0);
  const [activeGrade,      setActiveGrade]      = useState(0);
  // Open on TODAY's weekday so teachers immediately see what students submitted
  // today (DAYS = [Sat,Sun,Mon,…] → index = (getDay()+1) % 7). Deliberately not
  // restored from tracker-prefs — "always open on today" is the desired behaviour.
  const [activeDay,        setActiveDay]        = useState(()=> (new Date().getDay() + 1) % 7);
  const [prefsRestored,    setPrefsRestored]    = useState(false);
  const [weekOffset,       setWeekOffset]       = useState(0);
  const [copied,           setCopied]           = useState(false);
  const [students,         setStudents]         = useState<Student[]>([]);
  const [studentsLoading,  setStudentsLoading]  = useState(false);
  type SREntry = {prayers:boolean[];quran:boolean;reading:boolean;writing:boolean;custom:Record<string,boolean>};
  const [selfReportMap,    setSelfReportMap]    = useState<Map<string,SREntry>>(new Map());
  const [editMode,         setEditMode]         = useState(false);
  const [newActivity,      setNewActivity]      = useState("");
  const [customActivities, setCustomActivities] = useState<string[]>([]);
  const [hiddenDefaults,   setHiddenDefaults]   = useState<DefaultKey[]>([]);
  const [configLoading,    setConfigLoading]    = useState(false);
  const [showReset,        setShowReset]        = useState(false);
  const [programs,         setPrograms]         = useState<ProgramData[]>(PROGRAMS_FALLBACK);
  const inputRef=useRef<HTMLInputElement>(null);

  // Fetch all classes from DB — overwrites fallback with real class IDs (fixes Edu Support)
  useEffect(()=>{
    if(!isSupabaseConfigured()) return;
    withTimeout(
      supabase.from("classes").select("id,name,course_id").order("name"),
      8000
    ).then((result)=>{
      if(!result) return; // timed out — keep fallback
      const { data } = result as { data: {id:string;name:string;course_id:string}[] | null };
      if(!data||data.length===0) return;
      const grouped: Record<string,GradeData[]>={};
      for(const cls of data){
        if(!COURSE_META[cls.course_id]) continue;
        if(!grouped[cls.course_id]) grouped[cls.course_id]=[];
        grouped[cls.course_id].push({grade:cls.name, classId:cls.id});
      }
      const built = Object.entries(COURSE_META)
        .sort((a,b)=>a[1].order-b[1].order)
        .map(([cid,{name}])=>({name, grades:grouped[cid]??[]}));
      setPrograms(built);
    }).catch(()=>{ /* keep fallback on error */ });
  },[]);

  // Restore last-selected class from saved classId + programName once programs are ready
  useEffect(()=>{
    if(prefsRestored || programs.length===0) return;
    try{
      const saved = localStorage.getItem("tracker-prefs");
      if(saved){
        const { classId: savedClassId, programName: savedProgName } = JSON.parse(saved);
        if(savedClassId && savedProgName){
          const pIdx = programs.findIndex(p=>p.name===savedProgName);
          if(pIdx!==-1){
            const gIdx = programs[pIdx].grades.findIndex(g=>g.classId===savedClassId);
            if(gIdx!==-1){ setActiveProgram(pIdx); setActiveGrade(gIdx); }
          }
        }
      }
    }catch{ /* ignore */ }
    setPrefsRestored(true);
  },[programs, prefsRestored]);

  // Clamp indices so stale values never produce undefined
  const safeProgram = Math.min(activeProgram, Math.max(0, programs.length - 1));
  const currentProgram = programs[safeProgram];
  const safeGrade = Math.min(activeGrade, Math.max(0, (currentProgram?.grades.length ?? 1) - 1));
  const currentGrade  = currentProgram?.grades[safeGrade];
  const classId       = currentGrade?.classId ?? "";

  // Reset activeGrade when switching programs to avoid out-of-bounds index
  useEffect(()=>{
    if(currentProgram && activeGrade >= currentProgram.grades.length) setActiveGrade(0);
  },[currentProgram, activeGrade]);

  const showPrayers=!hiddenDefaults.includes("prayers");
  const showQuran  =!hiddenDefaults.includes("quran");
  const showReading=!hiddenDefaults.includes("reading");
  const showWriting=!hiddenDefaults.includes("writing");

  const maxScore=
    (showPrayers?5:0)+(showQuran?1:0)+(showReading?1:0)+(showWriting?1:0)+customActivities.length;

  const getScore=useCallback((s:Student)=>
    (showPrayers?s.prayers.filter(Boolean).length:0)+
    (showQuran?(s.quran?1:0):0)+(showReading?(s.reading?1:0):0)+
    (showWriting?(s.writing?1:0):0)+customActivities.filter(k=>s.custom[k]).length,
  [showPrayers,showQuran,showReading,showWriting,customActivities]);

  // Load students + subscribe to attendance DB changes for this class
  useEffect(()=>{
    if(!classId)return;

    // ── 1. Serve from cache instantly (no spinner) ────────
    const cached = loadCachedStudents(classId);
    if(cached){ setStudents(cached); }
    else { setStudentsLoading(true); }

    // ── 2. Silent background refresh from DB ─────────────
    fetchClassStudents(classId)
      .then(data=>{
        setStudents(data);
        saveCachedStudents(classId, data);
      })
      .catch(()=>{ if(!cached) setStudents([]); })
      .finally(()=>{ setStudentsLoading(false); });

    if(!isSupabaseConfigured())return;

    // ── 3. Realtime: keep cache + state in sync on any change ──
    const channel = supabase
      .channel(`students-${classId}`)
      .on("postgres_changes",
        {event:"INSERT", schema:"public", table:"students", filter:`class_id=eq.${classId}`},
        (payload)=>{
          const r = payload.new as {id:string;name:string;roll_no:string|null};
          const newStudent: Student = {
            id:r.id, name:r.name, rollNumber:r.roll_no??r.id,
            selfReported:false, prayers:[false,false,false,false,false],
            quran:false, reading:false, writing:false, custom:{},
          };
          setStudents(prev=>{ const next=[...prev,newStudent]; saveCachedStudents(classId,next); return next; });
        })
      .on("postgres_changes",
        {event:"DELETE", schema:"public", table:"students", filter:`class_id=eq.${classId}`},
        (payload)=>{
          const old = payload.old as {id:string};
          setStudents(prev=>{ const next=prev.filter(s=>s.id!==old.id); saveCachedStudents(classId,next); return next; });
        })
      .on("postgres_changes",
        {event:"UPDATE", schema:"public", table:"students", filter:`class_id=eq.${classId}`},
        (payload)=>{
          const r = payload.new as {id:string;name:string;roll_no:string|null};
          setStudents(prev=>{
            const next=prev.map(s=>s.id===r.id?{...s,name:r.name,rollNumber:r.roll_no??r.id}:s);
            saveCachedStudents(classId,next);
            return next;
          });
        })
      .subscribe();

    return ()=>{ supabase.removeChannel(channel); };
  },[classId]);

  // Load config (custom activities + hidden defaults) on class change
  useEffect(()=>{
    if(!classId)return;
    setConfigLoading(true);
    Promise.all([dbLoadActivities(classId),dbLoadConfig(classId)]).then(([acts,hidden])=>{
      setCustomActivities(acts);
      setHiddenDefaults(hidden);
      setConfigLoading(false);
    });
  },[classId]);

  useEffect(()=>{if(editMode)setTimeout(()=>inputRef.current?.focus(),80);},[editMode]);

  // Persist last-selected class by ID + program name (robust against array reordering)
  useEffect(()=>{
    if(!classId || !currentProgram) return;
    try{
      localStorage.setItem("tracker-prefs", JSON.stringify({
        classId,
        programName: currentProgram.name,
        day: activeDay,
      }));
    }catch{}
  },[classId, currentProgram, activeDay]);

  // Fetch self-reports into a separate map — avoids race condition with student loading
  const fetchSelfReports = useCallback(()=>{
    if(!classId||!isSupabaseConfigured()){ setSelfReportMap(new Map()); return; }
    const dayKey=["sat","sun","mon","tue","wed","thu","fri"][activeDay];
    const now=new Date(),d=now.getDay();
    const sat=new Date(now); sat.setDate(now.getDate()-(d===6?0:d+1)+weekOffset*7); sat.setHours(0,0,0,0);
    const wk=`${sat.getFullYear()}-${String(sat.getMonth()+1).padStart(2,"0")}-${String(sat.getDate()).padStart(2,"0")}`;
    supabase.from("student_self_reports")
      .select("roll_no,fajr,dhuhr,asr,maghrib,isha,quran,reading,writing,custom_data")
      .eq("class_id",classId).eq("week_key",wk).eq("day_key",dayKey)
      .then(({data})=>{
        const m = new Map<string,SREntry>();
        if(data){
          type SR = Record<string,unknown>;
          for(const r of data as SR[]){
            const key = String(r.roll_no);
            const customRaw = r.custom_data && typeof r.custom_data === "object"
              ? r.custom_data as Record<string,boolean>
              : {};
            m.set(key,{
              prayers:[!!r.fajr,!!r.dhuhr,!!r.asr,!!r.maghrib,!!r.isha],
              quran:!!r.quran, reading:!!r.reading, writing:!!r.writing,
              custom: customRaw,
            });
          }
        }
        setSelfReportMap(m);
      });
  },[classId,activeDay,weekOffset]);

  useEffect(()=>{ fetchSelfReports(); },[fetchSelfReports]);

  // Realtime: re-fetch self-reports when any student in this class submits/updates
  useEffect(()=>{
    if(!classId||!isSupabaseConfigured())return;
    const ch = supabase
      .channel(`ssr-${classId}`)
      .on("postgres_changes",
        {event:"*", schema:"public", table:"student_self_reports", filter:`class_id=eq.${classId}`},
        ()=>fetchSelfReports())
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[classId,fetchSelfReports]);

  // Dynamic summary stats — only visible activities
  const summaryStats = useMemo(()=>{
    const stats: {label:string; value:string|number; icon:React.ReactNode; color:string}[] = [
      {label:"Total Students", value:students.length, icon:<Users className="w-4 h-4"/>, color:"text-gold"},
    ];
    if(showPrayers) stats.push({label:"Full Prayers",  value:students.filter(s=>s.prayers.every(Boolean)).length, icon:<Sparkles className="w-4 h-4"/>, color:"text-gold"});
    if(showQuran)   stats.push({label:"Quran Done",    value:students.filter(s=>s.quran).length,   icon:<BookOpen className="w-4 h-4"/>, color:"text-teal"});
    if(showReading) stats.push({label:"Reading Done",  value:students.filter(s=>s.reading).length, icon:<BookOpen className="w-4 h-4"/>, color:"text-emerald"});
    if(showWriting) stats.push({label:"Writing Done",  value:students.filter(s=>s.writing).length, icon:<PenLine className="w-4 h-4"/>,  color:"text-blue"});
    customActivities.forEach(act=>{
      const {icon,label}=getActivityMeta(act);
      stats.push({label:`${label}: ${act}`, value:students.filter(s=>!!s.custom[act]).length, icon:<span className="text-sm">{icon}</span>, color:"text-purple"});
    });
    stats.push({label:"Avg Score", value:maxScore>0?`${((students.reduce((a,s)=>a+getScore(s),0)/students.length/maxScore)*100).toFixed(0)}%`:"0%", icon:<PenLine className="w-4 h-4"/>, color:"text-emerald"});
    return stats;
  },[students,showPrayers,showQuran,showReading,showWriting,customActivities,maxScore,getScore]);

  const getWeekRange=useCallback(()=>{
    const now=new Date(),start=new Date(now);
    // Saturday-start week — MUST match fetchSelfReports() and the student portal,
    // otherwise the displayed week is off by one day from the stored week_key and
    // teachers don't see what students submitted.
    const d=now.getDay();
    start.setDate(now.getDate()-(d===6?0:d+1)+weekOffset*7);
    const end=new Date(start); end.setDate(start.getDate()+6);
    const fmt=(d:Date)=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
    return `${fmt(start)} – ${fmt(end)}`;
  },[weekOffset]);

  const togglePrayer=useCallback((sIdx:number,pIdx:number)=>{
    setStudents(prev=>prev.map((s,i)=>i===sIdx?{...s,prayers:s.prayers.map((p,j)=>j===pIdx?!p:p)}:s));
  },[]);
  const toggleActivity=useCallback((sIdx:number,field:"quran"|"reading"|"writing")=>{
    setStudents(prev=>prev.map((s,i)=>i===sIdx?{...s,[field]:!s[field]}:s));
  },[]);
  const toggleCustom=useCallback((sIdx:number,key:string)=>{
    setStudents(prev=>prev.map((s,i)=>i===sIdx?{...s,custom:{...s.custom,[key]:!s.custom[key]}}:s));
  },[]);
  const toggleAllPrayers=useCallback((sIdx:number)=>{
    setStudents(prev=>{const on=prev[sIdx].prayers.every(Boolean);return prev.map((s,i)=>i===sIdx?{...s,prayers:s.prayers.map(()=>!on)}:s);});
  },[]);

  const toggleDefault=useCallback(async(key:DefaultKey)=>{
    const next=hiddenDefaults.includes(key)?hiddenDefaults.filter(k=>k!==key):[...hiddenDefaults,key];
    setHiddenDefaults(next);
    await dbSaveConfig(classId,next);
  },[hiddenDefaults,classId]);

  const addActivity=useCallback(async()=>{
    const name=newActivity.trim();
    if(!name||customActivities.includes(name))return;
    setCustomActivities(prev=>[...prev,name]);
    setNewActivity(""); inputRef.current?.focus();
    await dbAddActivity(classId,name,customActivities.length);
  },[newActivity,customActivities,classId]);

  const removeActivity=useCallback(async(name:string)=>{
    setCustomActivities(prev=>prev.filter(a=>a!==name));
    setStudents(prev=>prev.map(s=>{const c={...s.custom};delete c[name];return{...s,custom:c};}));
    await dbRemoveActivity(classId,name);
  },[classId]);

  const handleReset=useCallback(async()=>{
    await Promise.all([dbSaveConfig(classId,[]),...customActivities.map(a=>dbRemoveActivity(classId,a))]);
    setHiddenDefaults([]);setCustomActivities([]);setShowReset(false);setEditMode(false);
  },[customActivities,classId]);

  const handleCopy=()=>{
    navigator.clipboard.writeText(`${window.location.origin}/student`).then(()=>{
      setCopied(true);setTimeout(()=>setCopied(false),2000);
    });
  };

  return (
    <div className="relative min-h-screen bg-background">
      <StarField/>
      <AnimatePresence>
        {showReset&&<ResetDialog gradeName={currentGrade?.grade??"this class"} onConfirm={handleReset} onCancel={()=>setShowReset(false)}/>}
      </AnimatePresence>

      <div className="relative z-10 mx-auto max-w-[1400px] px-4 pb-12 md:px-6">

        {/* ── Top Bar ── */}
        <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-4">
          <div className="glass-card rounded-2xl px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <motion.div animate={prefersReduced?{}:{scale:[1,1.15,1]}} transition={{duration:2,repeat:Infinity}}>
                <Activity className="w-5 h-5 text-gold"/>
              </motion.div>
              <h1 className="text-lg font-bold text-gold tracking-wide">Activity Tracker</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <motion.button onClick={()=>setEditMode(v=>!v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${editMode?"bg-[#C9A84C] text-[#050d1a] shadow-[0_0_14px_rgba(201,168,76,0.4)]":"glass-card text-muted-foreground hover:text-foreground"}`}
                whileTap={{scale:0.95}}>
                <Pencil className="w-3.5 h-3.5"/> {editMode?"Done Editing":"Edit"}
              </motion.button>
              <motion.button onClick={()=>currentGrade&&currentProgram&&exportCSV(students,currentGrade.grade,currentProgram.name,hiddenDefaults,customActivities,getScore,maxScore)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold glass-card text-emerald hover:bg-emerald/10 transition-all"
                whileTap={{scale:0.95}}>
                <Download className="w-3.5 h-3.5"/> Report
              </motion.button>
              <div className="flex items-center gap-1">
                <motion.button whileTap={{scale:0.9}} onClick={()=>setWeekOffset(w=>w-1)} className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground"><ChevronLeft className="w-4 h-4"/></motion.button>
                <motion.span className="text-sm font-medium px-4 py-1.5 rounded-full bg-gold-dim text-gold whitespace-nowrap" layout transition={spring}>
                  {weekOffset===0?"This Week":getWeekRange()}
                </motion.span>
                <motion.button whileTap={{scale:0.9}} onClick={()=>setWeekOffset(w=>w+1)} className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground"><ChevronRight className="w-4 h-4"/></motion.button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Edit Banner ── */}
        <AnimatePresence>
          {editMode&&(
            <motion.div initial={{opacity:0,height:0,marginTop:0}} animate={{opacity:1,height:"auto",marginTop:12}} exit={{opacity:0,height:0,marginTop:0}} className="overflow-hidden">
              <div className="rounded-2xl p-4 space-y-4" style={{background:"rgba(201,168,76,0.06)",border:"1px solid rgba(201,168,76,0.25)"}}>
                <div className="flex items-center gap-3 flex-wrap">
                  <Pencil className="w-4 h-4 text-gold shrink-0"/>
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-gold/60 uppercase tracking-wider">Editing activities for</span>
                    <span className="text-sm font-bold text-gold">{currentGrade?.grade} — {currentProgram?.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:inline">Changes only affect this class.</span>
                  {configLoading&&<span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
                  <motion.button onClick={()=>setShowReset(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold glass-card text-rose hover:bg-rose/10 transition-all ml-auto"
                    whileTap={{scale:0.95}}>
                    <RotateCcw className="w-3.5 h-3.5"/> Reset
                  </motion.button>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Default Activities — click to show/hide</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DEFAULTS.map(key=>{
                      const hidden=hiddenDefaults.includes(key);
                      return (
                        <motion.button key={key} onClick={()=>toggleDefault(key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${hidden?"line-through text-muted-foreground border border-border":"text-foreground border"}`}
                          style={hidden?{background:"rgba(255,255,255,0.03)"}:{borderColor:"rgba(201,168,76,0.4)",background:"rgba(201,168,76,0.08)"}}
                          whileTap={{scale:0.95}}>
                          {hidden?<EyeOff className="w-3 h-3"/>:<Eye className="w-3 h-3 text-gold"/>}
                          {DEFAULT_LABELS[key]}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Custom Activities</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {customActivities.map(act=>(
                      <motion.span key={act} initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-purple bg-purple-dim"
                        style={{border:"1px solid rgba(168,85,247,0.3)"}}>
                        {getActivityMeta(act).icon} {act}
                        <button onClick={()=>removeActivity(act)} className="hover:text-rose ml-0.5"><X className="w-3 h-3"/></button>
                      </motion.span>
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                      <input ref={inputRef} value={newActivity} onChange={e=>setNewActivity(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&addActivity()} placeholder="Add custom activity…" maxLength={24}
                        className="w-44 px-3 py-1.5 rounded-xl text-xs bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-gold/50"/>
                      <motion.button onClick={addActivity} disabled={!newActivity.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gold text-[#050d1a] disabled:opacity-30"
                        whileTap={{scale:0.95}}>
                        <Plus className="w-3.5 h-3.5"/> Add
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Program Tabs ── */}
        <div className="mt-6">
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-muted/40 overflow-x-auto scrollbar-none">
            {programs.map((prog,i)=>(
              <motion.button key={prog.name} onClick={()=>{setActiveProgram(i);setActiveGrade(0);setEditMode(false);}}
                className={`relative shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeProgram===i?"text-gold":"text-muted-foreground hover:text-foreground"}`}
                animate={activeProgram===i?{scale:1.02}:{scale:1}} transition={spring}>
                {prog.name}
                {activeProgram===i&&<motion.div layoutId="tab-underline" className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gold" style={{boxShadow:"0 0 8px rgba(201,168,76,0.5)"}} transition={spring}/>}
              </motion.button>
            ))}
          </div>
        </div>

        {currentProgram?.grades.length===0?(
          <div className="mt-8 glass-card rounded-2xl p-16 text-center text-muted-foreground">No classes configured for this program.</div>
        ):(
          <>
            {/* ── Grade Selector ── */}
            <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
              {currentProgram?.grades.map((g,i)=>(
                <motion.button key={g.grade} onClick={()=>{setActiveGrade(i);setEditMode(false);}}
                  className={`relative shrink-0 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${activeGrade===i?"bg-gold text-primary-foreground shadow-[0_4px_20px_rgba(201,168,76,0.3)]":"glass-card text-foreground hover:bg-muted/50"}`}
                  animate={activeGrade===i?{scale:1.05,y:-2}:{scale:1,y:0}} transition={spring}>
                  {g.grade}
                </motion.button>
              ))}
            </div>

            {/* ── Student Portal Banner ── */}
            <div className="mt-6">
              <div className="rounded-2xl p-3 sm:p-4 glass-card" style={{borderColor:"rgba(201,168,76,0.15)"}}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75"/>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald"/>
                    </span>
                    <span className="text-sm font-medium text-emerald truncate">Student Portal Live</span>
                    {customActivities.length>0&&(
                      <span className="hidden sm:inline text-xs text-purple bg-purple-dim px-2 py-0.5 rounded-full shrink-0" style={{border:"1px solid rgba(168,85,247,0.3)"}}>
                        +{customActivities.length} custom
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <code className="hidden sm:block px-3 py-1.5 rounded-lg bg-muted text-xs font-mono text-muted-foreground">
                      {typeof window!=="undefined"?window.location.origin:""}/student
                    </code>
                    <motion.button whileTap={{scale:0.9}} onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold-dim text-gold text-xs font-medium hover:bg-gold-glow">
                      {copied?<Check className="w-3.5 h-3.5"/>:<Copy className="w-3.5 h-3.5"/>}
                      {copied?"Copied":"Copy"}
                    </motion.button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Day Pills ── */}
            <div className="mt-6 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground text-center">{getWeekRange()}</p>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 px-0.5 scrollbar-none">
                {DAYS.map((day,i)=>(
                  <motion.button key={day} onClick={()=>setActiveDay(i)}
                    className={`shrink-0 px-3 py-2 rounded-full text-xs font-semibold transition-all ${activeDay===i?"bg-emerald text-white shadow-[0_0_16px_rgba(16,185,129,0.4)]":"glass-card text-foreground hover:text-foreground"}`}
                    animate={activeDay===i?{scale:1.05}:{scale:1}} transition={spring}>
                    {day}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* ── Activity Table ── */}
            <div className="mt-8 overflow-x-auto rounded-2xl glass-card">
              {studentsLoading ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                  <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}}>
                    <Users className="w-8 h-8 opacity-40"/>
                  </motion.div>
                  <p className="text-sm">Loading students from attendance…</p>
                </div>
              ) : students.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                  <Users className="w-10 h-10 opacity-20"/>
                  <p className="text-sm font-medium">No students found for {currentGrade?.grade}</p>
                  <p className="text-xs opacity-60">Students are loaded from the attendance system.</p>
                </div>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-card w-14 whitespace-nowrap">SL No</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider w-20">Reg No</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Student <span className="text-gold/50 font-normal">({students.length})</span>
                      </th>
                      {showPrayers&&PRAYER_NAMES.map(n=><th key={n} className="px-2 py-3 text-center text-xs font-semibold text-gold uppercase tracking-wider" style={{backgroundColor:"rgba(201,168,76,0.03)"}}>{n}</th>)}
                      {showPrayers&&<th className="px-2 py-3 text-center text-xs font-semibold text-gold uppercase tracking-wider" style={{backgroundColor:"rgba(201,168,76,0.03)"}}>5✓</th>}
                      {showQuran&&<th className="px-2 py-3 text-center text-xs font-semibold text-teal uppercase tracking-wider"    style={{backgroundColor:"rgba(20,184,166,0.03)"}}>Quran</th>}
                      {showReading&&<th className="px-2 py-3 text-center text-xs font-semibold text-emerald uppercase tracking-wider" style={{backgroundColor:"rgba(16,185,129,0.03)"}}>Reading</th>}
                      {showWriting&&<th className="px-2 py-3 text-center text-xs font-semibold text-blue uppercase tracking-wider"    style={{backgroundColor:"rgba(59,130,246,0.03)"}}>Writing</th>}
                      {customActivities.map(act=>(
                        <th key={act} className="px-2 py-3 text-center text-xs font-semibold text-purple uppercase tracking-wider whitespace-nowrap" style={{backgroundColor:"rgba(168,85,247,0.03)"}}>
                          <div className="flex items-center justify-center gap-1">
                            <span>{getActivityMeta(act).icon} {act}</span>
                            {editMode&&<motion.button initial={{scale:0}} animate={{scale:1}} onClick={()=>removeActivity(act)} className="text-rose hover:text-rose/80 ml-0.5"><X className="w-3 h-3"/></motion.button>}
                          </div>
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gold uppercase tracking-wider">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence mode="popLayout">
                      {students.map((s,sIdx)=>{
                        // Merge teacher marks with student self-report (self-report fills empty slots)
                        const sr=selfReportMap.get(String(s.id))||selfReportMap.get(String(s.rollNumber));
                        const eff = sr ? {
                          ...s,
                          prayers: s.prayers.map((p, i) => p || sr.prayers[i]),
                          quran:   s.quran   || sr.quran,
                          reading: s.reading || sr.reading,
                          writing: s.writing || sr.writing,
                          custom:  Object.fromEntries(
                            customActivities.map(k => [k, !!(s.custom[k] || sr.custom[k])])
                          ),
                          selfReported: true,
                        } : s;
                        const allPrayers=eff.prayers.every(Boolean);
                        const score=getScore(eff);
                        return (
                          <motion.tr key={s.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}
                            transition={{...spring,delay:sIdx*0.02}}
                            className="group border-b border-border/40 hover:bg-muted/30 transition-colors">
                            <td className="sticky left-0 z-10 px-3 py-3 text-center text-xs font-medium text-muted-foreground bg-card group-hover:bg-muted/30 w-10">{sIdx+1}</td>
                            <td className="px-3 py-3 text-center text-xs font-mono text-muted-foreground w-20">{s.rollNumber}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={getAvatarPublicUrl(currentGrade?.classId??"", s.id)}
                                  alt=""
                                  className="w-7 h-7 rounded-full object-cover shrink-0 bg-muted"
                                  onError={e=>{(e.target as HTMLImageElement).style.display="none"}}
                                />
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground text-sm">{s.name}</span>
                                  {eff.selfReported&&<span className="relative flex h-2 w-2" title="Student self-reported"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple opacity-75"/><span className="relative inline-flex h-2 w-2 rounded-full bg-purple"/></span>}
                                </div>
                              </div>
                            </td>
                            {showPrayers&&eff.prayers.map((checked,pIdx)=>(
                              <td key={pIdx} className="px-2 py-3 text-center" style={{backgroundColor:"rgba(201,168,76,0.015)"}}>
                                <div className="flex justify-center"><Checkbox checked={checked} onChange={()=>togglePrayer(sIdx,pIdx)} color="gold"/></div>
                              </td>
                            ))}
                            {showPrayers&&(
                              <td className="px-2 py-3 text-center" style={{backgroundColor:"rgba(201,168,76,0.015)"}}>
                                <motion.button onClick={()=>toggleAllPrayers(sIdx)} whileTap={{scale:0.9}}
                                  className={`relative w-9 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition-all ${allPrayers?"bg-gold text-primary-foreground shadow-[0_0_16px_rgba(201,168,76,0.5)]":"border border-slate-300 dark:border-white/15 bg-white dark:bg-transparent text-muted-foreground hover:border-gold/40"}`}>
                                  5✓
                                  {allPrayers&&<motion.div className="absolute -top-1 -right-1" initial={{scale:0}} animate={{scale:[0,1.3,1]}} transition={spring}><Sparkles className="w-3 h-3 text-gold"/></motion.div>}
                                </motion.button>
                              </td>
                            )}
                            {showQuran&&<td className="px-2 py-3 text-center" style={{backgroundColor:"rgba(20,184,166,0.015)"}}><div className="flex justify-center"><Checkbox checked={eff.quran} onChange={()=>toggleActivity(sIdx,"quran")} color="teal"/></div></td>}
                            {showReading&&<td className="px-2 py-3 text-center" style={{backgroundColor:"rgba(16,185,129,0.015)"}}><div className="flex justify-center"><Checkbox checked={eff.reading} onChange={()=>toggleActivity(sIdx,"reading")} color="emerald"/></div></td>}
                            {showWriting&&<td className="px-2 py-3 text-center" style={{backgroundColor:"rgba(59,130,246,0.015)"}}><div className="flex justify-center"><Checkbox checked={eff.writing} onChange={()=>toggleActivity(sIdx,"writing")} color="blue"/></div></td>}
                            {customActivities.map(act=>(
                              <td key={act} className="px-2 py-3 text-center" style={{backgroundColor:"rgba(168,85,247,0.015)"}}>
                                <div className="flex justify-center"><Checkbox checked={!!eff.custom[act]} onChange={()=>toggleCustom(sIdx,act)} color="purple"/></div>
                              </td>
                            ))}
                            <td className="px-3 py-3 text-center"><ScorePill score={score} total={maxScore}/></td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Summary Footer ── */}
            {!studentsLoading&&students.length>0&&(
              <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                {summaryStats.map(stat=>(
                  <TiltCard key={stat.label} className="rounded-2xl">
                    <div className="glass-card rounded-2xl p-4">
                      <div className={`flex items-center gap-2 ${stat.color} mb-1`}>
                        {stat.icon}
                        <span className="text-xs font-medium uppercase tracking-wider opacity-70">{stat.label}</span>
                      </div>
                      <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                    </div>
                  </TiltCard>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
