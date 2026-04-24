import type { TauriJobResponse } from "./api";
import type { JobEvent } from "./types";

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "任务执行失败";
}

export function responseOutputCount(response: TauriJobResponse) {
  const jobOutputs = response.job?.outputs ?? [];
  if (jobOutputs.length > 0) return jobOutputs.length;
  const payloadOutputs = response.payload?.output?.files ?? [];
  if (payloadOutputs.length > 0) return payloadOutputs.length;
  if (response.job?.output_path || response.payload?.output?.path) return 1;
  return 0;
}

export function responseOutputPath(response: TauriJobResponse) {
  return response.job?.output_path ?? response.payload?.output?.path ?? response.payload?.output?.files?.[0]?.path;
}

export function outputCountDescription(actual: number, requested: number) {
  if (actual < 1) return "未发现输出文件";
  if (requested > 1 && actual !== requested) {
    return `请求 ${requested} 个，provider 返回 ${actual} 个`;
  }
  return actual > 1 ? `已保存 ${actual} 个输出` : "输出已保存";
}

export function outputCountMismatchMessage(actual: number, requested: number) {
  if (requested <= 1 || actual === requested) return null;
  return `已向 provider 请求 ${requested} 个输出，但 API 响应体里只有 ${actual} 个可保存图片。`;
}

export function submittedEvent(message: string): JobEvent {
  return {
    seq: 1,
    kind: "progress",
    type: "request.submitted",
    data: {
      status: "running",
      percent: 8,
      message,
    },
  };
}

export function completedEvent(response: TauriJobResponse): JobEvent {
  return response.events?.[0] ?? {
    seq: 2,
    kind: "local",
    type: "job.completed",
    data: {
      status: "completed",
      output: { path: responseOutputPath(response) },
      message: "输出已保存到本地任务目录。",
    },
  };
}

export function failedEvent(message: string): JobEvent {
  return {
    seq: 2,
    kind: "local",
    type: "job.failed",
    data: {
      status: "failed",
      message,
    },
  };
}
