const originalLimit = process.env.RATE_LIMIT_MAX;

// The limiter reads RATE_LIMIT_MAX when app.js loads, so set it before importing.
process.env.RATE_LIMIT_MAX = "3";

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { uploadQueue } = await import("../src/queue.js");

const api = request(app);

describe("API rate limiting", () => {
  afterAll(async () => {
    process.env.RATE_LIMIT_MAX = originalLimit;
    await uploadQueue.close();
  });

  // An invalid login body is rejected before touching the database.
  const sendLogin = () => api.post("/api/v1/auth/login").send({});

  test("blocks requests over the limit with 429", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await sendLogin();

      expect(response.statusCode).toBe(400);
    }

    const limitedResponse = await sendLogin();

    expect(limitedResponse.statusCode).toBe(429);
  });

  test("answers over-limit requests in the standard error format", async () => {
    const response = await sendLogin();

    expect(response.statusCode).toBe(429);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests, please try again later.",
        details: [],
      },
    });
  });

  test("tells clients the limit in standard headers", async () => {
    const response = await sendLogin();

    expect(response.headers["ratelimit-policy"]).toContain("q=3");
    expect(response.headers.ratelimit).toBeDefined();
  });

  test("does not limit the health check", async () => {
    const response = await api.get("/health");

    expect(response.statusCode).toBe(200);
  });
});
