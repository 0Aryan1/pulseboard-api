import { Job, QueueEvents } from "bullmq";
import { connection, uploadQueue, UPLOAD_QUEUE_NAME } from "./queue.js";
import { getAttachmentById, ATTACHMENT_STATUS } from "./data/attachments.data.js";
import { emitToProject } from "./socket.js";
import { invalidateAttachmentCaches } from "./controllers/attachments.controller.js";
import logger from "./logger.js";

/*
 * Bridges upload-processing outcomes from src/worker.js to Socket.IO.
 *
 * The worker runs in its own process without Socket.IO, so the API subscribes
 * to the queue's job events through Redis and emits them to the project room:
 *
 *   attachmentCreated (status 'processing', from the upload request)
 *     -> attachmentReady  | attachmentFailed   (from here)
 *
 * Each API instance forwards events to its own connected clients, so this
 * stays correct with more than one API process.
 */

// Only a status the worker has actually committed is announced; a failed
// attempt that will be retried leaves the row in 'processing'.
const EXPECTED_STATUS = {
    attachmentReady: ATTACHMENT_STATUS.READY,
    attachmentFailed: ATTACHMENT_STATUS.FAILED
};

async function forward(jobId, event) {
    const job = await Job.fromId(uploadQueue, jobId);
    if (!job) return;

    const { attachmentId, taskId, projectId } = job.data;

    // Jobs queued before projectId was added to the payload cannot be routed.
    if (!projectId) return;

    // Read the row rather than trusting the job: it may have been deleted.
    const attachment = await getAttachmentById(taskId, attachmentId);
    if (!attachment || attachment.status !== EXPECTED_STATUS[event]) return;

    await invalidateAttachmentCaches(taskId, attachmentId);

    emitToProject(projectId, event, attachment);
}

export function setupUploadEvents() {
    const queueEvents = new QueueEvents(UPLOAD_QUEUE_NAME, { connection });

    const handle = (event) => ({ jobId }) =>
        forward(jobId, event).catch((error) =>
            logger.error({ event, jobId, err: error }, "Could not forward upload event")
        );

    queueEvents.on("completed", handle("attachmentReady"));
    queueEvents.on("failed", handle("attachmentFailed"));

    queueEvents.on("error", (error) => {
        logger.error({ err: error }, "Upload queue events error");
    });

    return queueEvents;
}
