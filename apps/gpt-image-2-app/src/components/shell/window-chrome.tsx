import { Suspense, lazy, type ReactNode } from "react";
import { useTweaks } from "@/hooks/use-tweaks";

const LiquidChrome = lazy(
  () => import("@/components/reactbits/backgrounds/LiquidChrome"),
);

/**
 * Top-level window chrome.
 *
 * Renders the dark liquid backdrop + WebGL LiquidChrome layer (if the
 * user keeps it on in Settings → Appearance). Children float above on
 * `relative z-[2]`. The veil layer in between dims the WebGL output so
 * working-area glass panels stay readable.
 */
export function WindowChrome({ children }: { children: ReactNode }) {
  const { tweaks } = useTweaks();
  const liquid = tweaks.liquidBackground;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* WebGL liquid layer — only when the toggle is on */}
      {liquid && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <Suspense fallback={null}>
            <LiquidChrome
              baseColor={[0.18, 0.16, 0.32]}
              speed={0.16}
              amplitude={0.52}
              frequencyX={3.0}
              frequencyY={2.2}
              interactive={false}
            />
          </Suspense>
        </div>
      )}

      {/* Veil layer — dims the WebGL output so foreground panels are readable.
          Slightly stronger when liquid is on so glass cards still pop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={
          liquid
            ? {
                background:
                  "radial-gradient(120% 90% at 50% 50%, rgba(6,6,10,0.18) 0%, rgba(6,6,10,0.62) 100%)",
              }
            : {
                backgroundImage:
                  "radial-gradient(60% 50% at 0% 0%, rgba(167,139,250,0.10) 0%, transparent 60%)," +
                  "radial-gradient(50% 50% at 100% 100%, rgba(103,232,249,0.06) 0%, transparent 60%)",
              }
        }
      />
      {/* Subtle noise overlay (only when liquid is off — the WebGL layer
          already provides plenty of grain) */}
      {!liquid && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] opacity-[0.5] mix-blend-overlay"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "3px 3px",
          }}
        />
      )}

      <div className="relative z-[2] h-full w-full">{children}</div>
    </div>
  );
}
