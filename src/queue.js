import { Queue } from "bullmq";

// Shared by the queue, src/worker.js and src/uploadEvents.js.
const redisUrl = new URL(process.env.REDIS_URL || "redis://127.0.0.1:6379");

export const connection = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
    ...(redisUrl.username && { username: decodeURIComponent(redisUrl.username) }),
    ...(redisUrl.password && { password: decodeURIComponent(redisUrl.password) }),
    ...(redisUrl.pathname.length > 1 && { db: Number(redisUrl.pathname.slice(1)) }),
    ...(redisUrl.protocol === "rediss:" && { tls: {} })
};

export const UPLOAD_QUEUE_NAME = "uploadQueue";

export const uploadQueue = new Queue(UPLOAD_QUEUE_NAME, {
    connection
});
