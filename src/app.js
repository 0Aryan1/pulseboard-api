import express from "express";
import helmet from "helmet";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import logger from "./logger.js";
import { sendSuccess, sendError } from "./utils/response.js";
import prisma from "./prisma.js";
import redis from "./redis.js";
import projectRoutes from "./routes/projects.routes.js";
import usersRoutes from "./routes/users.routes.js";
import projectMembersRoutes from "./routes/projectMembers.routes.js";
import tasksRoutes from "./routes/tasks.routes.js";
import commentsRoutes from "./routes/comments.routes.js";
import attachmentsRouter from "./routes/attachments.routes.js";
import authRoutes from "./routes/auth.routes.js";


const app = express();
app.use(helmet());

// The web client sends the JWT in an Authorization header, so credentials are not needed.
app.use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    exposedHeaders: ["Content-Disposition"]
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Answer in the API's usual error format instead of the plain-text default.
    handler: (req, res, next, options) =>
        sendError(res, options.statusCode, "RATE_LIMITED", "Too many requests, please try again later.")
});

app.use(pinoHttp({ logger }));

app.use("/api/", apiLimiter);

// JSON Body Parser Middleware
app.use(express.json());

app.get("/health", async (req, res) => {
  const checks = { postgres: "ok", redis: "ok" };

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    checks.postgres = "down";
  }

  try {
    await redis.ping();
  } catch {
    checks.redis = "down";
  }

  const healthy = checks.postgres === "ok" && checks.redis === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks
  });
});

// Project Routes
app.use("/api/v1/auth", authRoutes);

app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/projects/:projectId/members", projectMembersRoutes);
app.use("/api/v1/projects/:projectId/tasks", tasksRoutes);
// app.use("/api/v1/tasks", tasksRoutes);

app.use("/api/v1/tasks/:taskId/comments", commentsRoutes);
// app.use("/api/v1/comments", commentsRoutes);

app.use("/api/v1/tasks/:taskId/attachments", attachmentsRouter);
// app.use("/api/v1/attachments", attachmentsRouter);

app.use((err, req, res, next) => {
  logger.error({ err }, "Unhandled error");

  // express.json() rejects a body it cannot parse; that is the client's mistake.
  if (err.type === "entity.parse.failed") {
    return sendError(res, 400, "INVALID_JSON", "Request body contains invalid JSON");
  }

  // Multer rejects oversized files with a MulterError; the fileFilter in
  // upload.middleware.js rejects disallowed mimetypes with a plain Error.
  if (err instanceof multer.MulterError) {
    return sendError(res, 400, "FILE_ERROR", err.message);
  }

  if (err.message === "Unsupported file type") {
    return sendError(res, 400, "FILE_ERROR", err.message);
  }

  return sendError(res, 500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred");
});

export default app;