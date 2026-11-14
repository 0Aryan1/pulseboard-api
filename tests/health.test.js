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

    test("GET /health should return 503 while the server is shutting down", async () => {
        app.locals.shuttingDown = true;

        try {
            const response = await request(app)
                .get("/health");

            expect(response.statusCode).toBe(503);
            expect(response.body.status).toBe("draining");
        } finally {
            app.locals.shuttingDown = false;
        }
    });
});
