import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import GlassSurface from "@/components/reactbits/components/GlassSurface";
import CountUp from "@/components/reactbits/text/CountUp";
import logoUrl from "@/assets/logo.png";
import { cn } from "@/lib/cn";
import { SCREENS, type ScreenId } from "./screens";

function isTauriRuntime() {
  return Boolean(
    typeof window !== "undefined" &&
      (window.__TAURI_INTERNALS__ || window.__TAURI__),
  );
}

function canStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  return !target.closest(
    [
      "[data-no-window-drag]",
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='tab']",
    ].join(","),
  );
}

function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || !isTauriRuntime()) return;
  if (!canStartWindowDrag(event.target)) return;
  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => {
    /* Tauri can reject dragging before the window is focused. */
  });
}

export function TopNav({
  screen,
  setScreen,
  running,
}: {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  running?: { generate: number; edit: number; total: number };
}) {
  const tauriRuntime = isTauriRuntime();

  return (
    <header
      onMouseDown={startWindowDrag}
      className={cn(
        "relative h-14 shrink-0 z-30 flex items-start pt-2",
        tauriRuntime ? "pl-[92px] pr-4 xl:pr-5" : "px-4 xl:px-5",
      )}
    >
      {/* Left — brand chip */}
      <div className="flex items-center gap-2">
        <GlassSurface
          width={196}
          height={40}
          borderRadius={50}
          borderWidth={0.07}
          backgroundOpacity={0}
          saturation={1}
          distortionScale={-180}
          blur={3.5}
          displace={0.5}
          redOffset={0}
          greenOffset={10}
          blueOffset={20}
          mixBlendMode="screen"
          className="inline-flex shrink-0"
          contentClassName="gap-2"
          contentPadding="0 14px"
        >
          <img
            src={logoUrl}
            className="h-5 w-5 object-contain drop-shadow-[0_0_10px_var(--accent-40)]"
            alt=""
            aria-hidden
          />
          <span className="text-[12.5px] font-semibold tracking-tight text-foreground">
            GPT Image 2
          </span>
        </GlassSurface>
      </div>

      {/* Center — screen tabs */}
      <GlassSurface
        data-no-window-drag
        width={348}
        height={44}
        borderRadius={50}
        borderWidth={0.07}
        backgroundOpacity={0}
        saturation={1}
        distortionScale={-180}
        blur={3.5}
        displace={0.5}
        redOffset={0}
        greenOffset={10}
        blueOffset={20}
        mixBlendMode="screen"
        className="absolute left-1/2 top-2 -translate-x-1/2"
        contentClassName="gap-0.5"
        contentPadding={4}
      >
        {SCREENS.map((s) => {
          const isActive = s.id === screen;
          const tabCount =
            s.id === "generate"
              ? (running?.generate ?? 0)
              : s.id === "edit"
                ? (running?.edit ?? 0)
                : s.id === "history"
                  ? (running?.total ?? 0)
                  : 0;
          const isRunning = tabCount > 0;
          return (
            <div
              key={s.id}
              className="shrink-0"
            >
              <button
                type="button"
                data-no-window-drag
                onClick={() => setScreen(s.id)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-all",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground hover:bg-[color:var(--w-05)]",
                )}
                style={
                  isActive
                    ? {
                        background: "rgba(255, 255, 255, 0.14)",
                        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.16)",
                      }
                    : undefined
                }
              >
                <span>{s.label}</span>
                {isRunning && (
                  <span
                    className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9.5px] font-mono font-semibold leading-none animate-pulse-subtle tabular-nums"
                    style={{
                      background: "var(--status-running-bg)",
                      color: "var(--status-running)",
                      boxShadow: "0 0 8px var(--status-running-60)",
                    }}
                    aria-label={`${tabCount} 个任务进行中`}
                  >
                    <CountUp
                      to={tabCount}
                      duration={0.5}
                      className="leading-none"
                    />
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </GlassSurface>

    </header>
  );
}
