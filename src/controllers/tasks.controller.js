import { sendError, sendSuccess } from "../utils/response.js";
import { createTaskSchema, updateTaskSchema } from "../schemas/task.schema.js";
import { formatValidationErrors } from "../utils/validation.js";
import {
  getProjectTasks,
  getProjectTasksById,
  createProjectTasks,
  updateProjectTasks,
  deleteProjectTasks,
} from "../data/tasks.data.js";
import { emitToProject } from "../socket.js";

export const getProjectTasksController = async (req, res) => {
  const projectId = Number(req.params.projectId);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid project ID", []);
  }

  const tasks = await getProjectTasks(projectId);

  return sendSuccess(res, 200, tasks);
};

export const getProjectTasksByIdController = async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const tasks = await getProjectTasksById(projectId, taskId);

  if (!tasks) {
    return sendError(
      res,
      404,
      "NOT_FOUND",
      "Task not found",
      formatValidationErrors([
        {
          path: ["taskId"],
          message: "Task with the specified ID does not exist",
        },
      ]),
    );
  }

  return sendSuccess(res, 200, tasks);
};

export const createProjectTaskController = async (req, res) => {
  const projectId = Number(req.params.projectId);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid project ID", []);
  }

  const result = createTaskSchema.safeParse(req.body);

  if (!result.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid task data",
      formatValidationErrors(result.error.issues),
    );
  }

  const task = await createProjectTasks(projectId, result.data, req.user.id);

  emitToProject(projectId, "taskCreated", task);

  return sendSuccess(res, 201, task);
};

export const updateProjectTaskController = async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const result = updateTaskSchema.safeParse(req.body);

  if (!result.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid task data",
      formatValidationErrors(result.error.issues),
    );
  }

  const updatedTask = await updateProjectTasks(projectId, taskId, result.data);

  if (!updatedTask) {
    return sendError(
      res,
      404,
      "NOT_FOUND",
      "Task not found",
      formatValidationErrors([
        {
          path: ["taskId"],
          message: "Task with the specified ID does not exist",
        },
      ]),
    );
  }

  emitToProject(projectId, "taskUpdated", updatedTask);

  return sendSuccess(res, 200, updatedTask);
};

export const deleteProjectTaskController = async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const deletedTask = await deleteProjectTasks(projectId, taskId);

  if (!deletedTask) {
    return sendError(
      res,
      404,
      "NOT_FOUND",
      "Task not found",
      formatValidationErrors([
        {
          path: ["taskId"],
          message: "Task with the specified ID does not exist",
        },
      ]),
    );
  }

  emitToProject(projectId, "taskDeleted", deletedTask);

  return sendSuccess(res, 200, deletedTask);
};
