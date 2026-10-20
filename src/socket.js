import jwt from "jsonwebtoken";
import prisma from "./prisma.js";
import logger from "./logger.js";

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
        logger.info({ socketId: socket.id }, "Socket connected");

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

            logger.info({ userId: socket.user.id, room }, "User joined project room");
        });

        socket.on("leaveProject", (projectId) => {
            const room = `project:${projectId}`;

            socket.leave(room);

            logger.info({ socketId: socket.id, room }, "Socket left project room");
        });

        socket.on("disconnect", () => {
            logger.info({ socketId: socket.id }, "Socket disconnected");
        });
    });
}

function getIo() {
    if (!ioInstance) {
        logger.error("Socket.io is not initialized");
    }

    return ioInstance;
}

const projectRoom = (projectId) => `project:${projectId}`;
const userRoom = (userId) => `user:${userId}`;

// One emit to several rooms reaches each socket once, even if it is in more
// than one of them (e.g. a project page is in both its project and user room).
function emitToRooms(rooms, event, data) {
    getIo()?.to(rooms).emit(event, data);
}

export function emitToProject(projectId, event, data) {
    emitToRooms([projectRoom(projectId)], event, data);
}

export function emitToUser(userId, event, data) {
    emitToRooms([userRoom(userId)], event, data);
}

// For changes that also show outside the project page, e.g. on the projects list.
export function emitToProjectAndMembers(projectId, memberIds, event, data) {
    emitToRooms([projectRoom(projectId), ...memberIds.map(userRoom)], event, data);
}

// For changes to a user that their teammates and their own other tabs show.
export function emitToUserAndProjects(userId, projectIds, event, data) {
    emitToRooms([userRoom(userId), ...projectIds.map(projectRoom)], event, data);
}

export function emitToProjects(projectIds, event, data) {
    if (projectIds.length === 0) return;

    emitToRooms(projectIds.map(projectRoom), event, data);
}

/**
 * Membership is only checked when a socket joins a project room, so a removed
 * member's open tabs must be taken out of the room explicitly; otherwise they
 * keep receiving the project's events.
 */
export function removeUserFromProject(projectId, userId) {
    const io = getIo();
    if (!io) return;

    io.in(userRoom(userId)).socketsLeave(projectRoom(projectId));
    io.to(userRoom(userId)).emit("removedFromProject", { projectId });
}

/**
 * Announces a deleted project to everyone viewing it and to its members'
 * other tabs, then empties its room so no socket lingers in a room that no
 * longer has a project behind it.
 */
export function closeProjectRoom(projectId, deletedBy, memberIds = []) {
    const io = getIo();
    if (!io) return;

    emitToProjectAndMembers(projectId, memberIds, "projectDeleted", { projectId, deletedBy });
    io.in(projectRoom(projectId)).socketsLeave(projectRoom(projectId));
}

// A deleted account should not stay connected through an old token.
export function disconnectUser(userId) {
    getIo()?.in(userRoom(userId)).disconnectSockets(true);
}
