import { Icon } from "@/components/icon";
import { cn } from "@/lib/cn";

export type RefImage = {
  id: string;
  name: string;
  url: string;
  hasMask?: boolean;
};

export function ReferenceImageCard({
  ref_,
  active,
  role,
  onSelect,
  onSetTarget,
  onRemove,
}: {
  ref_: RefImage;
  active?: boolean;
  role?: "target" | "reference";
  onSelect?: () => void;
  onSetTarget?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all bg-sunken",
        "border-[1.5px]",
        active ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]" : "border-border"
      )}
    >
      <img src={ref_.url} alt={ref_.name} className="w-full h-full object-cover" />
      <div className="absolute top-1.5 left-1.5 px-1.5 py-px rounded bg-black/55 backdrop-blur-sm text-white text-[10px] font-semibold font-mono">
        {ref_.name}
      </div>
      {role === "target" && (
        <div className="absolute top-1.5 right-1.5 px-1.5 py-px rounded bg-accent text-[color:var(--accent-on)] text-[10px] font-semibold">
          目标图
        </div>
      )}
      {role === "reference" && (
        <div className="absolute top-1.5 right-1.5 px-1.5 py-px rounded bg-black/45 text-white text-[10px] font-semibold">
          参考
        </div>
      )}
      {ref_.hasMask && (
        <div className="absolute top-7 right-1.5 px-1.5 py-px rounded bg-accent text-[color:var(--accent-on)] text-[10px] font-semibold flex items-center gap-1">
          <Icon name="mask" size={10} />遮罩
        </div>
      )}
      {onSetTarget && role !== "target" && (
        <button
          onClick={(e) => { e.stopPropagation(); onSetTarget(); }}
          className="absolute bottom-1.5 left-1.5 h-[22px] rounded bg-black/55 px-1.5 text-[10px] font-semibold text-white backdrop-blur-sm border-none"
        >
          设为目标
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
        className="absolute bottom-1.5 right-1.5 w-[22px] h-[22px] rounded bg-black/55 backdrop-blur-sm text-white border-none flex items-center justify-center"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
