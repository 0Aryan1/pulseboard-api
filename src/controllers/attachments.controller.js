import { createAttachment, getAttachments, getAttachmentById, deleteAttachment, updateAttachmentStatus, ATTACHMENT_STATUS} from "../data/attachments.data.js";
import { sendError, sendSuccess } from "../utils/response.js";
import path from "path";
import fs from "fs/promises";
import { uploadQueue } from "../queue.js";
import { emitToProject } from "../socket.js";

function hasInvalidIds(taskId, attachmentId) {
    return (
        !Number.isInteger(taskId) ||
        taskId <= 0 ||
        !Number.isInteger(attachmentId) ||
        attachmentId <= 0
    );
}

function sendInvalidIds(res) {
    return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid task or attachment ID",
        []
    );
}

export const createAttachmentController = async (req, res) => {
    const taskId = Number(req.params.taskId);

    if (!Number.isInteger(taskId) || taskId <= 0) {
        return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Invalid task ID",
            []
        );
    }

    if (!req.file) {
        return sendError(res, 400, "FILE_REQUIRED", "Please upload a file");
    }

    const attachment = await createAttachment(
        taskId,
        req.file.originalname,
        req.file.path
    );

    try {
        await uploadQueue.add("processUpload", {
            attachmentId: attachment.id,
            taskId,
            // Lets src/uploadEvents.js broadcast the job's outcome to the right room.
            projectId: req.projectId,
            fileName: req.file.originalname,
            filePath: req.file.path
        });
    } catch (error) {
        // No job means nothing will ever finish processing this row, so mark
        // it failed rather than leaving it stuck in 'processing'.
        const failed = await updateAttachmentStatus(attachment.id, ATTACHMENT_STATUS.FAILED);
        emitToProject(req.projectId, "attachmentCreated", failed ?? attachment);
        throw error;
    }

    emitToProject(req.projectId, "attachmentCreated", attachment);

    return sendSuccess(res, 201, attachment);
};

export const getAttachmentsController = async (req, res) => {
    const taskId = Number(req.params.taskId);

    const attachments = await getAttachments(taskId);

    return sendSuccess(res, 200, attachments ?? []);
};

export const getAttachmentsByIdController = async (req, res) => {
    const taskId = Number(req.params.taskId);
    const attachmentId = Number(req.params.attachmentId);

    if (hasInvalidIds(taskId, attachmentId)) {
        return sendInvalidIds(res);
    }

    const attachment = await getAttachmentById(taskId, attachmentId);
    if (!attachment) {
        return sendError(res, 404, "NOT_FOUND", "Attachment not found");
    }

    return sendSuccess(res, 200, attachment);
};

export const downloadAttachmentController = async (req, res) => {
    const taskId = Number(req.params.taskId);
    const attachmentId = Number(req.params.attachmentId);

    if (hasInvalidIds(taskId, attachmentId)) {
        return sendInvalidIds(res);
    }

    const attachment = await getAttachmentById(taskId, attachmentId);

    if (!attachment) {
        return sendError(res, 404, "NOT_FOUND", "Attachment not found");
    }

    // Only serve files the upload worker has finished with.
    if (attachment.status !== ATTACHMENT_STATUS.READY) {
        return sendError(
            res,
            409,
            "ATTACHMENT_NOT_READY",
            attachment.status === ATTACHMENT_STATUS.FAILED
                ? "This file failed processing and cannot be downloaded"
                : "This file is still being processed"
        );
    }

    const filePath = path.resolve(attachment.file_url);

    // Files are stored under a generated UUID name; serve the original name to the client.
    return res.download(filePath, attachment.file_name);
};

export const deleteAttachmentController = async (req, res) => {
    const taskId = Number(req.params.taskId);
    const attachmentId = Number(req.params.attachmentId);

    if (hasInvalidIds(taskId, attachmentId)) {
        return sendInvalidIds(res);
    }

    const attachment = await getAttachmentById(taskId, attachmentId);

    if (!attachment) {
        return sendError(res, 404, "NOT_FOUND", "Attachment not found");
    }

    const filePath = path.resolve(attachment.file_url);

    try {
        await fs.unlink(filePath);
    } catch (error) {
        // File may already be missing.
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    const deletedAttachment = await deleteAttachment(taskId, attachmentId);

    emitToProject(req.projectId, "attachmentDeleted", deletedAttachment);

    return sendSuccess(res, 200, deletedAttachment);
};