import request from "supertest";
import app from "../src/app.js";
import { uploadQueue } from "../src/queue.js";

describe("Health API", () => {
    afterAll(async () => {
        await uploadQueue.close();
    });

    test("GET /health should return 200", async () => {
        const response = await request(app)
            .get("/health");

        expect(response.statusCode).toBe(200);
    });
});
