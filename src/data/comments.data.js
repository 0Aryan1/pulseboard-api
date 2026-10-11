import prisma from "../prisma.js";

function formatComment(comment) {
    return {
        id: comment.id,
        content: comment.content,
        task_id: comment.task_id,
        created_at: comment.created_at,
        created_by: comment.users?.id ?? comment.created_by,
        created_by_name: comment.users?.name,
        created_by_email: comment.users?.email
    };
}

export const getAllComments = async (taskId) => {
    const comments = await prisma.comments.findMany({
        where: {
            task_id: taskId
        },
        include: {
            users: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        },
        orderBy: {
            id: "asc"
        }
    });

    return comments.map(formatComment);
};

export const getCommentById = async (taskId, commentId) => {
    const comment = await prisma.comments.findFirst({
        where: {
            task_id: taskId,
            id: commentId
        },
        include: {
            users: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        }
    });

    return comment ? formatComment(comment) : undefined;
};

export const createComment = async (taskId, commentData, userId) => {
    const { content } = commentData;

    return await prisma.comments.create({
        data: {
            content,
            task_id: taskId,
            created_by: userId
        }
    });
};

export const updateComment = async (taskId, commentId, commentData) => {
    const { content } = commentData;

    const comment = await prisma.comments.findFirst({
        where: {
            id: commentId,
            task_id: taskId
        }
    });

    if (!comment) {
        return undefined;
    }

    return await prisma.comments.update({
        where: {
            id: commentId
        },
        data: {
            content
        }
    });
};

export const deleteComment = async (taskId, commentId) => {
    const comment = await prisma.comments.findFirst({
        where: {
            id: commentId,
            task_id: taskId
        }
    });

    if (!comment) {
        return undefined;
    }

    return await prisma.comments.delete({
        where: {
            id: commentId
        }
    });
};