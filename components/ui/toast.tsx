"use client";

import { useEffect, useState } from "react";

type ToastDetail = { msg: string; err?: boolean };

export function toast(msg: string, err = false) {
  window.dispatchEvent(new CustomEvent<ToastDetail>("app-toast", { detail: { msg, err } }));
}

export function Toaster() {
  const [state, setState] = useState<{ msg: string; err: boolean; show: boolean }>({
    msg: "",
    err: false,
    show: false,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      setState({ msg: d.msg, err: !!d.err, show: true });
      clearTimeout(timer);
      timer = setTimeout(() => setState((s) => ({ ...s, show: false })), 3200);
    };
    window.addEventListener("app-toast", handler);
    return () => {
      window.removeEventListener("app-toast", handler);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full px-5 py-3 text-sm font-semibold shadow-card transition-all duration-300 " +
        (state.show ? "translate-y-0 opacity-100 " : "translate-y-5 opacity-0 ") +
        (state.err ? "bg-bad text-white" : "bg-ink text-bg")
      }
    >
      {state.msg}
    </div>
  );
}
