import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Sparkles, ListChecks, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { useTweaks } from "@/hooks/use-tweaks";
import { useQueueStatus } from "@/hooks/use-jobs";
import { api, type ConfigPaths } from "@/lib/api";
import { copyText, openPath, revealPath } from "@/lib/user-actions";
import { ProvidersScreen } from "@/components/screens/providers";
import type { ServerConfig } from "@/lib/types";
import { cn } from "@/lib/cn";

type SettingsTab = "creds" | "appearance" | "runtime" | "about";

const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "creds", label: "凭证", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Sparkles },
  { id: "runtime", label: "队列与通知", icon: ListChecks },
  { id: "about", label: "关于", icon: Info },
];

const PARALLEL_OPTIONS = [1, 2, 3, 4, 6, 8].map((n) => ({
  value: String(n),
  label: String(n),
}));

const TAB_TITLES: Record<SettingsTab, { title: string; subtitle: string }> = {
  creds: {
    title: "凭证配置",
    subtitle: "管理用于图像生成的供应商和 API Key",
  },
  appearance: {
    title: "外观",
    subtitle: "液态背景、字体与界面密度",
  },
  runtime: {
    title: "队列与通知",
    subtitle: "并发上限和任务结束提示",
  },
  about: {
    title: "关于 / 数据位置",
    subtitle: "本地存放配置、历史和生成结果的路径",
  },
};

/* ── Layout primitives (panel-internal) ─────────────────── */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl overflow-hidden border border-border-faint"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      {(title || description) && (
        <header className="border-b border-border-faint px-5 py-3">
          <div className="t-h3">{title}</div>
          {description && (
            <div className="mt-0.5 text-[12px] text-muted">{description}</div>
          )}
        </header>
      )}
      <div className="divide-y divide-border-faint">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11.5px] text-muted">{description}</div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function PathRow({
  title,
  path,
  isFolder,
}: {
  title: string;
  path?: string;
  isFolder?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div
          className="mt-0.5 truncate font-mono text-[11px] text-faint"
          title={path ?? undefined}
        >
          {path ?? "—"}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="iconSm"
          icon="folder"
          disabled={!path}
          onClick={() => {
            if (!path) return;
            if (isFolder) void openPath(path);
            else void revealPath(path);
          }}
          title={isFolder ? "打开目录" : "在访达中显示"}
          aria-label={isFolder ? "打开目录" : "在访达中显示"}
        />
        <Button
          variant="ghost"
          size="iconSm"
          icon="copy"
          disabled={!path}
          onClick={() => {
            if (path) void copyText(path, "路径");
          }}
          title="复制路径"
          aria-label="复制路径"
        />
      </div>
    </div>
  );
}

/* ── Left nav ─────────────────────────────────────────── */

function SettingsNav({
  tab,
  setTab,
}: {
  tab: SettingsTab;
  setTab: (t: SettingsTab) => void;
}) {
  return (
    <aside className="flex flex-col gap-2">
      <div className="px-2 pt-1 pb-2">
        <div className="t-title text-foreground">设置</div>
      </div>
      <div className="surface-panel flex flex-col p-1.5 gap-0.5">
        {NAV.map((n) => {
          const I = n.icon;
          const active = n.id === tab;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={cn(
                "flex items-center gap-2.5 h-9 px-3 rounded-md text-[13px] transition-colors text-left",
                active
                  ? "bg-white/[.10] text-foreground border border-white/[.10]"
                  : "border border-transparent text-muted hover:text-foreground hover:bg-white/[.05]",
              )}
            >
              <I size={14} className="opacity-80" />
              <span className="flex-1">{n.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/* ── Panel header (inside the right surface) ──────────── */

function PanelHeader({ tab }: { tab: SettingsTab }) {
  const meta = TAB_TITLES[tab];
  return (
    <header className="px-6 pt-5 pb-4 border-b border-border-faint">
      <div className="t-h2 tracking-tight">{meta.title}</div>
      <div className="mt-0.5 text-[12px] text-muted">{meta.subtitle}</div>
    </header>
  );
}

/* ── Sub-panels ───────────────────────────────────────── */

function CredsPanel({ config }: { config?: ServerConfig }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <ProvidersScreen config={config} />
    </div>
  );
}

function AppearancePanel() {
  const { tweaks, setTweaks } = useTweaks();
  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
      <Section title="主题">
        <Row
          title="主题"
          description="液态深色 — 玻璃质感单一主题，强调色为紫蓝渐变。"
          control={
            <span
              className="inline-flex items-center gap-2 px-3 h-8 rounded-full text-[12.5px]"
              style={{
                background:
                  "linear-gradient(135deg, rgba(167,139,250,0.18), rgba(103,232,249,0.14))",
                border: "1px solid rgba(167,139,250,0.35)",
                color: "var(--text)",
              }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #a78bfa, #67e8f9)",
                  boxShadow: "0 0 8px rgba(167,139,250,0.6)",
                }}
              />
              Liquid
            </span>
          }
        />
        <Row
          title="液态背景"
          description="启用 WebGL 流体动画作为窗口背景。关闭后改用静态深色，节省 GPU。"
          control={
            <Toggle
              checked={tweaks.liquidBackground}
              onChange={(v) => setTweaks({ liquidBackground: v })}
            />
          }
        />
      </Section>

      <Section title="排版">
        <Row
          title="字体"
          description="系统默认读起来最自然；等宽/衬线用于强调代码或文本风格。"
          control={
            <Segmented
              value={tweaks.font}
              onChange={(v) => setTweaks({ font: v })}
              size="sm"
              ariaLabel="字体"
              options={[
                { value: "system", label: "系统" },
                { value: "mono", label: "等宽" },
                { value: "serif", label: "衬线" },
              ]}
            />
          }
        />
        <Row
          title="界面密度"
          description="紧凑减少空白，舒适更透气。"
          control={
            <Segmented
              value={tweaks.density}
              onChange={(v) => setTweaks({ density: v })}
              size="sm"
              ariaLabel="界面密度"
              options={[
                { value: "compact", label: "紧凑" },
                { value: "comfortable", label: "舒适" },
              ]}
            />
          }
        />
      </Section>
    </div>
  );
}

function RuntimePanel() {
  const { tweaks, setTweaks } = useTweaks();
  const { data: queue } = useQueueStatus();
  const running = queue?.running ?? 0;
  const queued = queue?.queued ?? 0;
  const queueSummary =
    running + queued === 0
      ? "目前没有任务在队列里"
      : `当前 ${running} 个在跑，${queued} 个排队`;

  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
      <Section
        title="队列"
        description="控制可以同时在跑的任务数量，避免一次性吃掉网络或 CPU。"
      >
        <Row
          title="并发上限"
          description={`同时最多跑几个任务。${queueSummary}。`}
          control={
            <Segmented
              value={String(tweaks.maxParallel)}
              onChange={(v) => setTweaks({ maxParallel: Number(v) })}
              size="sm"
              ariaLabel="并发上限"
              options={PARALLEL_OPTIONS}
            />
          }
        />
      </Section>

      <Section
        title="通知"
        description="任务结束时是否弹出右上角的 toast 提示。"
      >
        <Row
          title="完成时通知"
          description="任务成功完成后弹出一条 toast。"
          control={
            <Toggle
              checked={tweaks.notifyOnComplete}
              onChange={(v) => setTweaks({ notifyOnComplete: v })}
            />
          }
        />
        <Row
          title="失败/取消时通知"
          description="任务失败或被取消时弹出一条 toast。"
          control={
            <Toggle
              checked={tweaks.notifyOnFailure}
              onChange={(v) => setTweaks({ notifyOnFailure: v })}
            />
          }
        />
      </Section>
    </div>
  );
}

function AboutPanel() {
  const { data: paths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });

  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
      <Section
        title="数据位置"
        description="本地存放配置、历史和生成结果的路径。只读信息。"
      >
        <PathRow title="配置文件" path={paths?.config_file} />
        <PathRow title="历史数据库" path={paths?.history_file} />
        <PathRow title="任务输出目录" path={paths?.jobs_dir} isFolder />
        <PathRow title="配置目录" path={paths?.config_dir} isFolder />
      </Section>

      <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-faint">
        <Icon name="info" size={11} />
        <span>偏好保存在本机存储里；并发上限会实时同步到后台队列。</span>
      </div>
    </div>
  );
}

/* ── Top-level screen ─────────────────────────────────── */

export function SettingsScreen({ config }: { config?: ServerConfig } = {}) {
  const [tab, setTab] = useState<SettingsTab>("creds");

  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)] gap-5 px-6 pb-6 pt-2 overflow-hidden">
      <SettingsNav tab={tab} setTab={setTab} />

      <div className="surface-panel overflow-hidden flex flex-col min-h-0">
        <PanelHeader tab={tab} />

        {tab === "creds" && <CredsPanel config={config} />}
        {tab === "appearance" && <AppearancePanel />}
        {tab === "runtime" && <RuntimePanel />}
        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}
