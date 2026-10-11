import prisma from "../prisma.js";

function isRecordNotFound(error) {
    return error.code === "P2025";
}

// Mirrors the CHECK constraint in migrations/011_add_status_to_attachments.sql.
export const ATTACHMENT_STATUS = {
    PROCESSING: "processing",
    READY: "ready",
    FAILED: "failed"
};

export async function createAttachment(taskId, fileName, fileUrl, uploadedBy) {
    return await prisma.attachments.create({
        data: {
            file_name: fileName,
            file_url: fileUrl,
            task_id: taskId,
            uploaded_by: uploadedBy,
            // Stays 'processing' until src/worker.js finishes with the file.
            status: ATTACHMENT_STATUS.PROCESSING
        }
    });
}

/** Returns undefined if the attachment was deleted in the meantime. */
export async function updateAttachmentStatus(attachmentId, status) {
    try {
        return await prisma.attachments.update({
            where: {
                id: attachmentId
            },
            data: {
                status
            }
        });
    } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        throw error;
    }
}

export async function getAttachments(taskId) {
    return await prisma.attachments.findMany({
        where: {
            task_id: taskId
        },
        orderBy: {
            id: "asc"
        }
    });
}

export async function getAttachmentById(taskId, attachmentId) {
    return await prisma.attachments.findFirst({
        where: {
            id: attachmentId,
            task_id: taskId
        }
    });
}

export async function deleteAttachment(taskId, attachmentId) {
    const attachment = await prisma.attachments.findFirst({
        where: {
            id: attachmentId,
            task_id: taskId
        }
    });

    if (!attachment) {
        return undefined;
    }

    try {
        return await prisma.attachments.delete({
            where: {
                id: attachmentId
            }
        });
    } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        throw error;
    }
}