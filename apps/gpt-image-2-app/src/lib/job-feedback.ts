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
