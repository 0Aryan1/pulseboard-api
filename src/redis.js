import Redis from "ioredis";
import logger from "./logger.js";

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

redis.on("connect", () => {
    logger.info("Redis connected");
});

redis.on("error", (error) => {
    logger.error({ err: error }, "Redis error");
});

export default redis;