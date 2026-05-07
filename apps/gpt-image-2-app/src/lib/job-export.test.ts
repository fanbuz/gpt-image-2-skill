import { describe, expect, it } from "vitest";
import { jobExportBaseName, outputFileName, safeFilenamePart } from "./job-export";
import type { Job } from "./types";

describe("job export naming", () => {
  it("sanitizes prompt and job id for task directories", () => {
    expect(safeFilenamePart('  hero / poster: "launch"?  ')).toBe(
      "hero-poster-launch",
    );
    expect(safeFilenamePart("")).toBe("untitled");
  });

  it("uses date time, prompt prefix, and job id", () => {
    const job: Job = {
      id: "web/job:42",
      command: "images generate",
      provider: "mock",
      status: "completed",
      created_at: "1714521600",
      updated_at: "1714521600",
      metadata: { prompt: "A tall product shot / white bg" },
      outputs: [],
      error: null,
    };

    expect(jobExportBaseName(job)).toBe(
      "20240501-000000-A-tall-product-shot-white-bg-web-job-42",
    );
  });

  it("keeps output extensions while making filenames safe", () => {
    expect(outputFileName("/tmp/result one.png", 0)).toBe("result-one.png");
    expect(outputFileName("", 2)).toBe("image-03.png");
  });
});
