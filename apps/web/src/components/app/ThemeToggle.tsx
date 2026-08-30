"use client";

import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "./icons";

type Choice = "light" | "dark" | null;

function read(): Choice {
  try {
    const v = localStorage.getItem("snow-theme");
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setChoice(read());
    setMounted(true);
  }, []);

  function apply(next: Choice) {
    setChoice(next);
    try {
      if (next) localStorage.setItem("snow-theme", next);
      else localStorage.removeItem("snow-theme");
    } catch {
      /* private mode — ignore */
    }
    const root = document.documentElement;
    if (next) root.setAttribute("data-theme", next);
    else root.removeAttribute("data-theme");
  }

  // Resolve what "the other theme" is, defaulting from the OS when unset.
  const prefersDark =
    mounted && typeof matchMedia === "function"
      ? matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const effectiveDark = choice ? choice === "dark" : prefersDark;

  return (
    <button
      className="iconbtn"
      type="button"
      aria-label={effectiveDark ? "Switch to light theme" : "Switch to dark theme"}
      title={effectiveDark ? "Light theme" : "Dark theme"}
      onClick={() => apply(effectiveDark ? "light" : "dark")}
    >
      {effectiveDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

/** Inline script (runs before paint) to avoid a theme flash. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('snow-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
