import { useEffect, useRef, useState, type PointerEvent } from "react";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";

export type MaskMode = "paint" | "erase";
export type MaskExport = {
  targetImage: Blob;
  nativeMask: Blob;
  selectionHint: Blob;
  hasSelection: boolean;
};

export function MaskCanvas({
  imageUrl,
  seed,
  brushSize,
  mode,
  /** export trigger — when this value changes, we produce a Blob and fire `onExport` */
  exportKey,
  onExport,
  onClear,
  clearKey,
}: {
  imageUrl?: string;
  seed?: number;
  brushSize: number;
  mode: MaskMode;
  exportKey?: number;
  onExport?: (payload: MaskExport | null) => void;
  clearKey?: number;
  onClear?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painting, setPainting] = useState(false);
  const W = 1024;
  const H = 1024;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    onClear?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearKey]);

  useEffect(() => {
    if (exportKey == null) return;
    const c = canvasRef.current;
    if (!c) {
      onExport?.(null);
      return;
    }
    exportMaskPayload(c, imageUrl)
      .then((payload) => onExport?.(payload))
      .catch(() => onExport?.(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportKey]);

  const getPos = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  };

  const draw = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!painting) return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const p = getPos(e);
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(16,160,108,0.85)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  return (
    <div
      className="relative w-full aspect-square rounded-[10px] overflow-hidden bg-sunken border border-border"
      style={{ touchAction: "none" }}
    >
      <div className="absolute inset-0">
        {imageUrl ? (
          <img src={imageUrl} alt="reference" className="w-full h-full object-cover" />
        ) : (
          <PlaceholderImage seed={seed ?? 7} />
        )}
      </div>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.15)" }} />
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setPainting(true);
          draw(e);
        }}
        onPointerMove={draw}
        onPointerUp={(e) => {
          (e.target as Element).releasePointerCapture(e.pointerId);
          setPainting(false);
        }}
        onPointerCancel={() => setPainting(false)}
        onPointerLeave={() => setPainting(false)}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: mode === "erase" ? "cell" : "crosshair" }}
      />
      <div
        className="absolute bottom-2.5 left-2.5 px-2 py-1 bg-black/55 backdrop-blur-sm text-white text-[10.5px] font-medium rounded font-mono"
      >
        涂抹要修改的区域 · 拖动指针
      </div>
    </div>
  );
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, "image/png");
  });
}

function loadImage(src?: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (!src) {
      reject(new Error("Missing image"));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}

async function exportMaskPayload(selectionCanvas: HTMLCanvasElement, imageUrl?: string): Promise<MaskExport> {
  const width = selectionCanvas.width;
  const height = selectionCanvas.height;
  const image = await loadImage(imageUrl);

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = width;
  targetCanvas.height = height;
  const targetCtx = targetCanvas.getContext("2d");
  if (!targetCtx) throw new Error("Canvas unavailable");
  drawCover(targetCtx, image, width, height);

  const selectionCtx = selectionCanvas.getContext("2d");
  if (!selectionCtx) throw new Error("Canvas unavailable");
  const selectionData = selectionCtx.getImageData(0, 0, width, height);

  const nativeMaskCanvas = document.createElement("canvas");
  nativeMaskCanvas.width = width;
  nativeMaskCanvas.height = height;
  const nativeMaskCtx = nativeMaskCanvas.getContext("2d");
  if (!nativeMaskCtx) throw new Error("Canvas unavailable");
  const nativeMask = nativeMaskCtx.createImageData(width, height);
  let selectedPixels = 0;
  for (let i = 0; i < nativeMask.data.length; i += 4) {
    const selected = selectionData.data[i + 3] > 8;
    if (selected) selectedPixels += 1;
    nativeMask.data[i] = 255;
    nativeMask.data[i + 1] = 255;
    nativeMask.data[i + 2] = 255;
    nativeMask.data[i + 3] = selected ? 0 : 255;
  }
  nativeMaskCtx.putImageData(nativeMask, 0, 0);

  const hintCanvas = document.createElement("canvas");
  hintCanvas.width = width;
  hintCanvas.height = height;
  const hintCtx = hintCanvas.getContext("2d");
  if (!hintCtx) throw new Error("Canvas unavailable");
  hintCtx.drawImage(targetCanvas, 0, 0);
  hintCtx.drawImage(selectionCanvas, 0, 0);

  return {
    targetImage: await canvasToBlob(targetCanvas),
    nativeMask: await canvasToBlob(nativeMaskCanvas),
    selectionHint: await canvasToBlob(hintCanvas),
    hasSelection: selectedPixels > 0,
  };
}
