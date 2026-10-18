import { sendError, sendSuccess } from "../utils/response.js";
import { formatValidationErrors } from "../utils/validation.js";
import { getProjectMembers, addProjectMember, updateProjectMember, deleteProjectMember} from "../data/projectMembers.data.js";
import { getProjectById } from "../data/projects.data.js";
import { getUserById } from "../data/users.data.js";
import { createProjectMemberSchema, updateProjectMemberSchema } from "../schemas/projectMember.schema.js";
import { emitToProject, emitToUser, removeUserFromProject } from "../socket.js";
import redis from "../redis.js";
import { projectCacheKey, invalidateProjectListCache } from "./projects.controller.js";
import { roleCacheKey } from "../middleware/projectRole.middleware.js";

/*
 * The project owner must always hold the Admin role. createProject seeds them
 * as Admin in a transaction; these guards keep that true for the lifetime of
 * the project.
 *
 * Every write path is checked, not just the role update: guarding the update
 * alone would leave the rule bypassable by removing the owner and adding them
 * back as a Member.
 */
const OWNER_ROLE = "Admin";

function membersCacheKey(projectId) {
    return `members:project:${projectId}`;
}

async function getCachedProject(projectId) {
    const cacheKey = projectCacheKey(projectId);
    const cached = await redis.get(cacheKey);

    if (cached) return JSON.parse(cached);

    const project = await getProjectById(projectId);
    if (project) {
        await redis.set(cacheKey, JSON.stringify(project), "EX", 120);
    }
    return project;
}

export const getProjectMembersController = async (req, res) => {
    const projectId = Number(req.params.projectId);

    const cacheKey = membersCacheKey(projectId);
    const cached = await redis.get(cacheKey);

    if (cached) {
        return sendSuccess(res, 200, JSON.parse(cached));
    }

    const members = await getProjectMembers(projectId);

    await redis.set(cacheKey, JSON.stringify(members), "EX", 120);

    return sendSuccess(res, 200, members);
};

export const addProjectMemberController = async (req, res) => {
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

    const result = createProjectMemberSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid project member data", formatValidationErrors(result.error.issues));
    }
    const { userId, role } = result.data;

    if (!Number.isInteger(userId) || userId <= 0) {
    return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid user ID",
        []
    );
}

    const project = await getCachedProject(projectId);

    if (!project) {
        return sendError(res, 404, "NOT_FOUND", "Project not found");
    }

    if (userId === project.owner_id && role !== OWNER_ROLE) {
        return sendError(
            res,
            409,
            "OWNER_MUST_BE_ADMIN",
            "The project owner must be an Admin"
        );
    }

    const user = await getUserById(userId);

    if (!user) {
        return sendError(res, 404, "NOT_FOUND", "User not found");
    }

    const member = await addProjectMember(
        projectId,
        userId,
        role
    );

    if (!member) {
    return sendError(
        res,
        409,
        "ALREADY_MEMBER",
        "User is already a member of this project"
    );
}

    await redis.del(membersCacheKey(projectId));
    await redis.del(roleCacheKey(userId, projectId));
    await invalidateProjectListCache([userId]);

    emitToProject(projectId, "memberAdded", member);
    emitToUser(userId, "addedToProject", { projectId, title: project.title, role });

    return sendSuccess(res, 201, member);
};

export const updateProjectMemberController = async (req, res) => {
    const projectId = Number(req.params.projectId);
    const userId = Number(req.params.userId);

    if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(userId) ||
    userId <= 0
) {
    return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid project or user ID",
        []
    );
}

    const result = updateProjectMemberSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Invalid project member data",
            formatValidationErrors(result.error.issues)
        );
    }

    const project = await getCachedProject(projectId);

    if (!project) {
        return sendError(res, 404, "NOT_FOUND", "Project not found");
    }

    if (userId === project.owner_id && result.data.role !== OWNER_ROLE) {
        return sendError(
            res,
            409,
            "OWNER_MUST_BE_ADMIN",
            "The project owner must remain an Admin. Transfer ownership to another member first."
        );
    }

    const updatedMember = await updateProjectMember(
        projectId,
        userId,
        result.data.role
    );

    if (!updatedMember) {
        return sendError(res, 404, "NOT_FOUND", "Project member not found");
    }

    await redis.del(membersCacheKey(projectId));
    await redis.del(roleCacheKey(userId, projectId));

    emitToProject(projectId, "memberUpdated", updatedMember);

    return sendSuccess(res, 200, updatedMember);
};

export const deleteProjectMemberController = async (req, res) => {
    const projectId = Number(req.params.projectId);
    const userId = Number(req.params.userId);

    if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(userId) ||
    userId <= 0
) {
    return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid project or user ID",
        []
    );
}

    const project = await getCachedProject(projectId);

    if (!project) {
        return sendError(res, 404, "NOT_FOUND", "Project not found");
    }

    if (userId === project.owner_id) {
        return sendError(
            res,
            409,
            "OWNER_CANNOT_BE_REMOVED",
            "The project owner cannot be removed. Transfer ownership to another member first."
        );
    }

    const deletedMember = await deleteProjectMember(
        projectId,
        userId
    );

    if (!deletedMember) {
        return sendError(res, 404, "NOT_FOUND", "Project member not found");
    }

    await redis.del(membersCacheKey(projectId));
    await redis.del(roleCacheKey(userId, projectId));
    await invalidateProjectListCache([userId]);

    emitToProject(projectId, "memberRemoved", deletedMember);
    removeUserFromProject(projectId, userId);

    return sendSuccess(res, 200, deletedMember);
};