import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import app from "./app.js";
import logger from "./logger.js";
import { setupSocket } from "./socket.js";
import { setupUploadEvents } from "./uploadEvents.js";
import redis from "./redis.js";
import prisma from "./prisma.js";

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*"
    }
});

setupSocket(io);

const queueEvents = setupUploadEvents();

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, "Server running");
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal) {
    logger.info({ signal }, "Shutdown signal received, draining connections");

    const forceExit = setTimeout(() => {
        logger.error("Graceful shutdown timed out, forcing exit");
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
        httpServer.close();
        io.close();
        queueEvents.close().catch(() => {});
        redis.disconnect();
        await prisma.$disconnect();

        clearTimeout(forceExit);
        logger.info("Shutdown complete");
        process.exit(0);
    } catch (err) {
        logger.error({ err }, "Error during shutdown");
        clearTimeout(forceExit);
        process.exit(1);
    }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));