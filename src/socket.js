import jwt from "jsonwebtoken";
import prisma from "./prisma.js";

let ioInstance = null;

export function setupSocket(io) {
    ioInstance = io;

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("Authentication required"));
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return next(new Error("Invalid or expired token"));
            }

            socket.user = {
                id: decoded.userId
            };

            next();
        });
    });

    io.on("connection", (socket) => {
        console.log("Socket connected:", socket.id);

        // Lets the server reach all of a user's tabs, e.g. to remove them
        // from a project they no longer belong to.
        socket.join(`user:${socket.user.id}`);

        socket.on("joinProject", async (projectId) => {
            const numericProjectId = Number(projectId);

            if (
                !Number.isInteger(numericProjectId) ||
                numericProjectId <= 0
            ) {
                socket.emit("projectError", "Invalid project ID");
                return;
            }

            const membership = await prisma.project_members.findUnique({
                where: {
                    user_id_project_id: {
                        user_id: socket.user.id,
                        project_id: numericProjectId
                    }
                }
            });

            if (!membership) {
                socket.emit(
                    "projectError",
                    "You do not have access to this project"
                );
                return;
            }

            const room = `project:${numericProjectId}`;

            socket.join(room);

            console.log(
                `User ${socket.user.id} joined ${room}`
            );
        });

        socket.on("leaveProject", (projectId) => {
            const room = `project:${projectId}`;

            socket.leave(room);

            console.log(
                `Socket ${socket.id} left ${room}`
            );
        });

        socket.on("disconnect", () => {
            console.log(
                "Socket disconnected:",
                socket.id
            );
        });
    });
}

/**
 * Membership is only checked when a socket joins a project room, so a removed
 * member's open tabs must be taken out of the room explicitly; otherwise they
 * keep receiving the project's events.
 */
export function removeUserFromProject(projectId, userId) {
    if (!ioInstance) {
        console.error("Socket.io is not initialized");
        return;
    }

    ioInstance.in(`user:${userId}`).socketsLeave(`project:${projectId}`);
    ioInstance.to(`user:${userId}`).emit("removedFromProject", { projectId });
}

/**
 * Announces a deleted project to everyone viewing it, then empties its room so
 * no socket lingers in a room that no longer has a project behind it.
 */
export function closeProjectRoom(projectId, deletedBy) {
    if (!ioInstance) {
        console.error("Socket.io is not initialized");
        return;
    }

    const room = `project:${projectId}`;

    ioInstance.to(room).emit("projectDeleted", { projectId, deletedBy });
    ioInstance.in(room).socketsLeave(room);
}

export function emitToProject(projectId, event, data) {
    if (!ioInstance) {
        console.error("Socket.io is not initialized");
        return;
    }

    const room = `project:${projectId}`;

    ioInstance.to(room).emit(event, data);
}