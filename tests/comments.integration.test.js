import { jest } from "@jest/globals";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";

const mockEmitToProject = jest.fn();

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: mockEmitToProject,
  removeUserFromProject: jest.fn(),
  closeProjectRoom: jest.fn(),
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/prisma.js");
const { uploadQueue } = await import("../src/queue.js");

const api = request(app);

describe("Comments API integration", () => {
  let owner;
  let member;
  let otherMember;
  let outsider;
  let projectId;
  let taskId;
  let otherTaskId;

  const commentsUrl = (id = taskId) => `/api/v1/tasks/${id}/comments`;

  async function createTask(title) {
    const response = await api
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title, description: "Created for comment tests", status: "Pending" });

    expect(response.statusCode).toBe(201);

    return response.body.data.id;
  }

  async function createComment(content, user = member, id = taskId) {
    const response = await api
      .post(commentsUrl(id))
      .set("Authorization", `Bearer ${user.token}`)
      .send({ content });

    expect(response.statusCode).toBe(201);

    return response.body.data;
  }

  beforeAll(async () => {
    owner = await createTestUser(api, "Comments Owner");
    member = await createTestUser(api, "Comments Member");
    otherMember = await createTestUser(api, "Comments Other Member");
    outsider = await createTestUser(api, "Comments Outsider");

    const projectResponse = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Comments test project",
        description: "Created by the comments integration tests",
      });

    expect(projectResponse.statusCode).toBe(201);
    projectId = projectResponse.body.data.id;

    for (const user of [member, otherMember]) {
      const memberResponse = await api
        .post(`/api/v1/projects/${projectId}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: user.id, role: "Member" });

      expect(memberResponse.statusCode).toBe(201);
    }

    taskId = await createTask("Task with comments");
    otherTaskId = await createTask("Another task");
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [owner, member, otherMember, outsider]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("POST /comments", () => {
    test("creates a comment by the logged-in member", async () => {
      const response = await api
        .post(commentsUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "First comment" });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.content).toBe("First comment");
      expect(response.body.data.task_id).toBe(taskId);
      expect(response.body.data.created_by).toBe(member.id);

      const savedComment = await prisma.comments.findUnique({
        where: { id: response.body.data.id },
      });

      expect(savedComment.content).toBe("First comment");
    });

    test("does not require a user id in the request body", async () => {
      const response = await api
        .post(commentsUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "Comment without userId" });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.created_by).toBe(member.id);
    });

    test("takes the author from the token, not the request body", async () => {
      const response = await api
        .post(commentsUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "Posing as the owner", userId: owner.id });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.created_by).toBe(member.id);
    });

    test("notifies the task's project room", async () => {
      const comment = await createComment("Realtime comment");

      expect(mockEmitToProject).toHaveBeenCalledWith(
        projectId,
        "commentCreated",
        expect.objectContaining({ id: comment.id }),
      );
    });

    test("rejects empty content without saving a comment", async () => {
      const beforeCount = await prisma.comments.count({
        where: { task_id: taskId },
      });

      const response = await api
        .post(commentsUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid comment data");
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "content" })]),
      );

      const afterCount = await prisma.comments.count({
        where: { task_id: taskId },
      });

      expect(afterCount).toBe(beforeCount);
      expect(mockEmitToProject).not.toHaveBeenCalled();
    });

    test("rejects a user who is not a member of the task's project", async () => {
      const beforeCount = await prisma.comments.count({
        where: { task_id: taskId },
      });

      const response = await api
        .post(commentsUrl())
        .set("Authorization", `Bearer ${outsider.token}`)
        .send({ content: "Outsider comment" });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "You do not have access to this project",
      );

      const afterCount = await prisma.comments.count({
        where: { task_id: taskId },
      });

      expect(afterCount).toBe(beforeCount);
    });

    test("returns 404 when the task does not exist", async () => {
      const response = await api
        .post(commentsUrl(999999999))
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "Comment on nothing" });

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("Task not found");
    });

    test("returns 400 when the task id is not a number", async () => {
      const response = await api
        .post(commentsUrl("abc"))
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "Comment" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid task ID");
    });
  });

  describe("GET /comments", () => {
    test("lists the task's comments with author details", async () => {
      const comment = await createComment("Listed comment");

      const response = await api
        .get(commentsUrl())
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);

      const listedComment = response.body.data.find(
        (item) => item.id === comment.id,
      );

      expect(listedComment).toEqual(
        expect.objectContaining({
          content: "Listed comment",
          task_id: taskId,
          created_by: member.id,
          created_by_name: "Comments Member",
          created_by_email: member.email,
        }),
      );
    });

    test("does not include comments from other tasks", async () => {
      const otherComment = await createComment(
        "Comment on another task",
        member,
        otherTaskId,
      );

      const response = await api
        .get(commentsUrl())
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data.map((item) => item.id)).not.toContain(
        otherComment.id,
      );
    });

    test("rejects a non-member", async () => {
      const response = await api
        .get(commentsUrl())
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("GET /comments/:commentId", () => {
    test("returns a single comment", async () => {
      const comment = await createComment("Single comment");

      const response = await api
        .get(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data.id).toBe(comment.id);
      expect(response.body.data.content).toBe("Single comment");
    });

    test("returns 404 when the comment does not exist", async () => {
      const response = await api
        .get(`${commentsUrl()}/999999999`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("Comment not found");
    });

    test("returns 404 when the comment belongs to a different task", async () => {
      const otherComment = await createComment(
        "Comment on the other task",
        member,
        otherTaskId,
      );

      const response = await api
        .get(`${commentsUrl()}/${otherComment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("invalid comment ids", () => {
    test.each([
      ["GET", "get", "Invalid project, task, or comment ID"],
      ["PUT", "put", "Invalid task or comment ID"],
      ["DELETE", "delete", "Invalid task or comment ID"],
    ])("%s returns 400 when the comment id is not a number", async (_, method, message) => {
      const response = await api[method](`${commentsUrl()}/abc`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "Valid content" });

      expect(response.statusCode).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe(message);
    });
  });

  describe("PUT /comments/:commentId", () => {
    test("updates a comment", async () => {
      const comment = await createComment("Before edit");

      const response = await api
        .put(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "After edit" });

      expect(response.statusCode).toBe(200);
      expect(response.body.data.content).toBe("After edit");

      const savedComment = await prisma.comments.findUnique({
        where: { id: comment.id },
      });

      expect(savedComment.content).toBe("After edit");
      expect(mockEmitToProject).toHaveBeenCalledWith(
        projectId,
        "commentUpdated",
        expect.objectContaining({ id: comment.id }),
      );
    });

    test("does not update a comment through a different task", async () => {
      const otherComment = await createComment(
        "Belongs to the other task",
        member,
        otherTaskId,
      );

      const response = await api
        .put(`${commentsUrl()}/${otherComment.id}`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "Edited through the wrong task" });

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");

      const savedComment = await prisma.comments.findUnique({
        where: { id: otherComment.id },
      });

      expect(savedComment.content).toBe("Belongs to the other task");
    });

    test("rejects a Member editing someone else's comment", async () => {
      const comment = await createComment("Written by member");

      const response = await api
        .put(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${otherMember.token}`)
        .send({ content: "Edited by another member" });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "You can only edit or delete your own comments",
      );

      const savedComment = await prisma.comments.findUnique({
        where: { id: comment.id },
      });

      expect(savedComment.content).toBe("Written by member");
      expect(mockEmitToProject).not.toHaveBeenCalledWith(
        projectId,
        "commentUpdated",
        expect.anything(),
      );
    });

    test("lets an Admin edit someone else's comment", async () => {
      const comment = await createComment("Needs moderation");

      const response = await api
        .put(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ content: "Moderated by an Admin" });

      expect(response.statusCode).toBe(200);
      expect(response.body.data.content).toBe("Moderated by an Admin");
    });

    test("rejects empty content", async () => {
      const comment = await createComment("Keep this content");

      const response = await api
        .put(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ content: "" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid comment data");
    });
  });

  describe("DELETE /comments/:commentId", () => {
    test("deletes a comment", async () => {
      const comment = await createComment("Comment to delete");

      const response = await api
        .delete(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data.id).toBe(comment.id);

      const savedComment = await prisma.comments.findUnique({
        where: { id: comment.id },
      });

      expect(savedComment).toBeNull();
      expect(mockEmitToProject).toHaveBeenCalledWith(
        projectId,
        "commentDeleted",
        expect.objectContaining({ id: comment.id }),
      );
    });

    test("rejects a Member deleting someone else's comment", async () => {
      const comment = await createComment("Not yours to delete");

      const response = await api
        .delete(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${otherMember.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "You can only edit or delete your own comments",
      );

      const savedComment = await prisma.comments.findUnique({
        where: { id: comment.id },
      });

      expect(savedComment).not.toBeNull();
    });

    test("lets an Admin delete someone else's comment", async () => {
      const comment = await createComment("Removed by an Admin");

      const response = await api
        .delete(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);

      const savedComment = await prisma.comments.findUnique({
        where: { id: comment.id },
      });

      expect(savedComment).toBeNull();
    });

    test("does not delete a comment through a different task", async () => {
      const otherComment = await createComment(
        "Must survive",
        member,
        otherTaskId,
      );

      const response = await api
        .delete(`${commentsUrl()}/${otherComment.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(404);

      const savedComment = await prisma.comments.findUnique({
        where: { id: otherComment.id },
      });

      expect(savedComment).not.toBeNull();
    });

    test("rejects a non-member without deleting the comment", async () => {
      const comment = await createComment("Protected comment");

      const response = await api
        .delete(`${commentsUrl()}/${comment.id}`)
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(response.statusCode).toBe(403);

      const savedComment = await prisma.comments.findUnique({
        where: { id: comment.id },
      });

      expect(savedComment).not.toBeNull();
    });
  });
});
