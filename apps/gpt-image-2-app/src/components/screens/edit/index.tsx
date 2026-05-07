import {
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Brush,
  Circle,
  Eraser,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Move,
  Plus,
  Redo2,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { GlassSelect } from "@/components/ui/select";
import { GlassCombobox } from "@/components/ui/combobox";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@/components/icon";
import { OutputTile } from "@/components/screens/shared/output-tile";
import {
  MaskCanvas,
  type MaskExport,
  type MaskHistoryState,
  type MaskMode,
  type MaskTool,
} from "./mask-canvas";
import { ReferenceImageCard, type RefImage } from "./reference-card";
import { LocalEditOnboarding } from "./local-edit-onboarding";
import ElasticSlider from "@/components/reactbits/components/ElasticSlider";
import { providerKindLabel } from "@/lib/format";
import { useCreateEdit } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTweaks } from "@/hooks/use-tweaks";
import { api } from "@/lib/api";
import { loadEditDraft, saveEditDraft } from "@/lib/drafts";
import {
  errorMessage,
  outputCountDescription,
  outputCountMismatchMessage,
  responseOutputCount,
} from "@/lib/job-feedback";
import {
  normalizeOutputCount,
  OUTPUT_COUNT_OPTIONS,
  POPULAR_SIZE_OPTIONS,
  QUALITY_OPTIONS,
  validateImageSize,
  validateOutputCount,
} from "@/lib/image-options";
import {
  effectiveOutputCount,
  providerEditRegionMode,
  providerSupportsMultipleOutputs,
  requestOutputCount,
} from "@/lib/provider-capabilities";
import {
  effectiveDefaultProvider,
  providerNames as readProviderNames,
} from "@/lib/providers";
import {
  openPath,
  revealPath,
  saveImages,
  saveJobImages,
} from "@/lib/user-actions";
import {
  SEND_TO_EDIT_EVENT,
  sendImageToEdit,
  type SendToEditPayload,
} from "@/lib/job-navigation";
import {
  isTauriRuntime,
  useGlobalImagePaste,
  useTauriImageDrop,
} from "@/hooks/use-image-ingest";
import type { ProviderConfig, ServerConfig } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  dataTransferHasImage,
  imageFilesFromDataTransfer,
  normalizeImageFiles,
  type ImageFileSource,
} from "@/lib/image-input";

type EditMode = "reference" | "region";
type RefWithFile = RefImage & { file: File };
type EditRegionMode = NonNullable<ProviderConfig["edit_region_mode"]>;
const MAX_INPUT_IMAGES = 16;
const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};
const TRANSFER_IMAGE_EXTENSION_RE =
  /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

function blobFile(blob: Blob, name: string) {
  return new File([blob], name, { type: "image/png" });
}

function basename(value?: string | null) {
  if (!value) return "";
  const clean = value.split(/[?#]/)[0] ?? "";
  return clean.split(/[\\/]/).pop()?.trim() ?? "";
}

function imageExtensionForBlob(blob: Blob, fallbackName: string) {
  const fromType = blob.type ? IMAGE_EXTENSION_BY_TYPE[blob.type] : undefined;
  if (fromType) return fromType;
  const fromName = TRANSFER_IMAGE_EXTENSION_RE.exec(fallbackName)?.[1];
  if (!fromName) return "png";
  const normalized = fromName.toLowerCase();
  return normalized === "jpeg" ? "jpg" : normalized;
}

function imageMimeFromExtension(extension: string) {
  if (extension === "jpg") return "image/jpeg";
  if (extension === "tif") return "image/tiff";
  return `image/${extension}`;
}

function transferFileName(payload: SendToEditPayload, blob: Blob) {
  const raw =
    basename(payload.name) || basename(payload.path) || basename(payload.url);
  if (raw && TRANSFER_IMAGE_EXTENSION_RE.test(raw)) return raw;
  const base =
    raw ||
    [
      "sent-to-edit",
      payload.jobId,
      payload.outputIndex == null ? undefined : payload.outputIndex + 1,
    ]
      .filter(Boolean)
      .join("-");
  return `${base}.${imageExtensionForBlob(blob, raw)}`;
}

function transferSourceUrl(payload: SendToEditPayload) {
  const pathUrl = payload.path ? api.fileUrl(payload.path) : "";
  return pathUrl || payload.url || "";
}

async function transferredImageFile(payload: SendToEditPayload) {
  const url = transferSourceUrl(payload);
  if (!url) throw new Error("这张图没有可读取的文件路径或预览地址。");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取图片失败：${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  if (blob.size <= 0) throw new Error("读取到的图片为空。");
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error("读取到的文件不是图片。");
  }
  const name = transferFileName(payload, blob);
  const extension = imageExtensionForBlob(blob, name);
  return new File([blob], name, {
    type: blob.type || imageMimeFromExtension(extension),
    lastModified: Date.now(),
  });
}

function regionModeLabel(mode: EditRegionMode) {
  if (mode === "native-mask") return "精确遮罩";
  if (mode === "reference-hint") return "软选区参考";
  return "不支持局部编辑";
}

function regionModeHint(mode: EditRegionMode) {
  if (mode === "native-mask") return "遮罩会精确作用在目标图上";
  if (mode === "reference-hint")
    return "会额外发送一张选区标记图；用户上传图片顺序保持不变";
  return "请使用多图参考，或换一个支持局部编辑的凭证";
}

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];

const COUNT_OPTIONS = OUTPUT_COUNT_OPTIONS.map((n) => ({
  value: String(n),
  label: String(n),
}));

function clampZoom(value: number) {
  return Math.min(4, Math.max(0.08, value));
}

export function EditScreen({
  config,
  active = true,
}: {
  config?: ServerConfig;
  active?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const { tweaks } = useTweaks();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<RefWithFile[]>([]);
  const dragDepthRef = useRef(0);
  const [editMode, setEditMode] = useState<EditMode>("reference");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("auto");
  const [n, setN] = useState(1);
  const [refs, setRefs] = useState<RefWithFile[]>([]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [targetRefId, setTargetRefId] = useState<string | null>(null);
  const [maskSnapshots, setMaskSnapshots] = useState<Record<string, string>>(
    {},
  );
  const [brushSize, setBrushSize] = useState(12);
  const [maskTool, setMaskTool] = useState<MaskTool>("brush");
  const [clearKey, setClearKey] = useState(0);
  const [undoKey, setUndoKey] = useState(0);
  const [redoKey, setRedoKey] = useState(0);
  const [maskHistory, setMaskHistory] = useState<MaskHistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [exportKey, setExportKey] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outputCount, setOutputCount] = useState(0);
  const [selectedOutput, setSelectedOutput] = useState(0);
  const [pendingOutputCount, setPendingOutputCount] = useState<number | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 });
  const [zoom, setZoom] = useState(1);
  const [panPinned, setPanPinned] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const promptId = useId();
  const brushSliderId = useId();
  const panMode = panPinned || spacePanning;
  const maskMode: MaskMode = maskTool === "erase" ? "erase" : "paint";
  const triggerMaskUndo = useCallback(() => setUndoKey((key) => key + 1), []);
  const triggerMaskRedo = useCallback(() => setRedoKey((key) => key + 1), []);

  useEffect(() => {
    if (
      providerNames.length > 0 &&
      (!provider || !config?.providers[provider])
    ) {
      setProvider(defaultProvider || providerNames[0]);
    }
  }, [config?.providers, defaultProvider, provider, providerNames]);

  useEffect(() => {
    if (refs.length === 0) {
      setSelectedRef(null);
      setTargetRefId(null);
      return;
    }
    if (!selectedRef || !refs.some((ref) => ref.id === selectedRef)) {
      setSelectedRef(refs[0].id);
    }
    if (!targetRefId || !refs.some((ref) => ref.id === targetRefId)) {
      setTargetRefId(refs[0].id);
    }
  }, [refs, selectedRef, targetRefId]);

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateEdit();
  const isSubmitting = exportKey != null || mutate.isPending;
  const isTracking = running;
  const isWorking = isSubmitting || isTracking;
  const providerCfg = provider ? config?.providers[provider] : undefined;
  const supportsMultipleOutputs = providerSupportsMultipleOutputs(
    config,
    provider,
  );
  const editRegionMode = providerEditRegionMode(config, provider);
  const usesRegion = editMode === "region";
  const usesNativeMask = usesRegion && editRegionMode === "native-mask";
  const usesSoftRegion = usesRegion && editRegionMode === "reference-hint";
  const regionUnavailable = usesRegion && editRegionMode === "none";
  const maxReferenceImages = MAX_INPUT_IMAGES - (usesSoftRegion ? 1 : 0);
  const referenceCountError =
    refs.length > maxReferenceImages
      ? `最多上传 ${maxReferenceImages} 张参考图。`
      : undefined;
  const sizeValidation = validateImageSize(size);
  const outputCountValidation = validateOutputCount(n);
  const parameterError =
    referenceCountError ??
    sizeValidation.message ??
    (supportsMultipleOutputs ? outputCountValidation.message : undefined);
  const safeN = normalizeOutputCount(n);
  const actualN = effectiveOutputCount(config, provider, safeN);
  const displayN =
    isWorking && pendingOutputCount != null ? pendingOutputCount : actualN;
  const selectedRefObj = refs.find((ref) => ref.id === selectedRef);
  const targetRef = refs.find((ref) => ref.id === targetRefId) ?? refs[0];

  const fitCanvasToViewport = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const padding = 32;
    const fit = Math.min(
      (viewport.clientWidth - padding) / imageSize.width,
      (viewport.clientHeight - padding) / imageSize.height,
    );
    setZoom(clampZoom(Number.isFinite(fit) && fit > 0 ? fit : 1));
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(
        0,
        (viewport.scrollWidth - viewport.clientWidth) / 2,
      );
      viewport.scrollTop = Math.max(
        0,
        (viewport.scrollHeight - viewport.clientHeight) / 2,
      );
    });
  }, [imageSize.height, imageSize.width]);
  const handleMaskImageSize = useCallback(
    (size: { width: number; height: number }) => setImageSize(size),
    [],
  );

  useEffect(() => {
    if (!supportsMultipleOutputs && n !== 1) {
      setN(1);
    }
  }, [n, supportsMultipleOutputs]);

  useEffect(() => {
    if (!active || !usesRegion) return;
    const timer = window.setTimeout(fitCanvasToViewport, 60);
    return () => window.clearTimeout(timer);
  }, [fitCanvasToViewport, targetRef?.id, usesRegion]);

  useEffect(() => {
    if (!usesRegion) return;
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest("input, textarea, select, [contenteditable='true']"),
      );
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const isModifierShortcut = event.metaKey || event.ctrlKey;
      const isUndo = isModifierShortcut && key === "z" && !event.shiftKey;
      const isRedo =
        isModifierShortcut && ((key === "z" && event.shiftKey) || key === "y");
      if (isUndo || isRedo) {
        event.preventDefault();
        if (isRedo) triggerMaskRedo();
        else triggerMaskUndo();
        return;
      }
      if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      event.preventDefault();
      setSpacePanning(true);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === " ") setSpacePanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      setSpacePanning(false);
    };
  }, [active, triggerMaskRedo, triggerMaskUndo, usesRegion]);

  useEffect(() => {
    if (!tweaks.persistCreativeDrafts) {
      setDraftLoaded(true);
      return;
    }
    let cancelled = false;
    void loadEditDraft()
      .then((draft) => {
        if (cancelled || !draft) return;
        setEditMode(draft.editMode);
        setPrompt(draft.prompt);
        setProvider(draft.provider);
        setSize(draft.size);
        setFormat(draft.format);
        setQuality(draft.quality);
        setN(draft.n);
        setRefs((prev) => {
          prev.forEach((ref) => URL.revokeObjectURL(ref.url));
          return draft.refs;
        });
        setSelectedRef(draft.selectedRef);
        setTargetRefId(draft.targetRefId);
        setBrushSize(draft.brushSize === 28 ? 12 : draft.brushSize);
        setMaskTool(
          draft.maskTool ?? (draft.maskMode === "erase" ? "erase" : "brush"),
        );
        setMaskSnapshots(draft.maskSnapshots);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setDraftLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tweaks.persistCreativeDrafts]);

  useEffect(() => {
    if (!draftLoaded || !tweaks.persistCreativeDrafts) return;
    const handle = window.setTimeout(() => {
      void saveEditDraft({
        editMode,
        prompt,
        provider,
        size,
        quality,
        format,
        n,
        refs,
        selectedRef,
        targetRefId,
        brushSize,
        maskTool,
        maskMode,
        maskSnapshots,
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [
    brushSize,
    draftLoaded,
    editMode,
    format,
    maskMode,
    maskTool,
    maskSnapshots,
    n,
    prompt,
    provider,
    quality,
    refs,
    selectedRef,
    size,
    targetRefId,
    tweaks.persistCreativeDrafts,
  ]);

  const addRefFiles = useCallback(
    (imageFiles: File[], source: ImageFileSource, ignored = 0) => {
      if (ignored > 0) {
        toast.warning("已忽略非图片文件", {
          description: `跳过 ${ignored} 个不支持的文件。`,
        });
      }
      if (imageFiles.length === 0) {
        if (ignored > 0) {
          toast.error("没有可添加的图片", {
            description: "请拖入、粘贴或选择图片文件。",
          });
        }
        return;
      }

      const additions = imageFiles.map((file, index) => ({
        id: `r-${Date.now()}-${index}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
      }));
      setRefs((prev) => {
        const available = Math.max(0, maxReferenceImages - prev.length);
        if (available === 0) {
          additions.forEach((ref) => URL.revokeObjectURL(ref.url));
          toast.error("参考图已达上限", {
            description: `最多上传 ${maxReferenceImages} 张。`,
          });
          return prev;
        }
        const accepted = additions.slice(0, available);
        additions
          .slice(available)
          .forEach((ref) => URL.revokeObjectURL(ref.url));
        if (accepted.length < additions.length) {
          toast.warning("已按上限添加参考图", {
            description: `最多上传 ${maxReferenceImages} 张。`,
          });
        }
        if (source === "drop") {
          toast.success(`已添加 ${accepted.length} 张参考图`, {
            description: "来自拖拽上传。",
          });
        }
        if (source === "paste") {
          toast.success(`已添加 ${accepted.length} 张参考图`, {
            description: "来自剪贴板。",
          });
        }
        setSelectedRef((current) => current ?? accepted[0].id);
        setTargetRefId((current) => current ?? accepted[0].id);
        return [...prev, ...accepted];
      });
    },
    [maxReferenceImages],
  );

  const addRef = (
    files: FileList | null,
    source: ImageFileSource = "picker",
  ) => {
    const result = normalizeImageFiles(files, { source });
    addRefFiles(result.files, source, result.ignored);
  };

  const handleSendToEdit = useCallback(
    async (payload: SendToEditPayload) => {
      if (refsRef.current.length >= maxReferenceImages) {
        toast.error("参考图已达上限", {
          description: `最多上传 ${maxReferenceImages} 张。`,
        });
        return;
      }
      const toastId = toast.loading("正在发送到编辑");
      try {
        const file = await transferredImageFile(payload);
        if (refsRef.current.length >= maxReferenceImages) {
          toast.error("参考图已达上限", {
            id: toastId,
            description: `最多上传 ${maxReferenceImages} 张。`,
          });
          return;
        }
        addRefFiles([file], "picker");
        toast.success("已发送到编辑", {
          id: toastId,
          description: "已作为新的参考图添加。",
        });
      } catch (error) {
        toast.error("发送到编辑失败", {
          id: toastId,
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [addRefFiles, maxReferenceImages],
  );

  useEffect(() => {
    const onSendToEdit = (event: Event) => {
      const detail = (event as CustomEvent<SendToEditPayload>).detail;
      if (!detail) return;
      void handleSendToEdit(detail);
    };
    window.addEventListener(SEND_TO_EDIT_EVENT, onSendToEdit);
    return () => window.removeEventListener(SEND_TO_EDIT_EVENT, onSendToEdit);
  }, [handleSendToEdit]);

  useGlobalImagePaste(addRefFiles);
  useTauriImageDrop(addRefFiles, setIsDraggingImages);

  const handleCanvasDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingImages(true);
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingImages(false);
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    if (isTauriRuntime()) {
      event.preventDefault();
      return;
    }
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingImages(false);
    const result = imageFilesFromDataTransfer(event.dataTransfer, "drop");
    addRefFiles(result.files, "drop", result.ignored);
  };

  const removeRef = (id: string) => {
    setRefs((prev) => {
      const removed = prev.find((ref) => ref.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      const next = prev.filter((ref) => ref.id !== id);
      if (id === selectedRef) setSelectedRef(next[0]?.id ?? null);
      if (id === targetRefId) setTargetRefId(next[0]?.id ?? null);
      setMaskSnapshots((snapshots) => {
        const { [id]: _removed, ...rest } = snapshots;
        return rest;
      });
      return next;
    });
  };

  useEffect(() => {
    refsRef.current = refs;
  }, [refs]);

  useEffect(() => {
    return () => {
      refsRef.current.forEach((ref) => URL.revokeObjectURL(ref.url));
    };
  }, []);

  const resetRunState = () => {
    setRunError(null);
    setJobId(null);
    setOutputCount(0);
    setSelectedOutput(0);
    setRunNotice(null);
  };

  const handleRun = () => {
    if (!provider || refs.length === 0 || isSubmitting) return;
    if (parameterError) {
      toast.error("参数无效", { description: parameterError });
      return;
    }
    if (regionUnavailable) {
      toast.error("当前凭证不支持局部编辑", {
        description: "请切换到「多图参考」，或换一个支持局部编辑的凭证。",
      });
      return;
    }
    if (usesRegion && !targetRef) {
      toast.error("请先选择目标图", { description: "遮罩会作用在目标图上。" });
      return;
    }

    if (usesRegion) {
      resetRunState();
      setExportKey(Date.now());
      return;
    }

    resetRunState();
    void submit(null);
  };

  const submit = async (maskPayload: MaskExport | null) => {
    const form = new FormData();
    const normalizedSize = sizeValidation.normalized ?? size;
    const plannedN = effectiveOutputCount(config, provider, safeN);
    const requestedN = requestOutputCount(config, provider, safeN);
    const meta = {
      prompt,
      provider,
      size: normalizedSize,
      format,
      quality,
      n: requestedN,
      edit_mode: editMode,
      edit_region_mode: usesRegion ? editRegionMode : "none",
      target_name: usesRegion ? targetRef?.name : undefined,
    };

    if (usesRegion) {
      if (!maskPayload) {
        setExportKey(null);
        setRunError("遮罩导出失败，请重新涂抹一次。");
        toast.error("遮罩导出失败", { description: "请重新涂抹一次。" });
        return;
      }
      if (!maskPayload.hasSelection) {
        setExportKey(null);
        setRunError("请先涂抹要修改的区域。");
        toast.error("还没有选区", {
          description: "请在目标图上涂抹要修改的区域。",
        });
        return;
      }
      if (!targetRef) {
        setExportKey(null);
        return;
      }
      if (usesNativeMask) {
        form.append("ref_00", blobFile(maskPayload.targetImage, "target.png"));
        refs
          .filter((ref) => ref.id !== targetRef.id)
          .forEach((ref, index) => {
            form.append(
              `ref_${String(index + 1).padStart(2, "0")}`,
              ref.file,
              ref.name,
            );
          });
        form.append("mask", blobFile(maskPayload.nativeMask, "mask.png"));
      }
      if (usesSoftRegion) {
        refs.forEach((ref, index) => {
          form.append(
            `ref_${String(index).padStart(2, "0")}`,
            ref.file,
            ref.name,
          );
        });
        form.append(
          "selection_hint",
          blobFile(maskPayload.selectionHint, "selection-hint.png"),
        );
      }
    } else {
      refs.forEach((ref, index) => {
        form.append(
          `ref_${String(index).padStart(2, "0")}`,
          ref.file,
          ref.name,
        );
      });
    }

    form.append("meta", JSON.stringify(meta));
    const modeText = usesRegion ? regionModeLabel(editRegionMode) : "多图参考";
    const toastId = toast.loading("正在提交任务", {
      description: `${modeText} · ${refs.length} 张图片 · ${provider}`,
    });
    setPendingOutputCount(plannedN);
    try {
      const res = await mutate.mutateAsync(form);
      const queued =
        res.queued ||
        res.job?.status === "queued" ||
        res.job?.status === "running";
      const count = queued ? plannedN : responseOutputCount(res);
      setOutputCount(count);
      setJobId(res.job_id);
      setRunNotice(queued ? null : outputCountMismatchMessage(count, plannedN));
      if (queued) {
        toast.success(
          plannedN > 1 ? `已开始编辑 ${plannedN} 张` : "已开始编辑",
          {
            id: toastId,
            description: `${modeText} · ${provider} · 完成后通知你`,
            duration: 4_000,
          },
        );
      } else {
        toast.success("编辑完成", {
          id: toastId,
          description: outputCountDescription(count, plannedN),
        });
      }
    } catch (error) {
      const message = errorMessage(error);
      setRunError(message);
      toast.error("编辑失败", { id: toastId, description: message });
    } finally {
      setPendingOutputCount(null);
      setExportKey(null);
    }
  };

  const outputRefreshKey = events.length;
  const outputs = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === selectedOutput,
    }));
  }, [jobId, outputCount, selectedOutput, outputRefreshKey]);
  const outputPaths = useMemo(() => {
    if (!jobId || outputCount < 1) return [];
    return Array.from({ length: outputCount })
      .map((_, index) => api.outputPath(jobId, index))
      .filter((path): path is string => Boolean(path));
  }, [jobId, outputCount, outputRefreshKey]);
  const selectedPath = jobId
    ? (api.outputPath(jobId, selectedOutput) ?? outputPaths[0])
    : undefined;
  const saveSelected = () => saveImages([selectedPath], "图片");
  const saveAll = () =>
    jobId ? saveJobImages(jobId, "任务图片") : saveImages(outputPaths, "图片");
  const hasOutputs =
    outputs.some((output) => output.url) || outputPaths.length > 0;

  const submitDisabled =
    isSubmitting ||
    refs.length === 0 ||
    !provider ||
    Boolean(parameterError) ||
    regionUnavailable;

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col">
      <LocalEditOnboarding active={usesRegion} />
      {/* TOOLBAR — wraps when narrow, never clips */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <Segmented
          value={editMode}
          onChange={(mode) => {
            setEditMode(mode);
            setRunError(null);
            setRunNotice(null);
          }}
          ariaLabel="编辑模式"
          size="sm"
          options={[
            { value: "reference", label: "多图参考", icon: "image" },
            { value: "region", label: "局部编辑", icon: "mask" },
          ]}
        />

        {/* Refs popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] transition-colors",
                "border bg-[color:var(--w-04)] hover:bg-[color:var(--w-07)]",
                referenceCountError
                  ? "border-[color:var(--status-err)] text-[color:var(--status-err)]"
                  : "border-border text-foreground",
              )}
            >
              <ImageIcon size={12} className="opacity-80" />
              <span>参考图</span>
              <span className="font-mono text-faint">
                {refs.length}/{maxReferenceImages}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[380px]">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[12px] font-semibold text-foreground">
                {usesRegion ? "目标图与参考图" : "参考图"}
              </div>
              <span
                className={cn(
                  "text-[10.5px] font-mono",
                  referenceCountError
                    ? "text-[color:var(--status-err)]"
                    : "text-faint",
                )}
              >
                {refs.length}/{maxReferenceImages}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {refs.map((ref) => (
                <ReferenceImageCard
                  key={ref.id}
                  ref_={ref}
                  active={ref.id === selectedRef}
                  role={
                    usesRegion
                      ? ref.id === targetRef?.id
                        ? "target"
                        : "reference"
                      : undefined
                  }
                  onSelect={() => setSelectedRef(ref.id)}
                  onSetTarget={
                    usesRegion
                      ? () => {
                          setTargetRefId(ref.id);
                          setSelectedRef(ref.id);
                        }
                      : undefined
                  }
                  onRemove={() => removeRef(ref.id)}
                />
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={refs.length >= maxReferenceImages}
                className="touch-target flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-border-strong bg-[color:var(--w-02)] text-muted hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <Plus size={16} />
                <span className="text-[10.5px]">添加</span>
              </button>
            </div>
            {usesRegion && (
              <div className="mt-3 rounded-md border border-border-faint bg-[color:var(--w-04)] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
                遮罩只作用在标记为「目标图」的图片上；其他图片只作为风格、人物或物体参考。
              </div>
            )}
          </PopoverContent>
        </Popover>

        <div className="flex-1" />

        {provider && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-foreground"
            style={{
              background: "var(--w-05)",
              border: "1px solid var(--w-10)",
            }}
            title={providerKindLabel(providerCfg?.type)}
          >
            <Icon name="cpu" size={12} style={{ color: "var(--accent)" }} />
            <span className="truncate max-w-[120px]">{provider}</span>
          </span>
        )}

        {/* Params popover */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-foreground transition-colors hover:bg-[color:var(--w-07)]"
              style={{
                background: "var(--w-05)",
                border: "1px solid var(--w-10)",
              }}
            >
              <SettingsIcon size={12} />
              参数
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] space-y-3">
            <div className="t-caps">编辑参数</div>

            <Field label="凭证">
              <GlassSelect
                value={provider}
                onValueChange={setProvider}
                options={providerNames.map((p) => ({ value: p, label: p }))}
                disabled={providerNames.length === 0}
                placeholder="（无可用凭证）"
              />
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
                <span
                  className="t-mono truncate max-w-[180px]"
                  title={providerCfg?.model ?? ""}
                >
                  {providerCfg?.model ?? "—"}
                </span>
                <span aria-hidden>·</span>
                <span className="truncate">
                  {providerKindLabel(providerCfg?.type)}
                </span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field
                label="尺寸"
                hint={!sizeValidation.ok ? sizeValidation.message : undefined}
              >
                <GlassCombobox
                  value={size}
                  onValueChange={setSize}
                  options={POPULAR_SIZE_OPTIONS}
                  placeholder="auto / 1536x1024"
                  invalid={!sizeValidation.ok}
                />
              </Field>
              <Field label="质量">
                <GlassSelect
                  value={quality}
                  onValueChange={setQuality}
                  options={QUALITY_OPTIONS}
                />
              </Field>
              <Field label="格式">
                <GlassSelect
                  value={format}
                  onValueChange={setFormat}
                  options={FORMAT_OPTIONS}
                />
              </Field>
              <Field label="数量">
                <GlassCombobox
                  value={String(n)}
                  onValueChange={(v) => setN(Number(v) || 1)}
                  options={COUNT_OPTIONS}
                  disabled={!supportsMultipleOutputs}
                  inputMode="numeric"
                  placeholder="1-10"
                />
              </Field>
            </div>

            {usesRegion && (
              <>
                <div className="pt-2 mt-1 border-t border-[color:var(--w-06)]" />
                <div className="t-caps">遮罩工具</div>
                <div className="space-y-2">
                  <div className="rounded-md border border-border-faint bg-[color:var(--w-04)] px-2.5 py-1.5 text-[11px] text-muted">
                    工具切换在画布左上角，粗细会同时作用于画笔、橡皮和形状描边。
                  </div>
                  <div className="flex items-center gap-2.5">
                    <label
                      id={`${brushSliderId}-label`}
                      className="text-[11px] text-muted shrink-0"
                    >
                      粗细
                    </label>
                    <ElasticSlider
                      id={brushSliderId}
                      value={brushSize}
                      min={2}
                      max={72}
                      step={1}
                      onChange={setBrushSize}
                      ariaLabelledBy={`${brushSliderId}-label`}
                      className="min-w-0 flex-1"
                      valueWidthClassName="w-8"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setClearKey((k) => k + 1)}
                    className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] text-muted hover:text-foreground hover:bg-[color:var(--w-05)] transition-colors"
                  >
                    <Trash2 size={11} /> 清除选区
                  </button>
                </div>
                <div className="rounded-md border border-border-faint bg-[color:var(--w-04)] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
                  {regionModeHint(editRegionMode)}
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={handleRun}
          disabled={submitDisabled}
          className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-full text-[12px] font-semibold text-foreground transition-[background,opacity] hover:opacity-95 active:translate-y-[0.5px] disabled:opacity-45 disabled:cursor-not-allowed"
          style={{
            backgroundImage: "var(--accent-gradient-fill)",
            border: "1px solid var(--accent-50)",
            boxShadow: "var(--shadow-accent-glow)",
          }}
        >
          {isSubmitting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {isSubmitting ? "提交中…" : isTracking ? "再提交" : "应用"}
        </button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          addRef(event.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />

      {refs.length > 0 && (
        <section className="shrink-0 px-4 pb-2" aria-label="参考图缩略图">
          <div className="surface-panel flex min-w-0 items-center gap-2 px-2.5 py-2">
            <div className="flex shrink-0 items-baseline gap-1.5 px-1">
              <span className="t-caps">
                {usesRegion ? "目标 / 参考" : "参考"}
              </span>
              <span
                className={cn(
                  "font-mono text-[10.5px]",
                  referenceCountError
                    ? "text-[color:var(--status-err)]"
                    : "text-faint",
                )}
              >
                {refs.length}/{maxReferenceImages}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-none pb-0.5">
              {refs.map((ref, index) => {
                const isSelected = ref.id === selectedRef;
                const isTarget = usesRegion && ref.id === targetRef?.id;
                const hasMask = Boolean(maskSnapshots[ref.id]);
                return (
                  <div key={ref.id} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedRef(ref.id)}
                      className={cn(
                        "relative h-14 w-14 overflow-hidden rounded-md border transition-[border-color,box-shadow,transform,opacity]",
                        isSelected
                          ? "border-[color:var(--accent)] shadow-[0_0_0_2px_var(--accent-faint)]"
                          : "border-border opacity-75 hover:opacity-100",
                      )}
                      title={ref.name}
                      aria-label={`查看参考图 ${index + 1}: ${ref.name}`}
                    >
                      <img
                        src={ref.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                      <span
                        className="absolute bottom-0 left-0 right-0 flex h-4 items-center justify-center text-[8.5px] font-mono text-foreground"
                        style={{
                          background:
                            "linear-gradient(to top, var(--k-72), transparent)",
                        }}
                      >
                        {index + 1}
                      </span>
                    </button>
                    <div className="pointer-events-none absolute left-1 top-1 flex gap-0.5">
                      {isTarget && (
                        <span
                          className="rounded px-1 py-px text-[8.5px] font-semibold leading-none"
                          style={{
                            background: "var(--accent)",
                            color: "var(--accent-on)",
                          }}
                        >
                          目标
                        </span>
                      )}
                      {hasMask && (
                        <span className="rounded bg-[color:var(--k-65)] px-1 py-px text-[8.5px] font-semibold leading-none text-foreground">
                          遮罩
                        </span>
                      )}
                    </div>
                    {usesRegion && !isTarget && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetRefId(ref.id);
                          setSelectedRef(ref.id);
                        }}
                        className="absolute -bottom-1 left-1/2 h-5 -translate-x-1/2 rounded-full border border-[color:var(--w-12)] bg-[color:var(--k-62)] px-2 text-[9px] font-semibold text-foreground backdrop-blur hover:bg-[color:var(--k-78)]"
                        aria-label={`把第 ${index + 1} 张设为目标图`}
                      >
                        设目标
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={refs.length >= maxReferenceImages}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong bg-[color:var(--w-03)] text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="添加参考图"
                title="添加参考图"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* CANVAS — full bleed, responsive */}
      <main className="flex-1 min-h-0 px-4 py-2 flex items-center justify-center overflow-hidden">
        <div
          className="surface-panel relative flex h-full w-full items-center justify-center overflow-hidden p-0"
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
          <motion.div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[inherit] border border-dashed",
              "bg-[color:var(--w-08)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 ease-out",
              isDraggingImages
                ? "border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent-faint),var(--shadow-accent-glow)]"
                : "border-transparent",
            )}
            animate={
              reducedMotion
                ? { opacity: isDraggingImages ? 1 : 0 }
                : {
                    opacity: isDraggingImages ? 1 : 0,
                    scale: isDraggingImages ? 1 : 0.985,
                    y: isDraggingImages ? 0 : 2,
                  }
            }
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              className="flex flex-col items-center gap-2 rounded-xl border border-border-faint bg-[color:var(--w-08)] px-4 py-3 text-center shadow-popover"
              animate={
                reducedMotion
                  ? undefined
                  : { scale: isDraggingImages ? 1.02 : 1 }
              }
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <ImageIcon size={20} style={{ color: "var(--accent)" }} />
              <div className="text-[13px] font-semibold text-foreground">
                松开添加参考图
              </div>
              <div className="text-[11px] text-muted">
                支持拖拽图片，也支持直接粘贴剪贴板图片
              </div>
            </motion.div>
          </motion.div>
          {usesRegion ? (
            targetRef ? (
              <div className="h-full w-full">
                <div
                  className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-[color:var(--accent-25)] px-2 py-1.5 backdrop-blur-xl"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(var(--accent-rgb), 0.22), rgba(var(--accent-2-rgb), 0.14)), var(--bg-raised)",
                    boxShadow:
                      "var(--shadow-floating), inset 0 1px 0 var(--w-12)",
                  }}
                >
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setMaskTool("brush")}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                        maskTool === "brush" &&
                          "bg-[color:var(--accent-18)] text-foreground",
                      )}
                      title="画笔"
                      aria-label="画笔"
                      aria-pressed={maskTool === "brush"}
                    >
                      <Brush size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskTool("erase")}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                        maskTool === "erase" &&
                          "bg-[color:var(--accent-18)] text-foreground",
                      )}
                      title="橡皮"
                      aria-label="橡皮"
                      aria-pressed={maskTool === "erase"}
                    >
                      <Eraser size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskTool("rect")}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                        maskTool === "rect" &&
                          "bg-[color:var(--accent-18)] text-foreground",
                      )}
                      title="方形选区"
                      aria-label="方形选区"
                      aria-pressed={maskTool === "rect"}
                    >
                      <Square size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskTool("ellipse")}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground",
                        maskTool === "ellipse" &&
                          "bg-[color:var(--accent-18)] text-foreground",
                      )}
                      title="圆形选区"
                      aria-label="圆形选区"
                      aria-pressed={maskTool === "ellipse"}
                    >
                      <Circle size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearKey((k) => k + 1)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--status-err-10)] hover:text-[color:var(--status-err)]"
                      title="清空选区"
                      aria-label="清空选区"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="h-5 w-px bg-border-faint" aria-hidden />
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={triggerMaskUndo}
                      disabled={!maskHistory.canUndo}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                      title="撤回"
                      aria-label="撤回"
                    >
                      <Undo2 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={triggerMaskRedo}
                      disabled={!maskHistory.canRedo}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[color:var(--w-08)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                      title="重做"
                      aria-label="重做"
                    >
                      <Redo2 size={15} />
                    </button>
                  </div>
                  <div className="h-5 w-px bg-border-faint" aria-hidden />
                  <div className="flex items-center gap-2 rounded-lg px-2 text-[11px] text-muted">
                    <span className="shrink-0">粗细</span>
                    <input
                      type="range"
                      min={2}
                      max={72}
                      step={1}
                      value={brushSize}
                      onChange={(event) =>
                        setBrushSize(Number(event.target.value))
                      }
                      className="h-5 w-24 accent-[color:var(--accent)]"
                      aria-label="选区工具粗细"
                    />
                    <span className="w-8 text-right font-mono text-faint">
                      {brushSize}
                    </span>
                  </div>
                  <div className="h-5 w-px bg-border-faint" aria-hidden />
                  <button
                    type="button"
                    onClick={fitCanvasToViewport}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] text-foreground hover:bg-[color:var(--w-08)]"
                    title="适应窗口"
                  >
                    <Maximize2 size={12} />
                    适应
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="inline-flex h-8 items-center rounded-lg px-2 font-mono text-[11px] text-foreground hover:bg-[color:var(--w-08)]"
                    title="100%"
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((current) => clampZoom(current * 0.88))
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:bg-[color:var(--w-08)]"
                    title="缩小"
                    aria-label="缩小"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((current) => clampZoom(current * 1.14))
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:bg-[color:var(--w-08)]"
                    title="放大"
                    aria-label="放大"
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanPinned((current) => !current)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] text-foreground hover:bg-[color:var(--w-08)]",
                      panPinned && "bg-[color:var(--accent-18)]",
                    )}
                    title="平移"
                    aria-pressed={panPinned}
                  >
                    <Move size={12} />
                    平移
                  </button>
                  <span className="px-1.5 font-mono text-[10.5px] text-faint">
                    {Math.round(zoom * 100)}%
                  </span>
                </div>
                <div
                  ref={canvasViewportRef}
                  className="h-full w-full overflow-auto p-4 scrollbar-thin"
                  onWheel={(event) => {
                    if (!event.metaKey && !event.ctrlKey) return;
                    event.preventDefault();
                    const next = event.deltaY < 0 ? 1.08 : 0.92;
                    setZoom((current) => clampZoom(current * next));
                  }}
                >
                  <div className="flex min-h-full min-w-full items-center justify-center">
                    <MaskCanvas
                      imageUrl={targetRef.url}
                      seed={0}
                      brushSize={brushSize}
                      mode={maskMode}
                      tool={maskTool}
                      clearKey={clearKey}
                      undoKey={undoKey}
                      redoKey={redoKey}
                      snapshot={maskSnapshots[targetRef.id]}
                      snapshotKey={targetRef.id}
                      zoom={zoom}
                      interactionMode={panMode ? "pan" : "paint"}
                      scrollContainerRef={canvasViewportRef}
                      onImageSizeChange={handleMaskImageSize}
                      onHistoryChange={setMaskHistory}
                      onSnapshotChange={(snapshot) => {
                        setMaskSnapshots((current) => {
                          if (snapshot)
                            return { ...current, [targetRef.id]: snapshot };
                          const { [targetRef.id]: _removed, ...rest } = current;
                          return rest;
                        });
                      }}
                      exportKey={exportKey ?? undefined}
                      onExport={(payload) => {
                        void submit(payload);
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <Empty
                icon="mask"
                title="请上传并设定目标图"
                subtitle="拖入图片、粘贴剪贴板图片，或点击上方「参考图」按钮添加。"
              />
            )
          ) : selectedRefObj || refs[0] ? (
            <img
              src={(selectedRefObj ?? refs[0]).url}
              alt={(selectedRefObj ?? refs[0]).name}
              className="max-h-full max-w-full object-contain rounded-md"
            />
          ) : (
            <Empty
              icon="image"
              title="请上传至少一张参考图"
              subtitle="拖入图片、粘贴剪贴板图片，或点击上方「参考图」按钮添加。"
            />
          )}
        </div>
      </main>

      {/* BOTTOM — prompt + outputs strip + error */}
      <footer className="shrink-0 px-4 pb-3 space-y-2">
        {runError && !isWorking && (
          <div className="surface-panel flex items-center gap-2 px-3 py-2 border border-[color:var(--status-err)]/40 animate-fade-up">
            <Icon
              name="warn"
              size={13}
              style={{ color: "var(--status-err)" }}
            />
            <span
              className="text-[12px] flex-1"
              style={{ color: "var(--status-err)" }}
            >
              {runError}
            </span>
            <Button variant="ghost" size="sm" icon="reload" onClick={handleRun}>
              重试
            </Button>
          </div>
        )}

        {runNotice && !isWorking && (
          <div className="surface-panel px-3 py-1.5 text-[11.5px] leading-relaxed text-muted animate-fade-up">
            {runNotice} 已保留收到的图片；如果需要补齐，可以点「应用」重试。
          </div>
        )}

        <div className="surface-panel p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <FieldLabel htmlFor={promptId}>
              {usesRegion ? "目标图选区里要变成什么" : "提示词"}
            </FieldLabel>
            <div className="flex-1" />
            <span className="text-[10.5px] font-mono text-faint">
              {prompt.length} / 4000
            </span>
          </div>
          <Textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minHeight={56}
            maxLength={4000}
            placeholder={
              usesRegion
                ? "描述目标图选区里要变成什么..."
                : "描述如何参考这些图片进行编辑..."
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                handleRun();
            }}
          />
        </div>

        {(isWorking || hasOutputs) && (
          <div className="surface-panel p-2.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-semibold text-foreground">
                {isWorking
                  ? `生成中 · ${displayN} 张`
                  : `输出 · ${outputs.length} 张`}
              </span>
              <div className="flex-1" />
              {hasOutputs && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="download"
                    onClick={saveSelected}
                  >
                    保存选中
                  </Button>
                  {outputs.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="download"
                      onClick={saveAll}
                    >
                      全部
                    </Button>
                  )}
                  {api.canRevealFiles && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="folder"
                      onClick={() => revealPath(selectedPath)}
                    >
                      位置
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
              {isWorking &&
                !hasOutputs &&
                Array.from({ length: displayN }).map((_, i) => (
                  <div
                    key={i}
                    className="shrink-0 animate-fade-up"
                    style={{ animationDelay: `${i * 65}ms` }}
                  >
                    <div
                      className="h-20 w-20 rounded-md border border-border bg-[color:var(--w-04)] flex items-center justify-center text-[10px] font-mono text-faint animate-shimmer"
                      style={{
                        background: "var(--skeleton-gradient-soft)",
                        backgroundSize: "200% 100%",
                      }}
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                  </div>
                ))}
              {hasOutputs &&
                outputs.map((output) => (
                  <div
                    key={output.index}
                    className="shrink-0 w-20 animate-fade-up"
                    style={{ animationDelay: `${output.index * 45}ms` }}
                  >
                    <OutputTile
                      output={output}
                      onSelect={() => setSelectedOutput(output.index)}
                      onDownload={() =>
                        saveImages(
                          [api.outputPath(jobId!, output.index)],
                          "图片",
                        )
                      }
                      onOpen={() =>
                        openPath(api.outputPath(jobId!, output.index))
                      }
                      onSendToEdit={() =>
                        sendImageToEdit({
                          jobId: jobId!,
                          outputIndex: output.index,
                          path: api.outputPath(jobId!, output.index),
                          url: output.url,
                        })
                      }
                    />
                  </div>
                ))}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
