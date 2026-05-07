import type { Job } from "./types";

const UNSAFE_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

function promptFromJob(job: Job) {
  const prompt = job.metadata?.prompt;
  return typeof prompt === "string" ? prompt : "";
}

export function safeFilenamePart(value: string, fallback = "untitled") {
  const compact = value
    .replace(UNSAFE_FILENAME_CHARS, " ")
    .replace(/\s+/g, "-")
    .replace(/[-.]+$/g, "")
    .replace(/^[-.]+/g, "")
    .trim();
  const sliced = Array.from(compact || fallback).slice(0, 48).join("");
  return sliced || fallback;
}

function datePrefix(value?: string) {
  const numeric =
    value && /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : NaN;
  const date = value
    ? new Date(Number.isFinite(numeric) ? numeric : value)
    : new Date();
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${safe.getUTCFullYear()}${pad(safe.getUTCMonth() + 1)}${pad(
    safe.getUTCDate(),
  )}-${pad(safe.getUTCHours())}${pad(safe.getUTCMinutes())}${pad(
    safe.getUTCSeconds(),
  )}`;
}

export function jobExportBaseName(job: Job) {
  const prompt = safeFilenamePart(promptFromJob(job));
  const jobId = safeFilenamePart(job.id, "job");
  return `${datePrefix(job.created_at)}-${prompt}-${jobId}`;
}

export function outputFileName(path: string, index: number) {
  const name = path.split(/[\\/]/).pop()?.trim();
  if (name) return safeFilenamePart(name, `image-${index + 1}.png`);
  return `image-${String(index + 1).padStart(2, "0")}.png`;
}
