import { Icon, type IconName } from "@/components/icon";
import type {
  PromptTemplateColor,
  PromptTemplateIcon,
} from "@/lib/prompt-templates";
import { cn } from "@/lib/cn";

type ColorStyle = {
  fg: string;
  bg: string;
  border: string;
};

const COLOR_STYLES: Record<PromptTemplateColor, ColorStyle> = {
  accent: {
    fg: "var(--accent)",
    bg: "var(--accent-14)",
    border: "var(--accent-35)",
  },
  cyan: {
    fg: "oklch(0.78 0.14 215)",
    bg: "oklch(0.78 0.14 215 / 0.14)",
    border: "oklch(0.78 0.14 215 / 0.36)",
  },
  violet: {
    fg: "oklch(0.78 0.16 300)",
    bg: "oklch(0.78 0.16 300 / 0.14)",
    border: "oklch(0.78 0.16 300 / 0.36)",
  },
  emerald: {
    fg: "oklch(0.76 0.15 155)",
    bg: "oklch(0.76 0.15 155 / 0.14)",
    border: "oklch(0.76 0.15 155 / 0.34)",
  },
  amber: {
    fg: "oklch(0.82 0.15 82)",
    bg: "oklch(0.82 0.15 82 / 0.14)",
    border: "oklch(0.82 0.15 82 / 0.34)",
  },
  rose: {
    fg: "oklch(0.76 0.17 15)",
    bg: "oklch(0.76 0.17 15 / 0.14)",
    border: "oklch(0.76 0.17 15 / 0.34)",
  },
  slate: {
    fg: "var(--text-muted)",
    bg: "var(--w-06)",
    border: "var(--w-14)",
  },
};

export function promptTemplateColorStyle(color: PromptTemplateColor) {
  return COLOR_STYLES[color] ?? COLOR_STYLES.accent;
}

export function PromptTemplateMark({
  icon,
  color,
  size = "md",
  className,
}: {
  icon: PromptTemplateIcon;
  color: PromptTemplateColor;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const style = promptTemplateColorStyle(color);
  const boxSize =
    size === "lg"
      ? "h-9 w-9 rounded-lg"
      : size === "sm"
        ? "h-6 w-6 rounded-md"
        : "h-8 w-8 rounded-lg";
  const iconSize = size === "lg" ? 16 : size === "sm" ? 11 : 14;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border",
        boxSize,
        className,
      )}
      style={{
        color: style.fg,
        background: style.bg,
        borderColor: style.border,
      }}
    >
      <Icon name={icon as IconName} size={iconSize} strokeWidth={1.65} />
    </span>
  );
}
