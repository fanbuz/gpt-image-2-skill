import { Aperture } from "@phosphor-icons/react/Aperture";
import { BoundingBox } from "@phosphor-icons/react/BoundingBox";
import { Camera } from "@phosphor-icons/react/Camera";
import { Circle } from "@phosphor-icons/react/Circle";
import { CubeFocus } from "@phosphor-icons/react/CubeFocus";
import { FilmSlate } from "@phosphor-icons/react/FilmSlate";
import { FlowerLotus } from "@phosphor-icons/react/FlowerLotus";
import { FolderSimpleStar } from "@phosphor-icons/react/FolderSimpleStar";
import { FrameCorners } from "@phosphor-icons/react/FrameCorners";
import { ImageSquare } from "@phosphor-icons/react/ImageSquare";
import { ImagesSquare } from "@phosphor-icons/react/ImagesSquare";
import { LightbulbFilament } from "@phosphor-icons/react/LightbulbFilament";
import { MagicWand } from "@phosphor-icons/react/MagicWand";
import { Mountains } from "@phosphor-icons/react/Mountains";
import { PaintBrushBroad } from "@phosphor-icons/react/PaintBrushBroad";
import { Palette } from "@phosphor-icons/react/Palette";
import { PenNibStraight } from "@phosphor-icons/react/PenNibStraight";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { Scissors } from "@phosphor-icons/react/Scissors";
import { Shapes } from "@phosphor-icons/react/Shapes";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { StackSimple } from "@phosphor-icons/react/StackSimple";
import { Sticker } from "@phosphor-icons/react/Sticker";
import { SunHorizon } from "@phosphor-icons/react/SunHorizon";
import { TextAa } from "@phosphor-icons/react/TextAa";
import { UserFocus } from "@phosphor-icons/react/UserFocus";
import type { IconProps } from "@phosphor-icons/react/lib";
import type { ComponentType } from "react";
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

const TEMPLATE_ICON_COMPONENTS: Record<
  PromptTemplateIcon,
  ComponentType<IconProps>
> = {
  sparkle: Sparkle,
  wand: MagicWand,
  image: ImageSquare,
  camera: Camera,
  portrait: UserFocus,
  landscape: Mountains,
  palette: Palette,
  brush: PaintBrushBroad,
  edit: PencilSimple,
  mask: BoundingBox,
  frame: FrameCorners,
  cutout: Scissors,
  product: CubeFocus,
  text: TextAa,
  light: LightbulbFilament,
  cinematic: FilmSlate,
  sticker: Sticker,
  layout: StackSimple,
  cube: Shapes,
  pen: PenNibStraight,
  style: FlowerLotus,
  gallery: ImagesSquare,
  organize: FolderSimpleStar,
  generate: Aperture,
  sun: SunHorizon,
  circle: Circle,
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
  const TemplateIcon = TEMPLATE_ICON_COMPONENTS[icon] ?? Sparkle;
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
      <TemplateIcon size={iconSize} weight="duotone" aria-hidden="true" />
    </span>
  );
}
