import { useState } from "react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import { AppToolbar } from "@/components/shell/toolbar";
import { Sidebar, type ScreenId } from "@/components/shell/sidebar";
import { TweaksPanel } from "@/components/tweaks-panel";
import { WindowChrome } from "@/components/shell/window-chrome";
import { GenerateScreen } from "@/components/screens/generate";
import { EditScreen } from "@/components/screens/edit";
import { HistoryScreen } from "@/components/screens/history";
import { ProvidersScreen } from "@/components/screens/providers";
import { useConfig } from "@/hooks/use-config";
import { useJobs } from "@/hooks/use-jobs";
import { useGlobalShortcuts } from "@/hooks/use-shortcuts";

function readInitialScreen(): ScreenId {
  try {
    const s = localStorage.getItem("gpt2.screen");
    if (s === "generate" || s === "edit" || s === "history" || s === "providers") return s;
  } catch { /* ignore */ }
  return "generate";
}

const TITLES: Record<ScreenId, { title: string; subtitle: string }> = {
  generate: { title: "图像生成", subtitle: "写提示词，生成候选并保存图片" },
  edit: { title: "图像编辑", subtitle: "上传参考图、涂抹遮罩、描述变更" },
  history: { title: "历史与图库", subtitle: "查看、保存和管理生成过的图片" },
  providers: { title: "服务商", subtitle: "管理生成图片时使用的服务" },
};

export default function App() {
  const [screen, setScreenState] = useState<ScreenId>(readInitialScreen);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: config } = useConfig();
  const { data: jobs } = useJobs();

  const setScreen = (s: ScreenId) => {
    setScreenState(s);
    try { localStorage.setItem("gpt2.screen", s); } catch { /* ignore */ }
  };

  useGlobalShortcuts({
    onCommand: () => setPaletteOpen(true),
    onScreen: (s) => setScreen(s as ScreenId),
  });

  const activeJob = jobs?.find((j) => j.status === "running");
  const running = {
    generate: activeJob?.command === "images generate",
    edit: activeJob?.command === "images edit",
  };
  const meta = TITLES[screen];

  return (
    <div className="desktop">
      <WindowChrome>
        <div className="relative flex h-full w-full">
          <Sidebar screen={screen} setScreen={setScreen} config={config} running={running} />
          <div className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
            <AppToolbar
              title={meta.title}
              subtitle={meta.subtitle}
              onOpenCommand={() => setPaletteOpen(true)}
              actions={
                <>
                  <Button variant="ghost" size="icon" icon="gear" onClick={() => setTweaksOpen((o) => !o)} title="Tweaks" />
                  <Button variant="solidDark" size="md" icon="sparkle" onClick={() => setScreen("generate")}>
                    新建生成
                  </Button>
                </>
              }
            />
            <div className="flex-1 min-h-0 relative">
              <div key={screen} className="animate-fade-in h-full">
                {screen === "generate" && <GenerateScreen config={config} onOpenEdit={() => setScreen("edit")} />}
                {screen === "edit" && <EditScreen config={config} />}
                {screen === "history" && <HistoryScreen />}
                {screen === "providers" && <ProvidersScreen config={config} />}
              </div>
              <TweaksPanel visible={tweaksOpen} onClose={() => setTweaksOpen(false)} />
            </div>
          </div>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            setScreen={setScreen}
            latestJob={jobs?.[0]}
          />
          {!config && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20 text-faint text-[13px] pointer-events-none">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-accent" />
                加载配置中…
              </div>
            </div>
          )}
          <Toaster
            position="top-right"
            closeButton
            richColors
            toastOptions={{
              style: {
                background: "var(--bg-raised)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              },
            }}
          />
        </div>
      </WindowChrome>
    </div>
  );
}
