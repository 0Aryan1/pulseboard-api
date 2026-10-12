import { jest } from "@jest/globals";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: jest.fn(),
  removeUserFromProject: jest.fn(),
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/prisma.js");
const { uploadQueue } = await import("../src/queue.js");

const api = request(app);

describe("Projects API integration", () => {
  let owner;
  let member;
  let outsider;
  let projectId;

  async function createProject(user, title = "Projects test project") {
    const response = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${user.token}`)
      .send({
        userId: user.id,
        title,
        description: "Created by the projects integration tests",
      });

    expect(response.statusCode).toBe(201);

    return response.body.data;
  }

  async function addMember(projectIdToJoin, user, role) {
    const response = await api
      .post(`/api/v1/projects/${projectIdToJoin}/members`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: user.id, role });

    expect(response.statusCode).toBe(201);
  }

  beforeAll(async () => {
    owner = await createTestUser(api, "Project Owner");
    member = await createTestUser(api, "Project Member");
    outsider = await createTestUser(api, "Project Outsider");

    const project = await createProject(owner);
    projectId = project.id;

    await addMember(projectId, member, "Member");
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [owner, member, outsider]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("POST /projects", () => {
    test("creates a project and makes the creator its Admin", async () => {
      const response = await api
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          title: "New project",
          description: "Created to test project creation",
        });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe("New project");
      expect(response.body.data.owner_id).toBe(owner.id);

      const membership = await prisma.project_members.findUnique({
        where: {
          user_id_project_id: {
            user_id: owner.id,
            project_id: response.body.data.id,
          },
        },
      });

      expect(membership).not.toBeNull();
      expect(membership.role).toBe("Admin");
    });

    test("does not require a user id in the request body", async () => {
      const response = await api
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          title: "Project without userId",
          description: "The owner comes from the token",
        });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.owner_id).toBe(owner.id);
    });

    test("takes the owner from the token, not the request body", async () => {
      const response = await api
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          title: "Owner spoofing attempt",
          description: "The body names a different user",
        });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.owner_id).toBe(owner.id);

      const spoofedMembership = await prisma.project_members.findUnique({
        where: {
          user_id_project_id: {
            user_id: member.id,
            project_id: response.body.data.id,
          },
        },
      });

      expect(spoofedMembership).toBeNull();
    });

    test("rejects invalid project data without creating a project", async () => {
      const beforeCount = await prisma.projects.count({
        where: { owner_id: owner.id },
      });

      const response = await api
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: owner.id, title: "", description: "No title" });

      expect(response.statusCode).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid project data");
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "title" })]),
      );

      const afterCount = await prisma.projects.count({
        where: { owner_id: owner.id },
      });

      expect(afterCount).toBe(beforeCount);
    });

    test("rejects unauthenticated requests", async () => {
      const response = await api.post("/api/v1/projects").send({
        title: "Anonymous project",
        description: "Should not be created",
      });

      expect(response.statusCode).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("GET /projects", () => {
    test("lists the projects the user is a member of", async () => {
      const response = await api
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.map((project) => project.id)).toContain(
        projectId,
      );
    });

    test("does not list projects the user is not a member of", async () => {
      const response = await api
        .get("/api/v1/projects")
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    test("limits the number of projects returned", async () => {
      const response = await api
        .get("/api/v1/projects?page=1&limit=1")
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe("GET /projects/:projectId", () => {
    test("returns the project to a member", async () => {
      const response = await api
        .get(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(projectId);
      expect(response.body.data.owner_id).toBe(owner.id);
    });

    test("rejects a non-member", async () => {
      const response = await api
        .get(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "You do not have access to this project",
      );
    });

    test("returns 400 when the project id is not a number", async () => {
      const response = await api
        .get("/api/v1/projects/abc")
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid project ID");
    });
  });

  describe("PUT /projects/:projectId", () => {
    test("lets an Admin update the project", async () => {
      const response = await api
        .put(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ title: "Renamed project", description: "Updated description" });

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe("Renamed project");

      const savedProject = await prisma.projects.findUnique({
        where: { id: projectId },
      });

      expect(savedProject.title).toBe("Renamed project");
      expect(savedProject.description).toBe("Updated description");
    });

    test("rejects a Member without changing the project", async () => {
      const before = await prisma.projects.findUnique({
        where: { id: projectId },
      });

      const response = await api
        .put(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ title: "Member rename attempt" });

      expect(response.statusCode).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "You do not have permission to perform this action",
      );

      const after = await prisma.projects.findUnique({
        where: { id: projectId },
      });

      expect(after.title).toBe(before.title);
    });

    test("rejects invalid project data", async () => {
      const response = await api
        .put(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ title: "" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid project data");
    });
  });

  describe("DELETE /projects/:projectId", () => {
    test("rejects a Member without deleting the project", async () => {
      const response = await api
        .delete(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("FORBIDDEN");

      const savedProject = await prisma.projects.findUnique({
        where: { id: projectId },
      });

      expect(savedProject).not.toBeNull();
    });

    test("lets an Admin delete the project and its tasks", async () => {
      const project = await createProject(owner, "Project to delete");

      const taskResponse = await api
        .post(`/api/v1/projects/${project.id}/tasks`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          title: "Task in deleted project",
          description: "Should be removed with its project",
          status: "Pending",
        });

      expect(taskResponse.statusCode).toBe(201);

      const response = await api
        .delete(`/api/v1/projects/${project.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(project.id);

      const savedProject = await prisma.projects.findUnique({
        where: { id: project.id },
      });
      const savedTask = await prisma.tasks.findUnique({
        where: { id: taskResponse.body.data.id },
      });

      expect(savedProject).toBeNull();
      expect(savedTask).toBeNull();
    });
  });

  describe("PUT /projects/:projectId/owner", () => {
    test("lets the owner transfer ownership to a member", async () => {
      const project = await createProject(owner, "Project to hand over");
      await addMember(project.id, member, "Member");

      const response = await api
        .put(`/api/v1/projects/${project.id}/owner`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: member.id });

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.owner_id).toBe(member.id);

      const newOwnerMembership = await prisma.project_members.findUnique({
        where: {
          user_id_project_id: { user_id: member.id, project_id: project.id },
        },
      });

      expect(newOwnerMembership.role).toBe("Admin");
    });

    test("rejects an Admin who is not the owner", async () => {
      const project = await createProject(owner, "Project with two Admins");
      await addMember(project.id, member, "Admin");

      const response = await api
        .put(`/api/v1/projects/${project.id}/owner`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ userId: member.id });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "Only the project owner can transfer ownership",
      );

      const savedProject = await prisma.projects.findUnique({
        where: { id: project.id },
      });

      expect(savedProject.owner_id).toBe(owner.id);
    });

    test("rejects a transfer to the current owner", async () => {
      const response = await api
        .put(`/api/v1/projects/${projectId}/owner`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: owner.id });

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("ALREADY_OWNER");
    });

    test("rejects a transfer to a user who is not a member", async () => {
      const response = await api
        .put(`/api/v1/projects/${projectId}/owner`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: outsider.id });

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe(
        "That user is not a member of this project",
      );

      const savedProject = await prisma.projects.findUnique({
        where: { id: projectId },
      });

      expect(savedProject.owner_id).toBe(owner.id);
    });

    test("rejects a transfer without a user id", async () => {
      const response = await api
        .put(`/api/v1/projects/${projectId}/owner`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({});

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid ownership transfer data");
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "userId" })]),
      );
    });
  });
});
