import jwt from "jsonwebtoken";
import { createAuthUser, EmailTakenError } from "../data/users.data.js";
import { signupSchema, loginSchema } from "../schemas/auth.schema.js";
import { authenticateUser } from "../data/users.data.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { formatValidationErrors } from "../utils/validation.js";

export const signupController = async (req, res) => {
    const result = signupSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Invalid signup data",
            formatValidationErrors(result.error.issues)
        );
    }

    try {
        const user = await createAuthUser(result.data);

        return sendSuccess(res, 201, user);
    } catch (error) {
        if (error instanceof EmailTakenError) {
            return sendError(res, 409, "EMAIL_TAKEN", error.message);
        }

        throw error;
    }
};

export const loginController = async (req, res) => {
    const result = loginSchema.safeParse(req.body);

    if (!result.success) {
        return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Invalid login data",
            formatValidationErrors(result.error.issues)
        );
    }

    const { email, password } = result.data;

    const user = await authenticateUser(email, password);

    if (!user) {
        return sendError(
            res,
            401,
            "INVALID_CREDENTIALS",
            "Invalid email or password"
        );
    }

    const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
    );

    return sendSuccess(res, 200, {
        token
    });
};