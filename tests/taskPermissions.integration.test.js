import { jest } from "@jest/globals";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";

const mockEmitToProject = jest.fn();

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: mockEmitToProject,
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/prisma.js");
const { uploadQueue } = await import("../src/queue.js");

const api = request(app);

describe("Task permissions", () => {
  let admin;
  let creator;
  let otherMember;
  let projectId;

  const taskUrl = (taskId) => `/api/v1/projects/${projectId}/tasks/${taskId}`;

  async function createTask(user = creator) {
    const response = await api
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        title: "Original title",
        description: "Original description",
        status: "Pending",
      });

    expect(response.statusCode).toBe(201);

    return response.body.data;
  }

  async function findTask(taskId) {
    return prisma.tasks.findUnique({ where: { id: taskId } });
  }

  beforeAll(async () => {
    admin = await createTestUser(api, "Tasks Admin");
    creator = await createTestUser(api, "Task Creator");
    otherMember = await createTestUser(api, "Other Member");

    const projectResponse = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ title: "Task permissions project", description: "Creator rules" });

    expect(projectResponse.statusCode).toBe(201);
    projectId = projectResponse.body.data.id;

    for (const user of [creator, otherMember]) {
      const memberResponse = await api
        .post(`/api/v1/projects/${projectId}/members`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ userId: user.id, role: "Member" });

      expect(memberResponse.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [admin, creator, otherMember]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("PUT /tasks/:taskId", () => {
    test("lets the creator edit their task", async () => {
      const task = await createTask();

      const response = await api
        .put(taskUrl(task.id))
        .set("Authorization", `Bearer ${creator.token}`)
        .send({ title: "Creator edit", description: "Updated", status: "Pending" });

      expect(response.statusCode).toBe(200);
      expect((await findTask(task.id)).title).toBe("Creator edit");
    });

    test("rejects another Member changing the title or description", async () => {
      const task = await createTask();

      const response = await api
        .put(taskUrl(task.id))
        .set("Authorization", `Bearer ${otherMember.token}`)
        .send({ title: "Hijacked title", description: "Original description", status: "Pending" });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "Only the task's creator or an Admin can edit its title or description",
      );

      const savedTask = await findTask(task.id);

      expect(savedTask.title).toBe("Original title");
      expect(mockEmitToProject).not.toHaveBeenCalledWith(
        projectId,
        "taskUpdated",
        expect.anything(),
      );
    });

    test("lets another Member change only the status", async () => {
      const task = await createTask();

      const response = await api
        .put(taskUrl(task.id))
        .set("Authorization", `Bearer ${otherMember.token}`)
        .send({ title: "Original title", description: "Original description", status: "Completed" });

      expect(response.statusCode).toBe(200);

      const savedTask = await findTask(task.id);

      expect(savedTask.status).toBe("Completed");
      expect(savedTask.title).toBe("Original title");
      expect(savedTask.description).toBe("Original description");
    });

    test("treats a missing description as unchanged for a status change", async () => {
      const task = await createTask();

      const response = await api
        .put(taskUrl(task.id))
        .set("Authorization", `Bearer ${otherMember.token}`)
        .send({ title: "Original title", status: "In Progress" });

      expect(response.statusCode).toBe(200);
      expect((await findTask(task.id)).description).toBe("Original description");
    });

    test("lets another Member move a task that has no description", async () => {
      const createResponse = await api
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${creator.token}`)
        .send({ title: "No description", status: "Pending" });

      expect(createResponse.statusCode).toBe(201);
      const taskId = createResponse.body.data.id;

      // The web client resends `description ?? ""` with every status change.
      const response = await api
        .put(taskUrl(taskId))
        .set("Authorization", `Bearer ${otherMember.token}`)
        .send({ title: "No description", description: "", status: "Completed" });

      expect(response.statusCode).toBe(200);
      expect((await findTask(taskId)).status).toBe("Completed");
    });

    test("lets an Admin edit another user's task", async () => {
      const task = await createTask();

      const response = await api
        .put(taskUrl(task.id))
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ title: "Admin edit", description: "Moderated", status: "Pending" });

      expect(response.statusCode).toBe(200);
      expect((await findTask(task.id)).title).toBe("Admin edit");
    });
  });

  describe("DELETE /tasks/:taskId", () => {
    test("lets the creator delete their task", async () => {
      const task = await createTask();

      const response = await api
        .delete(taskUrl(task.id))
        .set("Authorization", `Bearer ${creator.token}`);

      expect(response.statusCode).toBe(200);
      expect(await findTask(task.id)).toBeNull();
    });

    test("rejects another Member deleting the task", async () => {
      const task = await createTask();

      const response = await api
        .delete(taskUrl(task.id))
        .set("Authorization", `Bearer ${otherMember.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "Only the task's creator or an Admin can delete it",
      );
      expect(await findTask(task.id)).not.toBeNull();
    });

    test("lets an Admin delete another user's task", async () => {
      const task = await createTask();

      const response = await api
        .delete(taskUrl(task.id))
        .set("Authorization", `Bearer ${admin.token}`);

      expect(response.statusCode).toBe(200);
      expect(await findTask(task.id)).toBeNull();
    });

    test("leaves a task whose creator was deleted to Admins", async () => {
      const task = await createTask(admin);
      await prisma.tasks.update({
        where: { id: task.id },
        data: { created_by: null },
      });

      const memberResponse = await api
        .delete(taskUrl(task.id))
        .set("Authorization", `Bearer ${otherMember.token}`);

      expect(memberResponse.statusCode).toBe(403);

      const adminResponse = await api
        .delete(taskUrl(task.id))
        .set("Authorization", `Bearer ${admin.token}`);

      expect(adminResponse.statusCode).toBe(200);
    });
  });
});
