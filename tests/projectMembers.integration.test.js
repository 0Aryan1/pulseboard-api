import { jest } from "@jest/globals";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: jest.fn(),
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/prisma.js");
const { uploadQueue } = await import("../src/queue.js");

const api = request(app);

describe("Project members API integration", () => {
  let owner;
  let member;
  let outsider;
  let projectId;
  const extraUsers = [];

  const membersUrl = () => `/api/v1/projects/${projectId}/members`;

  async function findMembership(userId) {
    return prisma.project_members.findUnique({
      where: {
        user_id_project_id: { user_id: userId, project_id: projectId },
      },
    });
  }

  // Each test that adds someone gets a fresh user, so tests don't depend on
  // each other's membership changes.
  async function createAndAddUser(role = "Member") {
    const user = await createTestUser(api, "Added Member");
    extraUsers.push(user);

    const response = await api
      .post(membersUrl())
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: user.id, role });

    expect(response.statusCode).toBe(201);

    return user;
  }
  beforeAll(async () => {
    owner = await createTestUser(api, "Members Owner");
    member = await createTestUser(api, "Members Member");
    outsider = await createTestUser(api, "Members Outsider");

    const projectResponse = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Members test project",
        description: "Created by the project members integration tests",
      });

    expect(projectResponse.statusCode).toBe(201);
    projectId = projectResponse.body.data.id;

    const memberResponse = await api
      .post(membersUrl())
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: member.id, role: "Member" });

    expect(memberResponse.statusCode).toBe(201);
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [owner, member, outsider, ...extraUsers]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("GET /members", () => {
    test("lists members with their roles", async () => {
      const response = await api
        .get(membersUrl())
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          {
            id: owner.id,
            name: "Members Owner",
            email: owner.email,
            role: "Admin",
          },
          {
            id: member.id,
            name: "Members Member",
            email: member.email,
            role: "Member",
          },
        ]),
      );
    });

    test("does not expose password hashes", async () => {
      const response = await api
        .get(membersUrl())
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(200);

      for (const listedMember of response.body.data) {
        expect(listedMember).not.toHaveProperty("password_hash");
      }
    });

    test("rejects a non-member", async () => {
      const response = await api
        .get(membersUrl())
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("POST /members", () => {
    test("lets an Admin add a member", async () => {
      const newUser = await createTestUser(api, "New Member");
      extraUsers.push(newUser);

      const response = await api
        .post(membersUrl())
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: newUser.id, role: "Member" });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user_id).toBe(newUser.id);
      expect(response.body.data.role).toBe("Member");

      const membership = await findMembership(newUser.id);

      expect(membership.role).toBe("Member");
    });

    test("rejects a Member trying to add someone", async () => {
      const response = await api
        .post(membersUrl())
        .set("Authorization", `Bearer ${member.token}`)
        .send({ userId: outsider.id, role: "Member" });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(await findMembership(outsider.id)).toBeNull();
    });

    test("rejects a role other than Admin or Member", async () => {
      const response = await api
        .post(membersUrl())
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: outsider.id, role: "min" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid project member data");
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "role" })]),
      );
      expect(await findMembership(outsider.id)).toBeNull();
    });

    test("returns 404 when the user does not exist", async () => {
      const response = await api
        .post(membersUrl())
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: 999999999, role: "Member" });

      expect(response.statusCode).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("User not found");
    });

    test("returns 409 when the user is already a member", async () => {
      const response = await api
        .post(membersUrl())
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: member.id, role: "Admin" });

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("ALREADY_MEMBER");
      expect((await findMembership(member.id)).role).toBe("Member");
    });

    test("refuses to add the owner with a non-Admin role", async () => {
      const response = await api
        .post(membersUrl())
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userId: owner.id, role: "Member" });

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("OWNER_MUST_BE_ADMIN");
      expect((await findMembership(owner.id)).role).toBe("Admin");
    });
  });

  describe("PUT /members/:userId", () => {
    test("lets an Admin change a member's role", async () => {
      const user = await createAndAddUser("Member");

      const response = await api
        .put(`${membersUrl()}/${user.id}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ role: "Admin" });

      expect(response.statusCode).toBe(200);
      expect(response.body.data.role).toBe("Admin");
      expect((await findMembership(user.id)).role).toBe("Admin");
    });

    test("rejects a Member trying to change roles", async () => {
      const response = await api
        .put(`${membersUrl()}/${member.id}`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ role: "Admin" });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect((await findMembership(member.id)).role).toBe("Member");
    });

    test("refuses to demote the owner", async () => {
      const response = await api
        .put(`${membersUrl()}/${owner.id}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ role: "Member" });

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("OWNER_MUST_BE_ADMIN");
      expect((await findMembership(owner.id)).role).toBe("Admin");
    });

    test("returns 404 when the user is not a member", async () => {
      const response = await api
        .put(`${membersUrl()}/${outsider.id}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ role: "Admin" });

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("Project member not found");
      expect(await findMembership(outsider.id)).toBeNull();
    });

    test("returns 400 when the user id is not a number", async () => {
      const response = await api
        .put(`${membersUrl()}/abc`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ role: "Admin" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid project or user ID");
    });
  });

  describe("DELETE /members/:userId", () => {
    test("lets an Admin remove a member, who then loses access", async () => {
      const user = await createAndAddUser("Member");

      const response = await api
        .delete(`${membersUrl()}/${user.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(await findMembership(user.id)).toBeNull();

      const projectResponse = await api
        .get(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${user.token}`);

      expect(projectResponse.statusCode).toBe(403);
    });

    test("rejects a Member trying to remove someone", async () => {
      const user = await createAndAddUser("Member");

      const response = await api
        .delete(`${membersUrl()}/${user.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(await findMembership(user.id)).not.toBeNull();
    });

    test("refuses to remove the owner", async () => {
      const response = await api
        .delete(`${membersUrl()}/${owner.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(409);
      expect(response.body.error.code).toBe("OWNER_CANNOT_BE_REMOVED");
      expect(await findMembership(owner.id)).not.toBeNull();
    });

    test("returns 404 when the user is not a member", async () => {
      const response = await api
        .delete(`${membersUrl()}/${outsider.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toBe("Project member not found");
    });

    test("returns 400 when the user id is not a number", async () => {
      const response = await api
        .delete(`${membersUrl()}/abc`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid project or user ID");
    });
  });
});
