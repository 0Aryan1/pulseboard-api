import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import app from "./app.js";
import logger from "./logger.js";
import { setupSocket } from "./socket.js";
import { setupUploadEvents } from "./uploadEvents.js";

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*"
    }
});

setupSocket(io);

// Forwards upload-processing outcomes from the worker to connected clients.
setupUploadEvents();

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, "Server running");
});