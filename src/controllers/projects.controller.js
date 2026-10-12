import {getAllProjectsData, getProjectById, createProject, updateProject, deleteProject, transferProjectOwnership} from "../data/projects.data.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { createProjectSchema, updateProjectSchema, transferOwnershipSchema } from "../schemas/project.schema.js";
import { formatValidationErrors } from "../utils/validation.js";
import { closeProjectRoom, emitToProject } from "../socket.js";

export const getAllProjectsController = async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 15;
    const userId = req.user.id;

    const projects = await getAllProjectsData(userId, page, limit);

    return sendSuccess(res, 200, projects);
};

export const getProjectByIdController = async (req, res) => {
    const projectId = Number(req.params.projectId);

    const project = await getProjectById(projectId);

    if (!project) {
        return sendError(res, 404, "NOT_FOUND", "Project not found");
    }

    return sendSuccess(res, 200, project);
};

export const createProjectController = async (req, res) => {
  const result = createProjectSchema.safeParse(req.body);

  if (!result.success) return sendError(res, 400,  "VALIDATION_ERROR","Invalid project data", formatValidationErrors(result.error.issues));

  const newProject = await createProject({
    ...result.data,
    userId: req.user.id
  });

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

    emitToProject(projectId, "projectUpdated", updatedProject);

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

    const deletedProject = await deleteProject(projectId);

    if (!deletedProject) return sendError(res, 404, "NOT_FOUND", "Project not found");

    closeProjectRoom(projectId, req.user.id);

    return sendSuccess(res, 200, deletedProject);
};