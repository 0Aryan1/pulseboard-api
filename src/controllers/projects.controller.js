import {getAllProjectsData, getProjectById, createProject, updateProject, deleteProject, transferProjectOwnership} from "../data/projects.data.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { createProjectSchema, updateProjectSchema, transferOwnershipSchema } from "../schemas/project.schema.js";
import { formatValidationErrors } from "../utils/validation.js";
import { getProjectMemberIds } from "../data/projectMembers.data.js";
import { closeProjectRoom, emitToProject, emitToProjectAndMembers } from "../socket.js";
import redis from "../redis.js";
import { roleCacheKey } from "../middleware/projectRole.middleware.js";

export const getAllProjectsController = async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 15;
    const userId = req.user.id;

    const cacheKey = `projects:user:${userId}:page:${page}:limit:${limit}`;

    const cachedProjects = await redis.get(cacheKey);

    if (cachedProjects) {
    console.log("CACHE HIT: Returning projects from Redis");

    await redis.sadd(
        `projects:user:${userId}:cache-keys`,
        cacheKey
    );

    await redis.expire(
        `projects:user:${userId}:cache-keys`,
        180
    );

    return sendSuccess(res, 200, JSON.parse(cachedProjects));
}

    console.log("CACHE MISS: Fetching projects from PostgreSQL");

    const projects = await getAllProjectsData(userId, page, limit);

    await redis.set(cacheKey, JSON.stringify(projects), "EX", 120);
    await redis.sadd(`projects:user:${userId}:cache-keys`, cacheKey);
    await redis.expire(`projects:user:${userId}:cache-keys`, 180);

    return sendSuccess(res, 200, projects);
};

export const getProjectByIdController = async (req, res) => {
    const projectId = Number(req.params.projectId);

    const cacheKey = projectCacheKey(projectId);
    const cached = await redis.get(cacheKey);

    if (cached) {
        return sendSuccess(res, 200, JSON.parse(cached));
    }

    const project = await getProjectById(projectId);

    if (!project) {
        return sendError(res, 404, "NOT_FOUND", "Project not found");
    }

    await redis.set(cacheKey, JSON.stringify(project), "EX", 120);

    return sendSuccess(res, 200, project);
};

export const createProjectController = async (req, res) => {
  const result = createProjectSchema.safeParse(req.body);

  if (!result.success) return sendError(res, 400,  "VALIDATION_ERROR","Invalid project data", formatValidationErrors(result.error.issues));

  const newProject = await createProject({
    ...result.data,
    userId: req.user.id
  });

  await invalidateProjectListCache([req.user.id]);

  return sendSuccess(res, 201, newProject);
};

export const updateProjectController = async (req,res) => {

    const projectId = Number(req.params.projectId);
    const result = updateProjectSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid project data", formatValidationErrors(result.error.issues));
    }

    const updatedProject = await updateProject(projectId, result.data);

    if (!updatedProject) return sendError(res, 404, "NOT_FOUND", "Project not found");

    // Members on the projects list see the new title too.
    const memberIds = await getProjectMemberIds(projectId);
    await invalidateProjectListCache(memberIds);
    await redis.del(projectCacheKey(projectId));
    emitToProjectAndMembers(projectId, memberIds, "projectUpdated", updatedProject);

    return sendSuccess(res, 200, updatedProject);
}

export const transferProjectOwnershipController = async (req, res) => {
    const projectId = Number(req.params.projectId);

    const result = transferOwnershipSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Invalid ownership transfer data",
            formatValidationErrors(result.error.issues)
        );
    }

    const project = await getProjectById(projectId);

    if (!project) {
        return sendError(res, 404, "NOT_FOUND", "Project not found");
    }

    // Gated to Admins by the route, but only the current owner may hand over
    // ownership — otherwise a second Admin could seize the project.
    if (req.user.id !== project.owner_id) {
        return sendError(
            res,
            403,
            "FORBIDDEN",
            "Only the project owner can transfer ownership"
        );
    }

    if (result.data.userId === project.owner_id) {
        return sendError(
            res,
            409,
            "ALREADY_OWNER",
            "That user already owns this project"
        );
    }

    const updatedProject = await transferProjectOwnership(
        projectId,
        result.data.userId
    );

    if (!updatedProject) {
        return sendError(
            res,
            404,
            "NOT_FOUND",
            "That user is not a member of this project"
        );
    }

    await redis.del(projectCacheKey(projectId));
    await redis.del(roleCacheKey(result.data.userId, projectId));
    emitToProject(projectId, "projectUpdated", updatedProject);
    // The new owner was promoted to Admin in the same transaction.
    emitToProject(projectId, "memberUpdated", {
        project_id: projectId,
        user_id: result.data.userId,
        role: "Admin"
    });

    return sendSuccess(res, 200, updatedProject);
};

export const deleteProjectController = async (req, res) => {
    const projectId = Number(req.params.projectId);

    // Read before deleting: the delete cascades to the memberships.
    const memberIds = await getProjectMemberIds(projectId);

    const deletedProject = await deleteProject(projectId);

    if (!deletedProject) return sendError(res, 404, "NOT_FOUND", "Project not found");

    await invalidateProjectListCache(memberIds);
    await redis.del(projectCacheKey(projectId));
    await redis.del(`members:project:${projectId}`);
    await redis.del(`tasks:project:${projectId}`);

    closeProjectRoom(projectId, req.user.id, memberIds);

    return sendSuccess(res, 200, deletedProject);
};

export function projectCacheKey(projectId) {
    return `project:${projectId}`;
}

export async function invalidateProjectListCache(userIds) {
    for (const userId of userIds) {
        const setKey = `projects:user:${userId}:cache-keys`;
        const cacheKeys = await redis.smembers(setKey);

        if (cacheKeys.length > 0) {
            await redis.del(...cacheKeys);
        }

        await redis.del(setKey);
    }
}