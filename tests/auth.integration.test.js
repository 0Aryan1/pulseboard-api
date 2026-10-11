import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  TEST_PASSWORD,
  createTestUser,
  deleteTestUsers,
} from "./helpers/testUsers.js";
import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/prisma.js";
import { uploadQueue } from "../src/queue.js";

const api = request(app);

describe("Auth API integration", () => {
  let user;
  const createdUsers = [];

  beforeAll(async () => {
    user = await createTestUser(api, "Auth User");
    createdUsers.push(user);
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, createdUsers);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("POST /auth/signup", () => {
    test("creates a user and stores only a hash of the password", async () => {
      const email = `test-${randomUUID()}@example.com`;

      const response = await api
        .post("/api/v1/auth/signup")
        .send({ name: "New Signup", email, password: TEST_PASSWORD });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      createdUsers.push(response.body.data);

      expect(response.body.data).toEqual({
        id: expect.any(Number),
        name: "New Signup",
        email,
        created_at: expect.any(String),
      });

      const savedUser = await prisma.users.findUnique({ where: { email } });

      expect(savedUser.password_hash).toBeTruthy();
      expect(savedUser.password_hash).not.toBe(TEST_PASSWORD);
    });

    test("rejects invalid signup data without creating a user", async () => {
      const email = `test-${randomUUID()}@example.com`;

      const response = await api
        .post("/api/v1/auth/signup")
        .send({ name: "Short Password", email, password: "short" });

      expect(response.statusCode).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid signup data");
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "password" }),
        ]),
      );

      expect(await prisma.users.findUnique({ where: { email } })).toBeNull();
    });

    test("returns 409 when the email is already registered", async () => {
      const response = await api
        .post("/api/v1/auth/signup")
        .send({ name: "Duplicate", email: user.email, password: TEST_PASSWORD });

      expect(response.statusCode).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("EMAIL_TAKEN");
      expect(response.body.error.message).toBe(
        "An account with this email already exists",
      );

      expect(
        await prisma.users.count({ where: { email: user.email } }),
      ).toBe(1);
    });
  });

  describe("POST /auth/login", () => {
    test("returns a token for the logged-in user", async () => {
      const response = await api
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: TEST_PASSWORD });

      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);

      const decoded = jwt.verify(
        response.body.data.token,
        process.env.JWT_SECRET,
      );

      expect(decoded.userId).toBe(user.id);
    });

    test("rejects a wrong password", async () => {
      const response = await api
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: "WrongPassword123!" });

      expect(response.statusCode).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(response.body.error.message).toBe("Invalid email or password");
    });

    test("gives the same error for an unknown email as for a wrong password", async () => {
      const response = await api
        .post("/api/v1/auth/login")
        .send({
          email: `test-${randomUUID()}@example.com`,
          password: TEST_PASSWORD,
        });

      expect(response.statusCode).toBe(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(response.body.error.message).toBe("Invalid email or password");
    });

    test("rejects invalid login data", async () => {
      const response = await api
        .post("/api/v1/auth/login")
        .send({ email: "not-an-email", password: TEST_PASSWORD });

      expect(response.statusCode).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Invalid login data");
    });
  });

  describe("authentication middleware", () => {
    const protectedUrl = () => `/api/v1/users/${user.id}`;

    test("rejects a request without a token", async () => {
      const response = await api.get(protectedUrl());

      expect(response.statusCode).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(response.body.error.message).toBe("Authentication required");
    });

    test("rejects a malformed token", async () => {
      const response = await api
        .get(protectedUrl())
        .set("Authorization", "Bearer not-a-jwt");

      expect(response.statusCode).toBe(401);
      expect(response.body.error.code).toBe("INVALID_TOKEN");
    });

    test("rejects a token signed with a different secret", async () => {
      const forgedToken = jwt.sign({ userId: user.id }, "not-the-real-secret");

      const response = await api
        .get(protectedUrl())
        .set("Authorization", `Bearer ${forgedToken}`);

      expect(response.statusCode).toBe(401);
      expect(response.body.error.code).toBe("INVALID_TOKEN");
    });

    test("rejects an expired token", async () => {
      const expiredToken = jwt.sign(
        { userId: user.id, exp: Math.floor(Date.now() / 1000) - 60 },
        process.env.JWT_SECRET,
      );

      const response = await api
        .get(protectedUrl())
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(response.statusCode).toBe(401);
      expect(response.body.error.code).toBe("INVALID_TOKEN");
      expect(response.body.error.message).toBe("Invalid or expired token");
    });
  });
});
