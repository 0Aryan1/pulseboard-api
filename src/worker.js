import "dotenv/config";
import fs from "fs/promises";
import { Worker } from "bullmq";
import { connection, UPLOAD_QUEUE_NAME } from "./queue.js";
import { updateAttachmentStatus, ATTACHMENT_STATUS } from "./data/attachments.data.js";

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

        console.log("Processing upload job:", job.id);

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
    console.log(`Upload job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
    console.error(
        `Upload job ${job?.id} failed:`,
        error.message
    );
});

console.log("Upload worker started");
