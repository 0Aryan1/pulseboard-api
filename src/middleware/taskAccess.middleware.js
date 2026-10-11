import prisma from "../prisma.js";
import { sendError } from "../utils/response.js";

export const taskAccessMiddleware = (requiredRoles) => {
    return async (req, res, next) => {
        const userId = req.user.id;
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

        const task = await prisma.tasks.findUnique({
            where: {
                id: taskId
            },
            select: {
                project_id: true
            }
        });

        if (!task) {
            return sendError(
                res,
                404,
                "NOT_FOUND",
                "Task not found"
            );
        }

        const membership = await prisma.project_members.findUnique({
            where: {
                user_id_project_id: {
                    user_id: userId,
                    project_id: task.project_id
                }
            }
        });

        if (!membership) {
            return sendError(
                res,
                403,
                "FORBIDDEN",
                "You do not have access to this project"
            );
        }

        if (!requiredRoles.includes(membership.role)) {
            return sendError(
                res,
                403,
                "FORBIDDEN",
                "You do not have permission to perform this action"
            );
        }

        req.task = {
            id: taskId,
            projectId: task.project_id
        };

        req.projectId = task.project_id;
        req.projectRole = membership.role;

        next();
    };
};