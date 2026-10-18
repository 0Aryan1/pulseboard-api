import { jest } from "@jest/globals";

const mockFromId = jest.fn();
const mockGetAttachmentById = jest.fn();
const mockEmitToProject = jest.fn();
const handlers = {};

// Capture the queue event handlers instead of subscribing through Redis.
jest.unstable_mockModule("bullmq", () => ({
  Job: { fromId: mockFromId },
  QueueEvents: class {
    on(event, handler) {
      handlers[event] = handler;
    }
  },
}));

jest.unstable_mockModule("../src/queue.js", () => ({
  connection: {},
  uploadQueue: {},
  UPLOAD_QUEUE_NAME: "uploadQueue",
}));

jest.unstable_mockModule("../src/data/attachments.data.js", () => ({
  getAttachmentById: mockGetAttachmentById,
  ATTACHMENT_STATUS: {
    PROCESSING: "processing",
    READY: "ready",
    FAILED: "failed",
  },
}));

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: mockEmitToProject,
}));

jest.unstable_mockModule("../src/controllers/attachments.controller.js", () => ({
  invalidateAttachmentCaches: jest.fn(),
}));

const { setupUploadEvents } = await import("../src/uploadEvents.js");

setupUploadEvents();

describe("upload events", () => {
  const jobData = { attachmentId: 42, taskId: 7, projectId: 3 };

  function attachment(status) {
    return { id: 42, task_id: 7, status };
  }

  test("announces a ready attachment to its project", async () => {
    mockFromId.mockResolvedValue({ data: jobData });
    mockGetAttachmentById.mockResolvedValue(attachment("ready"));

    await handlers.completed({ jobId: "job-1" });

    expect(mockGetAttachmentById).toHaveBeenCalledWith(7, 42);
    expect(mockEmitToProject).toHaveBeenCalledWith(
      3,
      "attachmentReady",
      attachment("ready"),
    );
  });

  test("announces a failed attachment to its project", async () => {
    mockFromId.mockResolvedValue({ data: jobData });
    mockGetAttachmentById.mockResolvedValue(attachment("failed"));

    await handlers.failed({ jobId: "job-1" });

    expect(mockEmitToProject).toHaveBeenCalledWith(
      3,
      "attachmentFailed",
      attachment("failed"),
    );
  });

  test("stays quiet about a failed attempt that will be retried", async () => {
    mockFromId.mockResolvedValue({ data: jobData });
    mockGetAttachmentById.mockResolvedValue(attachment("processing"));

    await handlers.failed({ jobId: "job-1" });

    expect(mockEmitToProject).not.toHaveBeenCalled();
  });

  test("stays quiet when the attachment was deleted", async () => {
    mockFromId.mockResolvedValue({ data: jobData });
    mockGetAttachmentById.mockResolvedValue(null);

    await handlers.completed({ jobId: "job-1" });

    expect(mockEmitToProject).not.toHaveBeenCalled();
  });

  test("stays quiet when the job no longer exists", async () => {
    mockFromId.mockResolvedValue(undefined);

    await handlers.completed({ jobId: "job-1" });

    expect(mockGetAttachmentById).not.toHaveBeenCalled();
    expect(mockEmitToProject).not.toHaveBeenCalled();
  });

  test("skips jobs queued without a project id", async () => {
    mockFromId.mockResolvedValue({
      data: { attachmentId: 42, taskId: 7 },
    });

    await handlers.completed({ jobId: "job-1" });

    expect(mockGetAttachmentById).not.toHaveBeenCalled();
    expect(mockEmitToProject).not.toHaveBeenCalled();
  });

  test("logs a lookup failure instead of crashing the API", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockFromId.mockRejectedValue(new Error("Redis unavailable"));

    await expect(handlers.completed({ jobId: "job-1" })).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "Could not forward attachmentReady for job job-1:",
      expect.any(Error),
    );
    expect(mockEmitToProject).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
