import "dotenv/config";
import fs from "fs/promises";
import { Worker } from "bullmq";
import { connection, UPLOAD_QUEUE_NAME } from "./queue.js";
import { updateAttachmentStatus, ATTACHMENT_STATUS } from "./data/attachments.data.js";
import prisma from "./prisma.js";
import logger from "./logger.js";

/*
 * Processes uploaded attachments and records the outcome on the row.
 *
 * The status is written *before* the job settles, so by the time the API hears
 * "completed" / "failed" through QueueEvents (src/uploadEvents.js) and tells
 * the browsers, a refetch already sees the final status.
 *
 * This process has no Socket.IO access by design; the API does all emitting.
 */

function isFinalAttempt(job) {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

const worker = new Worker(
    UPLOAD_QUEUE_NAME,
    async (job) => {
        const { attachmentId, filePath } = job.data;

        logger.info({ jobId: job.id }, "Processing upload job");

        try {
            // The file must still be on disk to be processed at all.
            await fs.access(filePath);

            // File processing will be added here later.
        } catch (error) {
            if (isFinalAttempt(job)) {
                await updateAttachmentStatus(attachmentId, ATTACHMENT_STATUS.FAILED);
            }

            throw error;
        }

        await updateAttachmentStatus(attachmentId, ATTACHMENT_STATUS.READY);

        return {
            success: true
        };
    },
    { connection }
);

worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Upload job completed");
});

worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Upload job failed");
});

logger.info("Upload worker started");

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Shutdown signal received, finishing the current job");

    const forceExit = setTimeout(() => {
        logger.error("Graceful shutdown timed out, forcing exit");
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
        // Waits for the job in progress, so its row is not left 'processing'.
        await worker.close();
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
