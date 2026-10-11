import { jest } from "@jest/globals";

const mockAuthenticateUser = jest.fn();

jest.unstable_mockModule("../src/data/users.data.js", () => ({
  createAuthUser: jest.fn(),
  authenticateUser: mockAuthenticateUser,
  getAllUsers: jest.fn(),
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  EmailTakenError: class EmailTakenError extends Error {},
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { uploadQueue } = await import("../src/queue.js");

describe("Global error handler", () => {
  afterAll(async () => {
    await uploadQueue.close();
  });

  test("returns 400 when the request body is malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ');

    expect(response.statusCode).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.body.error.message).toBe(
      "Request body contains invalid JSON",
    );
    expect(response.body.error.details).toEqual([]);
    expect(mockAuthenticateUser).not.toHaveBeenCalled();
  });

  test("returns 500 when an unexpected error occurs", async () => {
    mockAuthenticateUser.mockRejectedValue(new Error("Database error"));

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "user@example.com", password: "TestPassword123!" });

    expect(response.statusCode).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(response.body.error.message).toBe("An unexpected error occurred");
    expect(JSON.stringify(response.body)).not.toContain("Database error");
  });
});
