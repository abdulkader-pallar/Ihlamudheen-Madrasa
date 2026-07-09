"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Menu,
  X,
  Target,
  Eye,
  Gem,
  BookOpen,
  BookMarked,
  Landmark,
  Languages,
  Heart,
  Baby,
  Phone,
  Mail,
  MapPin,
  Clock,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Toaster, toast } from "@/components/ui/toast";
import { btn, cx } from "@/lib/ui";

const NAV = [
  ["Home", "#home"],
  ["About", "#about"],
  ["Programs", "#programs"],
  ["Admissions", "#admissions"],
  ["Contact", "#contact"],
] as const;

const PROGRAMS = [
  { icon: BookOpen, title: "Qur'an & Tajweed", desc: "Correct recitation from Qaida to fluent reading, with the rules of tajweed taught step by step.", tags: ["Qaida", "Nazira", "Tajweed"] },
  { icon: BookMarked, title: "Hifz al-Qur'an", desc: "A dedicated memorization program with revision cycles and one-to-one supervision.", tags: ["Memorization", "Revision"] },
  { icon: Landmark, title: "Islamic Studies", desc: "Aqeedah, Fiqh, Seerah and Islamic history taught in an age-appropriate way.", tags: ["Aqeedah", "Fiqh", "Seerah"] },
  { icon: Languages, title: "Arabic Language", desc: "Reading, writing and understanding classical Arabic — the key to the Qur'an and Sunnah.", tags: ["Grammar", "Vocabulary"] },
  { icon: Heart, title: "Akhlaq & Adab", desc: "Manners, morals and the prophetic character — daily du'as, etiquette and noble values.", tags: ["Manners", "Du'as", "Hadith"] },
  { icon: Baby, title: "Kindergarten Deen", desc: "A warm first step for our youngest learners — letters, short surahs and love for Allah.", tags: ["Ages 4–6", "Foundation"] },
];

const STEPS = [
  ["Send an enquiry", "Fill in the form or call us — tell us your child's age and the program you're interested in."],
  ["Visit & assessment", "Meet our teachers, see the classrooms, and let us gauge your child's current level."],
  ["Confirm & begin", "Complete the simple registration and welcome your child to their new learning journey."],
];

const CONTACTS: [typeof Phone, string, string][] = [
  [Phone, "Call / WhatsApp", "+91 00000 00000"],
  [Mail, "Email", "info@ihlamudheen.edu"],
  [MapPin, "Location", "Your address, City, State"],
  [Clock, "Class Hours", "Daily · 6:00 – 9:00 AM"],
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const colRef = useRef<HTMLDivElement>(null);

  // Header shadow on scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-fit the hero headline to its column on one line (cap 30px)
  useEffect(() => {
    const fit = () => {
      const t = titleRef.current, col = colRef.current;
      if (!t || !col) return;
      t.style.fontSize = "100px";
      const natural = t.scrollWidth || 1;
      const size = Math.min((col.clientWidth / natural) * 100 * 0.99, 30);
      t.style.fontSize = size + "px";
    };
    fit();
    if (document.fonts?.ready) document.fonts.ready.then(fit);
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(raf); };
  }, []);

  // Scroll reveal
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const onEnquiry = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = [
      "Admission Enquiry — Ihlamudheen Madrasa", "",
      `Parent/Guardian: ${f.get("pname")}`,
      `Phone: ${f.get("phone")}`,
      `Student: ${f.get("cname")} (Age ${f.get("age")})`,
      `Program: ${f.get("program")}`,
      `Message: ${f.get("msg") || "—"}`,
    ].join("\n");
    window.location.href =
      `mailto:info@ihlamudheen.edu?subject=${encodeURIComponent("Admission Enquiry — " + f.get("cname"))}&body=${encodeURIComponent(body)}`;
    toast("Jazak Allahu khayran! Opening your email to send the enquiry.");
    e.currentTarget.reset();
  };

  const Logo = ({ h = "h-11" }: { h?: string }) => (
    <>
      <img className={cx("logo-light w-auto", h)} src="/Logo of Ihlamudheen Madrasa light.png" alt="Ihlamudheen Madrasa" />
      <img className={cx("logo-dark w-auto", h)} src="/Logo of Ihlamudheen Madrasa dark.png" alt="Ihlamudheen Madrasa" />
    </>
  );

  return (
    <>
      {/* HEADER */}
      <header className={cx("sticky top-0 z-50 backdrop-blur-md transition-[border,box-shadow]", scrolled ? "border-b border-line shadow-soft" : "border-b border-transparent")} style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}>
        <div className="mx-auto flex h-[74px] max-w-[1180px] items-center justify-between gap-5 px-5 sm:px-10">
          <a href="#home" className="flex items-center gap-3">
            <Logo />
            <span className="hidden flex-col leading-none sm:flex">
              <span className="font-display text-lg font-semibold text-ink">Ihlamudheen Madrasa</span>
              <span className="text-center font-ar text-[15px] font-bold text-brand" dir="rtl">مدرسة إعلام الدين</span>
            </span>
          </a>

          <nav className="hidden items-center gap-1.5 min-[900px]:flex">
            {NAV.map(([label, href]) => (
              <a key={href} href={href} className="rounded-lg px-4 py-2 text-[15px] font-semibold text-muted transition hover:bg-[color-mix(in_srgb,var(--brand)_9%,transparent)] hover:text-brand">{label}</a>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <a href="#admissions" className={cx(btn({ variant: "primary", size: "lg" }), "hidden py-2.5 min-[900px]:inline-flex")}>Enroll Now</a>
            <ThemeToggle />
            <button className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink min-[900px]:hidden" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="flex flex-col gap-1 border-b border-line bg-surface px-5 pb-5 pt-3 shadow-card min-[900px]:hidden">
            {NAV.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className="rounded-lg px-3.5 py-3 font-semibold text-muted hover:text-brand">{label}</a>
            ))}
          </nav>
        )}
      </header>

      {/* HERO */}
      <section id="home" className="relative overflow-hidden py-14 sm:py-20 lg:py-24">
        <div className="mx-auto grid max-w-[1180px] items-center gap-9 px-5 sm:px-10 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
          <div ref={colRef} className="reveal">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.16em] text-brand before:h-0.5 before:w-6 before:rounded before:bg-accent">Serving the Community Since 1954</span>
            <h1 ref={titleRef} className="mt-5 whitespace-nowrap font-display font-semibold text-ink">Nurturing <em className="not-italic italic text-brand">faith</em>, character &amp; knowledge.</h1>
            <p className="mt-3.5 font-ar text-2xl font-bold text-accent sm:text-3xl" dir="rtl">مدرسة إعلام الدين</p>
            <p className="mt-5 max-w-[46ch] text-[17px] text-muted sm:text-lg">Ihlamudheen Madrasa is a place where the Qur'an, sound belief and noble character are taught with love — grounding every student in the light of the Deen while preparing them for a purposeful life.</p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href="#admissions" className={btn({ variant: "primary", size: "lg" })}>Begin Admission <ArrowRight size={16} /></a>
              <a href="#programs" className={btn({ variant: "ghost", size: "lg" })}>Explore Programs</a>
            </div>
            <div className="mt-10 flex flex-wrap gap-7">
              {[["70+", "Years of Service"], ["800+", "Students Taught"], ["25+", "Qualified Teachers"]].map(([n, l]) => (
                <div key={l} className="flex flex-col"><b className="font-display text-3xl font-semibold text-brand">{n}</b><span className="text-[13px] font-semibold text-muted">{l}</span></div>
              ))}
            </div>
          </div>

          <div className="reveal relative grid place-items-center">
            <div aria-hidden className="absolute inset-0 m-auto aspect-square w-[min(115%,520px)] blur-md" style={{ background: "radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--brand) 30%, transparent), transparent 62%)" }} />
            <div className="relative z-[2] aspect-square w-[min(80%,420px)] overflow-hidden rounded-[32px] border border-line bg-surface shadow-lift lg:w-[min(100%,440px)]">
              <img className="logo-light h-full w-full object-cover" src="/Logo of Ihlamudheen Madrasa light.png" alt="Ihlamudheen Madrasa calligraphic logo" />
              <img className="logo-dark h-full w-full object-cover" src="/Logo of Ihlamudheen Madrasa dark.png" alt="Ihlamudheen Madrasa calligraphic logo" />
            </div>
            <div className="absolute -bottom-3.5 right-0 z-[3] flex items-center gap-2 rounded-2xl bg-accent px-4 py-3 text-[13.5px] font-extrabold text-[#3a2a05] shadow-lg lg:-right-2"><Check size={16} /> Admissions Open 2026</div>
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <section className="bg-navy" style={{ background: "var(--navy)" }}>
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-6 px-5 py-12 text-center sm:px-10 md:grid-cols-4">
          {[["800+", "Students Enrolled"], ["25+", "Qualified Teachers"], ["70+", "Years of Service"], ["100%", "Value-Based Learning"]].map(([n, l]) => (
            <div key={l} className="reveal"><b className="block font-display text-4xl font-semibold text-accent sm:text-5xl">{n}</b><span className="text-sm font-semibold text-white/70">{l}</span></div>
          ))}
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="py-16 sm:py-24">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-5 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="reveal">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.16em] text-brand before:h-0.5 before:w-6 before:rounded before:bg-accent">About the Madrasa</span>
            <h2 className="mt-3.5 text-balance font-display text-3xl font-semibold sm:text-[42px]">A foundation built on the Book and the Sunnah.</h2>
            <p className="mt-4 font-display text-xl font-medium leading-snug text-ink">Ihlamudheen Madrasa — <span className="font-ar" dir="rtl">مدرسة إعلام الدين</span> — carries a simple mission: to make the guidance of Islam clear, beloved, and lived.</p>
            <p className="mt-4 text-[17px] text-muted">Founded in 1954 by a group of dedicated scholars and community elders, the madrasa began with a handful of children learning the Qur'an under a single roof. Over seventy years later it serves hundreds of students across structured levels.</p>
            <p className="mt-4 text-[17px] text-muted">Our teaching blends time-honoured tradition with a caring, child-centred approach. Every student is known by name, guided with patience, and encouraged to grow in both knowledge and character.</p>

            <div className="mt-9 grid grid-cols-[auto_1fr] items-center gap-5 rounded-2xl border border-line bg-surface p-6 shadow-soft" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--brand) 10%, var(--surface)), var(--surface))" }}>
              <div className="grid h-16 w-16 place-items-center rounded-full bg-brand font-display text-2xl font-semibold text-white" aria-hidden>ع</div>
              <div>
                <blockquote className="font-display text-[17px] italic leading-snug text-ink">“We do not merely teach lessons — we plant a love for Allah and His Messenger ﷺ in the heart of every child.”</blockquote>
                <div className="mt-2.5 text-sm font-bold text-brand">— Abdul Rahim Wafy · Sadar Muallim</div>
              </div>
            </div>
          </div>

          <div className="reveal grid gap-4.5" style={{ gap: "1.125rem" }}>
            {[
              { icon: Target, t: "Our Mission", d: "To provide authentic, accessible Islamic education that strengthens faith, nurtures excellent character, and empowers students to serve their community with wisdom." },
              { icon: Eye, t: "Our Vision", d: "A generation firmly rooted in the Qur'an and Sunnah — confident in their identity, upright in conduct, and a source of goodness wherever they go." },
              { icon: Gem, t: "Our Values", d: "Sincerity (ikhlas), knowledge with action, respect for teachers and parents, kindness, discipline, and a lasting love of learning." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
                <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl text-brand" style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)" }}><Icon size={22} /></div>
                <h3 className="text-xl font-bold">{t}</h3>
                <p className="mt-2 text-[15px] text-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROGRAMS */}
      <section id="programs" className="py-16 sm:py-24">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-10">
          <div className="reveal mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.16em] text-brand before:h-0.5 before:w-6 before:rounded before:bg-accent">What We Teach</span>
            <h2 className="mt-3.5 text-balance font-display text-3xl font-semibold sm:text-[42px]">Programs &amp; Courses</h2>
            <p className="mt-4 text-lg text-muted">A complete curriculum that grows with your child — from their first words of the Qur'an to advanced Islamic studies.</p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PROGRAMS.map(({ icon: Icon, title, desc, tags }) => (
              <article key={title} className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-7 shadow-soft transition hover:-translate-y-1.5 hover:shadow-card">
                <span className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-accent transition-transform duration-300 group-hover:scale-x-100" />
                <div className="mb-4 grid h-13 w-13 place-items-center rounded-xl text-brand" style={{ background: "color-mix(in srgb, var(--brand) 12%, transparent)", height: 52, width: 52 }}><Icon size={26} /></div>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="mt-2 text-[15px] text-muted">{desc}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {tags.map((t) => (<span key={t} className="rounded-full px-2.5 py-1 text-xs font-bold text-brand" style={{ background: "color-mix(in srgb, var(--brand) 10%, transparent)" }}>{t}</span>))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ADMISSIONS + CONTACT */}
      <section id="admissions" className="py-16 sm:py-24" style={{ background: "var(--surface-2)" }}>
        <div id="contact" className="mx-auto grid max-w-[1180px] items-start gap-10 px-5 sm:px-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
          <div className="reveal">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.16em] text-brand before:h-0.5 before:w-6 before:rounded before:bg-accent">Admissions &amp; Enquiry</span>
            <h2 className="mt-3.5 text-balance font-display text-3xl font-semibold sm:text-[42px]">Join the Ihlamudheen family.</h2>
            <p className="mt-4 text-lg text-muted">Admissions for the new academic year are open. Enrolling your child takes just a few simple steps.</p>

            <div className="mt-7 grid gap-3.5">
              {STEPS.map(([t, d], i) => (
                <div key={t} className="grid grid-cols-[auto_1fr] items-start gap-4">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand font-display font-semibold text-white">{i + 1}</div>
                  <div><h4 className="font-bold">{t}</h4><p className="text-[15px] text-muted">{d}</p></div>
                </div>
              ))}
            </div>

            <div className="mt-7 grid gap-3.5 sm:grid-cols-2">
              {CONTACTS.map(([Icon, t, v]) => (
                <div key={t} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
                  <Icon size={20} className="mt-0.5 shrink-0 text-brand" />
                  <div><b className="block text-sm">{t}</b><span className="text-sm text-muted">{v}</span></div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={onEnquiry} className="reveal rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-9">
            <h3 className="font-display text-2xl font-semibold">Admission Enquiry</h3>
            <p className="mb-6 mt-1 text-sm text-muted">Fill in the details and we'll get back to you within 1–2 days, in shā' Allah.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Parent / Guardian name" name="pname" placeholder="e.g. Ahmed Ali" required />
              <Field label="Phone number" name="phone" type="tel" placeholder="+91 00000 00000" required />
              <Field label="Student's name" name="cname" placeholder="Child's full name" required />
              <Field label="Student's age" name="age" type="number" placeholder="e.g. 7" required />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[13px] font-bold">Program of interest</label>
              <select name="program" required defaultValue="" className="w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus:border-brand">
                <option value="" disabled>Select a program</option>
                {PROGRAMS.map((p) => (<option key={p.title}>{p.title}</option>))}
              </select>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[13px] font-bold">Message (optional)</label>
              <textarea name="msg" rows={3} placeholder="Any questions or preferred timings?" className="w-full resize-y rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus:border-brand" />
            </div>
            <button type="submit" className={cx(btn({ variant: "gold", size: "lg" }), "mt-5 w-full")}>Submit Enquiry <ArrowRight size={16} /></button>
            <p className="mt-2.5 text-center text-xs text-muted">Your email client will open so you can send us the details securely.</p>
          </form>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-16 text-white/75" style={{ background: "var(--navy)" }}>
        <div className="mx-auto max-w-[1180px] px-5 sm:px-10">
          <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <img className="mb-4 h-13" style={{ height: 52 }} src="/Logo of Ihlamudheen Madrasa dark.png" alt="Ihlamudheen Madrasa" />
              <p className="max-w-[34ch] text-sm">Nurturing faith, character, and knowledge — grounding every student in the light of the Deen since 1954.</p>
            </div>
            <FooterCol title="Explore" links={[["Home", "#home"], ["About Us", "#about"], ["Programs", "#programs"], ["Admissions", "#admissions"]]} />
            <FooterCol title="Programs" links={[["Qur'an & Tajweed", "#programs"], ["Hifz al-Qur'an", "#programs"], ["Islamic Studies", "#programs"], ["Arabic Language", "#programs"]]} />
            <FooterCol title="Contact" links={[["+91 00000 00000", "tel:+910000000000"], ["info@ihlamudheen.edu", "mailto:info@ihlamudheen.edu"], ["Your address, City", "#contact"], ["Daily · 6:00–9:00 AM", "#contact"]]} />
          </div>
          <div className="mt-11 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-6 text-[13.5px]">
            <span>© {new Date().getFullYear()} Ihlamudheen Madrasa. All rights reserved.</span>
            <span className="font-ar text-accent" dir="rtl">مدرسة إعلام الدين · وَقُل رَّبِّ زِدْنِي عِلْمًا</span>
          </div>
        </div>
      </footer>

      <Toaster />
    </>
  );
}

function Field({ label, name, type = "text", placeholder, required }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-bold">{label}</label>
      <input name={name} type={type} placeholder={placeholder} required={required} className="w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none transition focus:border-brand" />
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<readonly [string, string]> }) {
  return (
    <div>
      <h5 className="mb-4 text-[13px] font-bold uppercase tracking-[0.12em] text-white">{title}</h5>
      <ul className="grid gap-2.5">
        {links.map(([label, href]) => (<li key={label}><a href={href} className="text-[14.5px] text-white/75 transition hover:text-accent">{label}</a></li>))}
      </ul>
    </div>
  );
}
