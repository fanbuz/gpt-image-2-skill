import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Tweaks } from "@/lib/types";

const DEFAULT_TWEAKS: Tweaks = {
  theme: "dark",
  accent: "violet",
  font: "system",
  density: "comfortable",
  maxParallel: 2,
  notifyOnComplete: true,
  notifyOnFailure: true,
  liquidBackground: true,
  glassOpacity: 42,
};

function clampOpacity(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TWEAKS.glassOpacity;
  return Math.min(95, Math.max(5, Math.round(n)));
}

const STORAGE_KEY = "gpt2.tweaks";

type Ctx = {
  tweaks: Tweaks;
  setTweaks: (partial: Partial<Tweaks>) => void;
};

const TweaksContext = createContext<Ctx | undefined>(undefined);

function clampParallel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TWEAKS.maxParallel;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function load(): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TWEAKS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_TWEAKS,
      ...parsed,
      maxParallel: clampParallel(parsed?.maxParallel),
      // Force back to liquid theme even if older payload had light/other.
      theme: "dark",
      accent: "violet",
      liquidBackground:
        typeof parsed?.liquidBackground === "boolean"
          ? parsed.liquidBackground
          : true,
      glassOpacity: clampOpacity(parsed?.glassOpacity),
    };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [tweaks, setTweaksState] = useState<Tweaks>(load);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tweaks.theme);
    root.setAttribute("data-accent", tweaks.accent);
    root.setAttribute("data-font", tweaks.font);
    root.setAttribute("data-density", tweaks.density);
    // Glass alpha as a CSS variable so .surface-panel and friends pick it up
    root.style.setProperty(
      "--glass-alpha",
      String(tweaks.glassOpacity / 100),
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks));
    } catch {
      /* ignore */
    }
  }, [tweaks]);

  useEffect(() => {
    void invoke("set_queue_concurrency", {
      maxParallel: tweaks.maxParallel,
    }).catch(() => {
      /* backend will log; UI stays responsive */
    });
  }, [tweaks.maxParallel]);

  const setTweaks = useCallback((partial: Partial<Tweaks>) => {
    setTweaksState((prev) => {
      const next = { ...prev, ...partial };
      if (partial.maxParallel !== undefined) {
        next.maxParallel = clampParallel(partial.maxParallel);
      }
      if (partial.glassOpacity !== undefined) {
        next.glassOpacity = clampOpacity(partial.glassOpacity);
      }
      return next;
    });
  }, []);

  return createElement(
    TweaksContext.Provider,
    { value: { tweaks, setTweaks } },
    children,
  );
}

export function useTweaks() {
  const ctx = useContext(TweaksContext);
  if (!ctx) throw new Error("useTweaks must be used within TweaksProvider");
  return ctx;
}
