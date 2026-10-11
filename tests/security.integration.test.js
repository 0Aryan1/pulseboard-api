import request from "supertest";
import app from "../src/app.js";
import { uploadQueue } from "../src/queue.js";

const api = request(app);

describe("Security headers", () => {
  afterAll(async () => {
    await uploadQueue.close();
  });

  describe("Helmet", () => {
    test("sets protective headers", async () => {
      const response = await api.get("/health");

      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(response.headers["content-security-policy"]).toBeDefined();
      expect(response.headers["strict-transport-security"]).toBeDefined();
    });

    test("hides that the server runs Express", async () => {
      const response = await api.get("/health");

      expect(response.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("CORS", () => {
    const allowedOrigin = process.env.CORS_ORIGIN;

    test("allows the configured web client origin", async () => {
      const response = await api.get("/health").set("Origin", allowedOrigin);

      expect(response.headers["access-control-allow-origin"]).toBe(
        allowedOrigin,
      );
    });

    test("exposes Content-Disposition so downloads keep their file name", async () => {
      const response = await api.get("/health").set("Origin", allowedOrigin);

      expect(response.headers["access-control-expose-headers"]).toContain(
        "Content-Disposition",
      );
    });

    test("does not allow other origins", async () => {
      const response = await api
        .get("/health")
        .set("Origin", "https://evil.example.com");

      // With a single configured origin, cors always answers with that origin
      // (or nothing); the browser then blocks any other page.
      expect([undefined, allowedOrigin]).toContain(
        response.headers["access-control-allow-origin"],
      );
    });

    test("answers preflight requests for authenticated writes", async () => {
      const response = await api
        .options("/api/v1/projects/1")
        .set("Origin", allowedOrigin)
        .set("Access-Control-Request-Method", "PUT")
        .set("Access-Control-Request-Headers", "Authorization, Content-Type");

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(
        allowedOrigin,
      );
      expect(response.headers["access-control-allow-methods"]).toContain("PUT");
      expect(
        response.headers["access-control-allow-headers"].toLowerCase(),
      ).toContain("authorization");
    });
  });
});
