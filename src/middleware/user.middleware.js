import { sendError } from "../utils/response.js";

export const userOwnershipMiddleware = async (req, res, next) => {
    const userId = req.user.id;
    const resourceId = Number(req.params.userId);

    if (userId !== resourceId) {
        return sendError(
            res,
            403,
            "FORBIDDEN",
            "You do not have permission to access or modify this user"
        );
    }

    next();
};
