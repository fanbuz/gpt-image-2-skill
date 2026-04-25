import { Settings as SettingsIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { SCREENS, type ScreenId } from "./screens";
import {
  defaultProviderLabel,
  effectiveDefaultProvider,
} from "@/lib/providers";
import type { ServerConfig } from "@/lib/types";

export function TopNav({
  screen,
  setScreen,
  config,
  running,
  onOpenCommand,
}: {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  config?: ServerConfig;
  running?: { generate: boolean; edit: boolean };
  onOpenCommand?: () => void;
}) {
  const provName = defaultProviderLabel(config);
  const provKey = effectiveDefaultProvider(config);
  const provHasKey = Boolean(provKey);

  return (
    <header className="relative h-14 shrink-0 z-30 flex items-center px-4 xl:px-5">
      {/* Left — brand chip */}
      <div className="flex items-center gap-2">
        <div
          className="inline-flex items-center gap-2 px-3 h-9 rounded-full border"
          style={{
            background: "rgba(10,10,14,0.55)",
            borderColor: "rgba(255,255,255,0.10)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <span
            className="h-3.5 w-3.5 rounded-[5px]"
            style={{
              background:
                "linear-gradient(135deg, #a78bfa 0%, #67e8f9 100%)",
              boxShadow: "0 0 10px rgba(167,139,250,0.55)",
            }}
            aria-hidden
          />
          <span className="text-[12.5px] font-semibold tracking-tight text-foreground">
            GPT Image 2
          </span>
        </div>
      </div>

      {/* Center — screen tabs */}
      <div
        className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 p-1 rounded-full border"
        style={{
          background: "rgba(8,8,12,0.6)",
          borderColor: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          boxShadow:
            "0 18px 48px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.45)",
        }}
      >
        {SCREENS.map((s) => {
          const isActive = s.id === screen;
          const isRunning =
            (s.id === "generate" && running?.generate) ||
            (s.id === "edit" && running?.edit) ||
            (s.id === "history" && (running?.generate || running?.edit));
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setScreen(s.id)}
              className={cn(
                "relative inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12.5px] font-medium transition-all",
                isActive
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-white/[.05]",
              )}
              style={
                isActive
                  ? {
                      background: "rgba(255,255,255,0.10)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
                    }
                  : undefined
              }
            >
              <span>{s.label}</span>
              {isRunning && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse-subtle"
                  style={{
                    boxShadow: "0 0 8px rgba(251,191,36,0.6)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Right — provider chip + actions */}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setScreen("settings")}
          className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium transition-colors"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: provHasKey ? "var(--text)" : "var(--text-muted)",
          }}
          title={provHasKey ? "默认凭证" : "未配置凭证 — 点击前往设置"}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: provHasKey
                ? "var(--status-ok)"
                : "var(--status-queued)",
              boxShadow: provHasKey
                ? "0 0 8px rgba(52,211,153,0.6)"
                : undefined,
            }}
            aria-hidden
          />
          <span className="truncate max-w-[140px]">{provName}</span>
        </button>

        <button
          type="button"
          onClick={onOpenCommand}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-muted hover:text-foreground transition-colors"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          aria-label="打开命令面板"
        >
          <span className="hidden lg:inline">跳转到…</span>
          <span className="kbd">⌘K</span>
        </button>

        <button
          type="button"
          onClick={() => setScreen("settings")}
          className="inline-flex items-center justify-center h-8 w-8 rounded-full text-muted hover:text-foreground transition-colors"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          aria-label="设置"
        >
          <SettingsIcon size={14} />
        </button>

        <button
          type="button"
          onClick={() => setScreen("generate")}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-[#06060a] transition-colors hover:opacity-95"
          style={{
            background: "white",
          }}
        >
          <Sparkles size={13} />
          新建生成
        </button>
      </div>
    </header>
  );
}
