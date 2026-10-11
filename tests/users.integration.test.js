import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";
import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/prisma.js";
import { uploadQueue } from "../src/queue.js";

const api = request(app);

describe("Users API integration", () => {
  let user;
  let otherUser;

  beforeAll(async () => {
    user = await createTestUser(api, "Users Test User");
    otherUser = await createTestUser(api, "Users Other User");
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [user, otherUser]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("GET /users", () => {
    test("lists users without password hashes", async () => {
      const response = await api
        .get("/api/v1/users")
        .set("Authorization", `Bearer ${user.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      for (const listedUser of response.body.data) {
        expect(listedUser).not.toHaveProperty("password_hash");
      }
    });

    test("limits the number of users returned", async () => {
      const response = await api
        .get("/api/v1/users?page=1&limit=1")
        .set("Authorization", `Bearer ${user.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe("GET /users/:userId", () => {
    test("returns the user's own profile", async () => {
      const response = await api
        .get(`/api/v1/users/${user.id}`)
        .set("Authorization", `Bearer ${user.token}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.data).toEqual({
        id: user.id,
        name: "Users Test User",
        email: user.email,
        created_at: expect.any(String),
      });
    });

    test("rejects reading another user's profile", async () => {
      const response = await api
        .get(`/api/v1/users/${otherUser.id}`)
        .set("Authorization", `Bearer ${user.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "You do not have permission to access or modify this user",
      );
    });
  });

  describe("PUT /users/:userId", () => {
    test("updates the user's own profile", async () => {
      const response = await api
        .put(`/api/v1/users/${user.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ name: "Renamed User", email: user.email });

      expect(response.statusCode).toBe(200);
      expect(response.body.data.name).toBe("Renamed User");
      expect(response.body.data).not.toHaveProperty("password_hash");

      const savedUser = await prisma.users.findUnique({
        where: { id: user.id },
      });

      expect(savedUser.name).toBe("Renamed User");
    });

    test("rejects updating another user without changing them", async () => {
      const response = await api
        .put(`/api/v1/users/${otherUser.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ name: "Hijacked", email: otherUser.email });

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");

      const savedUser = await prisma.users.findUnique({
        where: { id: otherUser.id },
      });

      expect(savedUser.name).toBe("Users Other User");
    });

    test("returns 409 when the email belongs to another user", async () => {
      const response = await api
        .put(`/api/v1/users/${user.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ name: "Email Thief", email: otherUser.email });

      expect(response.statusCode).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("EMAIL_TAKEN");
      expect(response.body.error.message).toBe(
        "An account with this email already exists",
      );

      const savedUser = await prisma.users.findUnique({
        where: { id: user.id },
      });

      expect(savedUser.email).toBe(user.email);
    });

    test("rejects invalid user data", async () => {
      const response = await api
        .put(`/api/v1/users/${user.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ name: "Bad Email", email: "not-an-email" });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid user data");
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "email" })]),
      );
    });
  });

  describe("DELETE /users/:userId", () => {
    test("rejects deleting another user", async () => {
      const response = await api
        .delete(`/api/v1/users/${otherUser.id}`)
        .set("Authorization", `Bearer ${user.token}`);

      expect(response.statusCode).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");

      const savedUser = await prisma.users.findUnique({
        where: { id: otherUser.id },
      });

      expect(savedUser).not.toBeNull();
    });

    test("returns 409 when the user still owns a project", async () => {
      const projectOwner = await createTestUser(api, "Owner To Delete");

      try {
        const projectResponse = await api
          .post("/api/v1/projects")
          .set("Authorization", `Bearer ${projectOwner.token}`)
          .send({
            title: "Owned project",
            description: "Blocks deleting its owner",
          });

        expect(projectResponse.statusCode).toBe(201);

        const response = await api
          .delete(`/api/v1/users/${projectOwner.id}`)
          .set("Authorization", `Bearer ${projectOwner.token}`);

        expect(response.statusCode).toBe(409);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe("OWNER_HAS_PROJECTS");
        expect(response.body.error.message).toBe(
          "Transfer or delete the projects you own before deleting your account.",
        );

        const savedUser = await prisma.users.findUnique({
          where: { id: projectOwner.id },
        });

        expect(savedUser).not.toBeNull();
      } finally {
        await deleteTestUsers(prisma, [projectOwner]);
      }
    });

    test("keeps the tasks and comments of a deleted user", async () => {
      const projectOwner = await createTestUser(api, "Content Owner");
      const author = await createTestUser(api, "Content Author");

      try {
        const projectResponse = await api
          .post("/api/v1/projects")
          .set("Authorization", `Bearer ${projectOwner.token}`)
          .send({
            title: "Project with authored content",
            description: "Keeps content after its author leaves",
          });

        expect(projectResponse.statusCode).toBe(201);
        const projectId = projectResponse.body.data.id;

        const memberResponse = await api
          .post(`/api/v1/projects/${projectId}/members`)
          .set("Authorization", `Bearer ${projectOwner.token}`)
          .send({ userId: author.id, role: "Member" });

        expect(memberResponse.statusCode).toBe(201);

        const taskResponse = await api
          .post(`/api/v1/projects/${projectId}/tasks`)
          .set("Authorization", `Bearer ${author.token}`)
          .send({ title: "Authored task", description: "By a leaving user", status: "Pending" });

        expect(taskResponse.statusCode).toBe(201);
        const taskId = taskResponse.body.data.id;

        const commentResponse = await api
          .post(`/api/v1/tasks/${taskId}/comments`)
          .set("Authorization", `Bearer ${author.token}`)
          .send({ content: "Authored comment" });

        expect(commentResponse.statusCode).toBe(201);
        const commentId = commentResponse.body.data.id;

        const response = await api
          .delete(`/api/v1/users/${author.id}`)
          .set("Authorization", `Bearer ${author.token}`);

        expect(response.statusCode).toBe(200);

        const tasksResponse = await api
          .get(`/api/v1/projects/${projectId}/tasks`)
          .set("Authorization", `Bearer ${projectOwner.token}`);
        const listedTask = tasksResponse.body.data.find((task) => task.id === taskId);

        expect(listedTask).toBeDefined();
        expect(listedTask.created_by).toBeNull();
        expect(listedTask.created_by_name).toBeUndefined();

        const commentsResponse = await api
          .get(`/api/v1/tasks/${taskId}/comments`)
          .set("Authorization", `Bearer ${projectOwner.token}`);
        const listedComment = commentsResponse.body.data.find(
          (comment) => comment.id === commentId,
        );

        expect(listedComment).toBeDefined();
        expect(listedComment.created_by).toBeNull();
      } finally {
        await deleteTestUsers(prisma, [projectOwner, author]);
      }
    });

    test("deletes the user's own account", async () => {
      const userToDelete = await createTestUser(api, "User To Delete");

      try {
        const response = await api
          .delete(`/api/v1/users/${userToDelete.id}`)
          .set("Authorization", `Bearer ${userToDelete.token}`);

        expect(response.statusCode).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({
          id: userToDelete.id,
          name: "User To Delete",
          email: userToDelete.email,
          created_at: expect.any(String),
        });

        const savedUser = await prisma.users.findUnique({
          where: { id: userToDelete.id },
        });

        expect(savedUser).toBeNull();
      } finally {
        await deleteTestUsers(prisma, [userToDelete]);
      }
    });

    test("returns 404 to a deleted user whose token has not expired", async () => {
      const deletedUser = await createTestUser(api, "Deleted With Token");

      try {
        const deleteResponse = await api
          .delete(`/api/v1/users/${deletedUser.id}`)
          .set("Authorization", `Bearer ${deletedUser.token}`);

        expect(deleteResponse.statusCode).toBe(200);

        const response = await api
          .get(`/api/v1/users/${deletedUser.id}`)
          .set("Authorization", `Bearer ${deletedUser.token}`);

        expect(response.statusCode).toBe(404);
        expect(response.body.data).toBeUndefined();
        expect(response.body.error.code).toBe("NOT_FOUND");
        expect(response.body.error.message).toBe("User not found");
      } finally {
        await deleteTestUsers(prisma, [deletedUser]);
      }
    });
  });
});
