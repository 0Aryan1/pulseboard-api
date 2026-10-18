import prisma from "../prisma.js";
import { sendError } from "../utils/response.js";
import redis from "../redis.js";

export function roleCacheKey(userId, projectId) {
    return `role:${userId}:${projectId}`;
}

export const projectRoleMiddleware = (requiredRoles) => {
    return async (req, res, next) => {
        const userId = req.user.id;
        const projectId = Number(req.params.projectId);

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return sendError(
                res,
                400,
                "VALIDATION_ERROR",
                "Invalid project ID",
                []
            );
        }

        const cacheKey = roleCacheKey(userId, projectId);
        const cachedRole = await redis.get(cacheKey);

        if (cachedRole) {
            if (!requiredRoles.includes(cachedRole)) {
                return sendError(
                    res,
                    403,
                    "FORBIDDEN",
                    "You do not have permission to perform this action"
                );
            }

            req.projectRole = cachedRole;
            return next();
        }

        const membership = await prisma.project_members.findUnique({
            where: {
                user_id_project_id: {
                    user_id: userId,
                    project_id: projectId
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

        await redis.set(cacheKey, membership.role, "EX", 120);

        req.projectRole = membership.role;

        next();
    };
};