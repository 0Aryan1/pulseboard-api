import { jest } from "@jest/globals";
import fs from "node:fs/promises";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";

const mockEmitToProject = jest.fn();
const mockQueueAdd = jest.fn();

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: mockEmitToProject,
  removeUserFromProject: jest.fn(),
  closeProjectRoom: jest.fn(),
}));

// No worker runs during tests, so jobs are captured instead of sent to Redis.
jest.unstable_mockModule("../src/queue.js", () => ({
  connection: {},
  UPLOAD_QUEUE_NAME: "uploadQueue",
  uploadQueue: { add: mockQueueAdd },
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/prisma.js");

const api = request(app);

const PNG_CONTENT = Buffer.from("fake png content for tests");

describe("Attachments API integration", () => {
  let owner;
  let member;
  let outsider;
  let projectId;
  let taskId;
  let otherTaskId;
  const uploadedFiles = [];

  const attachmentsUrl = (id = taskId) => `/api/v1/tasks/${id}/attachments`;

  async function fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function createTask(title) {
    const response = await api
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title, description: "Created for attachment tests", status: "Pending" });

    expect(response.statusCode).toBe(201);

    return response.body.data.id;
  }

  async function upload(user = member, id = taskId, filename = "diagram.png") {
    const response = await api
      .post(attachmentsUrl(id))
      .set("Authorization", `Bearer ${user.token}`)
      .attach("file", PNG_CONTENT, { filename, contentType: "image/png" });

    if (response.body.data?.file_url) {
      uploadedFiles.push(response.body.data.file_url);
    }

    return response;
  }

  async function uploadAttachment(...args) {
    const response = await upload(...args);

    expect(response.statusCode).toBe(201);

    return response.body.data;
  }

  beforeAll(async () => {
    owner = await createTestUser(api, "Attachments Owner");
    member = await createTestUser(api, "Attachments Member");
    outsider = await createTestUser(api, "Attachments Outsider");

    const projectResponse = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Attachments test project",
        description: "Created by the attachments integration tests",
      });

    expect(projectResponse.statusCode).toBe(201);
    projectId = projectResponse.body.data.id;

    const memberResponse = await api
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: member.id, role: "Member" });

    expect(memberResponse.statusCode).toBe(201);

    taskId = await createTask("Task with attachments");
    otherTaskId = await createTask("Another task");
  });

  afterAll(async () => {
    await Promise.all(uploadedFiles.map((file) => fs.rm(file, { force: true })));
    await deleteTestUsers(prisma, [owner, member, outsider]);
    await prisma.$disconnect();
  });

  describe("POST /attachments", () => {
    test("stores the file and queues it for processing", async () => {
      const response = await upload();

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);

      const attachment = response.body.data;

      expect(attachment.file_name).toBe("diagram.png");
      expect(attachment.task_id).toBe(taskId);
      expect(attachment.status).toBe("processing");
      expect(attachment.uploaded_by).toBe(member.id);
      expect(await fs.readFile(attachment.file_url)).toEqual(PNG_CONTENT);

      expect(mockQueueAdd).toHaveBeenCalledWith("processUpload", {
        attachmentId: attachment.id,
        taskId,
        projectId,
        fileName: "diagram.png",
        filePath: attachment.file_url,
      });
      expect(mockEmitToProject).toHaveBeenCalledWith(
        projectId,
        "attachmentCreated",
        expect.objectContaining({ id: attachment.id }),
      );
    });

    test("returns 400 when no file is sent", async () => {
      const response = await api
        .post(attachmentsUrl())
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("FILE_REQUIRED");
      expect(response.body.error.message).toBe("Please upload a file");
    });

    test("rejects an unsupported file type", async () => {
      const beforeCount = await prisma.attachments.count({
        where: { task_id: taskId },
      });

      const response = await api
        .post(attachmentsUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .attach("file", Buffer.from("plain text"), {
          filename: "notes.txt",
          contentType: "text/plain",
        });

      if (response.body.data?.file_url) {
        uploadedFiles.push(response.body.data.file_url);
      }

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("FILE_ERROR");
      expect(response.body.error.message).toBe("Unsupported file type");

      const afterCount = await prisma.attachments.count({
        where: { task_id: taskId },
      });

      expect(afterCount).toBe(beforeCount);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    test("rejects a file larger than 5 MB", async () => {
      const response = await api
        .post(attachmentsUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .attach("file", Buffer.alloc(5 * 1024 * 1024 + 1), {
          filename: "huge.png",
          contentType: "image/png",
        });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("FILE_ERROR");
      expect(response.body.error.message).toBe("File too large");
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    test("rejects a user who is not a member of the task's project", async () => {
      const response = await upload(outsider);

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    test("marks the attachment failed when it cannot be queued", async () => {
      mockQueueAdd.mockRejectedValueOnce(new Error("Redis unavailable"));

      const beforeIds = (
        await prisma.attachments.findMany({ where: { task_id: taskId } })
      ).map((attachment) => attachment.id);

      const response = await upload();

      expect(response.statusCode).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");

      const newAttachments = await prisma.attachments.findMany({
        where: { task_id: taskId, id: { notIn: beforeIds } },
      });

      expect(newAttachments).toHaveLength(1);
      uploadedFiles.push(newAttachments[0].file_url);
      expect(newAttachments[0].status).toBe("failed");
      expect(mockEmitToProject).toHaveBeenCalledWith(
        projectId,
        "attachmentCreated",
        expect.objectContaining({ id: newAttachments[0].id, status: "failed" }),
      );
    });
  });

  describe("GET /attachments", () => {
    test("lists only the task's attachments", async () => {
      const attachment = await uploadAttachment();
      const otherAttachment = await uploadAttachment(member, otherTaskId);

      const response = await api
        .get(attachmentsUrl())
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);

      const ids = response.body.data.map((item) => item.id);

      expect(ids).toContain(attachment.id);
      expect(ids).not.toContain(otherAttachment.id);
    });

    test("returns a single attachment", async () => {
      const attachment = await uploadAttachment();

      const response = await api
        .get(`${attachmentsUrl()}/${attachment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data.id).toBe(attachment.id);
      expect(response.body.data.file_name).toBe("diagram.png");
    });

    test("returns 404 for an attachment of a different task", async () => {
      const otherAttachment = await uploadAttachment(member, otherTaskId);

      const response = await api
        .get(`${attachmentsUrl()}/${otherAttachment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("Attachment not found");
    });

    test("rejects a non-member", async () => {
      const response = await api
        .get(attachmentsUrl())
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.data).toBeUndefined();
    });
  });

  describe("invalid attachment ids", () => {
    test.each([
      ["GET", "get", ""],
      ["GET download", "get", "/download"],
      ["DELETE", "delete", ""],
    ])("%s returns 400 when the attachment id is not a number", async (_, method, suffix) => {
      const response = await api[method](`${attachmentsUrl()}/abc${suffix}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid task or attachment ID");
      expect(response.body.error.details).toEqual([]);
    });
  });

  describe("GET /attachments/:attachmentId/download", () => {
    test("returns 404 when the attachment does not exist", async () => {
      const response = await api
        .get(`${attachmentsUrl()}/999999999/download`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("Attachment not found");
    });

    test("refuses a file that is still processing", async () => {
      const attachment = await uploadAttachment();

      const response = await api
        .get(`${attachmentsUrl()}/${attachment.id}/download`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("ATTACHMENT_NOT_READY");
      expect(response.body.error.message).toBe(
        "This file is still being processed",
      );
    });

    test("refuses a file that failed processing", async () => {
      const attachment = await uploadAttachment();
      await prisma.attachments.update({
        where: { id: attachment.id },
        data: { status: "failed" },
      });

      const response = await api
        .get(`${attachmentsUrl()}/${attachment.id}/download`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("ATTACHMENT_NOT_READY");
      expect(response.body.error.message).toBe(
        "This file failed processing and cannot be downloaded",
      );
    });

    test("downloads a ready file under its original name", async () => {
      const attachment = await uploadAttachment(member, taskId, "report.png");
      await prisma.attachments.update({
        where: { id: attachment.id },
        data: { status: "ready" },
      });

      const response = await api
        .get(`${attachmentsUrl()}/${attachment.id}/download`)
        .set("Authorization", `Bearer ${member.token}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-disposition"]).toContain("report.png");
      expect(response.body).toEqual(PNG_CONTENT);
    });
  });

  describe("DELETE /attachments/:attachmentId", () => {
    test("lets the uploader delete their attachment", async () => {
      const attachment = await uploadAttachment(member);

      const response = await api
        .delete(`${attachmentsUrl()}/${attachment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(
        await prisma.attachments.findUnique({ where: { id: attachment.id } }),
      ).toBeNull();
      expect(await fileExists(attachment.file_url)).toBe(false);
    });

    test("rejects a Member deleting someone else's upload and keeps the file", async () => {
      const attachment = await uploadAttachment(owner);

      const response = await api
        .delete(`${attachmentsUrl()}/${attachment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "Only the uploader or an Admin can delete this attachment",
      );
      expect(
        await prisma.attachments.findUnique({ where: { id: attachment.id } }),
      ).not.toBeNull();
      expect(await fileExists(attachment.file_url)).toBe(true);
    });

    test("leaves attachments without a recorded uploader to Admins", async () => {
      const attachment = await uploadAttachment(member);
      await prisma.attachments.update({
        where: { id: attachment.id },
        data: { uploaded_by: null },
      });

      const response = await api
        .delete(`${attachmentsUrl()}/${attachment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(403);
      expect(await fileExists(attachment.file_url)).toBe(true);
    });

    test("lets an Admin delete the attachment and its file", async () => {
      const attachment = await uploadAttachment();

      const response = await api
        .delete(`${attachmentsUrl()}/${attachment.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data.id).toBe(attachment.id);
      expect(
        await prisma.attachments.findUnique({ where: { id: attachment.id } }),
      ).toBeNull();
      expect(await fileExists(attachment.file_url)).toBe(false);
      expect(mockEmitToProject).toHaveBeenCalledWith(
        projectId,
        "attachmentDeleted",
        expect.objectContaining({ id: attachment.id }),
      );
    });

    test("returns 404 when the attachment does not exist", async () => {
      const response = await api
        .delete(`${attachmentsUrl()}/999999999`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });
  });
});
