import { getAllUsers, getUserById, updateUser, deleteUser, EmailTakenError } from "../data/users.data.js";
import { countOwnedProjects } from "../data/projects.data.js";
import { getUserProjectIds } from "../data/projectMembers.data.js";
import { disconnectUser, emitToProjects, emitToUserAndProjects } from "../socket.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { updateUserSchema } from "../schemas/user.schema.js";
import { formatValidationErrors } from "../utils/validation.js";



export const getAllUsersController = async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const users = await getAllUsers(page, limit);

    return sendSuccess(res, 200, users);
};

export const getUserByIdController = async (req, res) => {
    const userId = Number(req.params.userId);

    const user = await getUserById(userId);

    if (!user) {
        return sendError(res, 404, "NOT_FOUND", "User not found", formatValidationErrors([{ path: ["userId"], message: "User with the specified ID does not exist" }]));
    }
    
    return sendSuccess(res, 200, user);
};

export const updateUserController = async (req, res) => {
    const userId = Number(req.params.userId);
    const result = updateUserSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid user data", formatValidationErrors(result.error.issues));
    }

    let updatedUser;

    try {
        updatedUser = await updateUser(userId, result.data);
    } catch (error) {
        if (error instanceof EmailTakenError) {
            return sendError(res, 409, "EMAIL_TAKEN", error.message);
        }

        throw error;
    }

    if (!updatedUser) {
        return sendError(res, 404, "NOT_FOUND", "User not found");
    }

    // Teammates see the new name; the user's other tabs refresh their profile.
    const projectIds = await getUserProjectIds(userId);
    emitToUserAndProjects(userId, projectIds, "userUpdated", updatedUser);

    return sendSuccess(res, 200, updatedUser);
};

export const deleteUserController = async (req, res) => {
    const userId = Number(req.params.userId);

    // projects.owner_id has no cascade, so the database would refuse the delete.
    if (await countOwnedProjects(userId) > 0) {
        return sendError(
            res,
            409,
            "OWNER_HAS_PROJECTS",
            "Transfer or delete the projects you own before deleting your account."
        );
    }

    // Read before deleting: the delete cascades to the memberships.
    const projectIds = await getUserProjectIds(userId);

    const deletedUser = await deleteUser(userId);

    if (!deletedUser) {
        return sendError(res, 404, "NOT_FOUND", "User not found");
    }

    emitToProjects(projectIds, "userDeleted", { id: userId });
    disconnectUser(userId);

    return sendSuccess(res, 200, deletedUser);
};