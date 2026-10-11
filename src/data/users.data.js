import prisma from "../prisma.js";
import bcrypt from "bcrypt";

function isRecordNotFound(error) {
    return error.code === "P2025";
}

function isUniqueConstraintError(error) {
    return error.code === "P2002";
}

// Thrown instead of Prisma's P2002 so callers can answer 409 rather than 500.
export class EmailTakenError extends Error {
    constructor() {
        super("An account with this email already exists");
        this.name = "EmailTakenError";
    }
}

export async function createAuthUser(userData) {
    const { name, email, password } = userData;

    const passwordHash = await bcrypt.hash(password, 10);

    try {
        return await prisma.users.create({
            data: {
                name,
                email,
                password_hash: passwordHash
            },
            select: {
                id: true,
                name: true,
                email: true,
                created_at: true
            }
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) throw new EmailTakenError();
        throw error;
    }
}

export async function authenticateUser(email, password) {
    const user = await prisma.users.findUnique({
        where: {
            email
        }
    });

    if (!user || !user.password_hash) {
        return null;
    }

    const passwordMatches = await bcrypt.compare(
        password,
        user.password_hash
    );

    if (!passwordMatches) {
        return null;
    }

    return {
        id: user.id,
        name: user.name,
        email: user.email
    };
}

export async function getAllUsers(page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    return await prisma.users.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            created_at: true
        },
        orderBy: {
            id: "asc"
        },
        skip: offset,
        take: limit
    });
}

export async function getUserById(userId) {
    return await prisma.users.findUnique({
        where: {
            id: userId
        },
        select: {
            id: true,
            name: true,
            email: true,
            created_at: true
        }
    });
}

export async function updateUser(userId, userData) {
    const { name, email } = userData;

    try {
        return await prisma.users.update({
            where: {
                id: userId
            },
            data: {
                name,
                email
            },
            select: {
                id: true,
                name: true,
                email: true,
                created_at: true
            }
        });
    } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        if (isUniqueConstraintError(error)) throw new EmailTakenError();
        throw error;
    }
} 

export async function deleteUser(userId) {
    try {
        return await prisma.users.delete({
            where: {
                id: userId
            },
            select: {
                id: true,
                name: true,
                email: true,
                created_at: true
            }
        });
    } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        throw error;
    }
}   
