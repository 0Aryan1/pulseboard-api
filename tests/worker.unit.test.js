import { jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mockUpdateAttachmentStatus = jest.fn();
const mockWorkerClose = jest.fn();
const mockDisconnect = jest.fn();
let processJob;

// Capture the processor the worker registers instead of connecting to Redis.
jest.unstable_mockModule("bullmq", () => ({
  Worker: class {
    constructor(queueName, processor) {
      processJob = processor;
    }

    on() {}

    close() {
      return mockWorkerClose();
    }
  },
}));

jest.unstable_mockModule("../src/prisma.js", () => ({
  default: { $disconnect: mockDisconnect },
}));

jest.unstable_mockModule("../src/queue.js", () => ({
  connection: {},
  UPLOAD_QUEUE_NAME: "uploadQueue",
}));

jest.unstable_mockModule("../src/data/attachments.data.js", () => ({
  updateAttachmentStatus: mockUpdateAttachmentStatus,
  ATTACHMENT_STATUS: {
    PROCESSING: "processing",
    READY: "ready",
    FAILED: "failed",
  },
}));

// Capture the worker's signal handlers instead of letting them see real signals.
const signalHandlers = {};
const originalOn = process.on.bind(process);
const processOn = jest.spyOn(process, "on").mockImplementation((event, handler) => {
  if (event === "SIGTERM" || event === "SIGINT") {
    signalHandlers[event] = handler;
    return process;
  }
  return originalOn(event, handler);
});

await import("../src/worker.js");

processOn.mockRestore();

describe("upload worker shutdown", () => {
  test("finishes the current job and disconnects before exiting, once", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation(() => {});
    let finishJob;
    mockWorkerClose.mockReturnValue(new Promise((resolve) => (finishJob = resolve)));

    signalHandlers.SIGTERM();
    signalHandlers.SIGINT();

    // Still waiting for the job in progress.
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();

    finishJob();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    exit.mockRestore();
  });
});

describe("upload worker", () => {
  let tempDir;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulseboard-worker-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function job({ filePath, attempts, attemptsMade = 0 }) {
    return {
      id: "job-1",
      data: { attachmentId: 42, filePath },
      opts: attempts === undefined ? {} : { attempts },
      attemptsMade,
    };
  }

  test("marks the attachment ready when the file exists", async () => {
    const filePath = path.join(tempDir, "upload.png");
    await fs.writeFile(filePath, "content");

    const result = await processJob(job({ filePath }));

    expect(result).toEqual({ success: true });
    expect(mockUpdateAttachmentStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateAttachmentStatus).toHaveBeenCalledWith(42, "ready");
  });

  test("marks the attachment failed when the file is missing on the only attempt", async () => {
    const filePath = path.join(tempDir, "missing.png");

    await expect(processJob(job({ filePath }))).rejects.toThrow();

    expect(mockUpdateAttachmentStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateAttachmentStatus).toHaveBeenCalledWith(42, "failed");
  });

  test("leaves the status alone when a retry is still coming", async () => {
    const filePath = path.join(tempDir, "missing.png");

    await expect(
      processJob(job({ filePath, attempts: 3, attemptsMade: 0 })),
    ).rejects.toThrow();

    expect(mockUpdateAttachmentStatus).not.toHaveBeenCalled();
  });

  test("marks the attachment failed on the last retry", async () => {
    const filePath = path.join(tempDir, "missing.png");

    await expect(
      processJob(job({ filePath, attempts: 3, attemptsMade: 2 })),
    ).rejects.toThrow();

    expect(mockUpdateAttachmentStatus).toHaveBeenCalledWith(42, "failed");
  });
});
