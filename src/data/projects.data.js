import prisma from "../prisma.js";

function isRecordNotFound(error) {
    return error.code === "P2025";
}

export async function getAllProjectsData(userId, page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    return await prisma.projects.findMany({
        where: {
            project_members: {
                some: {
                    user_id: userId
                }
            }
        },

        orderBy: {
            id: "asc"
        },

        skip: offset,
        take: limit
    });
}

export async function getProjectById(projectId) {
    return await prisma.projects.findUnique({
        where: {
            id: projectId
        }
    });
}

export async function countOwnedProjects(userId) {
    return await prisma.projects.count({
        where: {
            owner_id: userId
        }
    });
}

export async function updateProject(projectId, projectData) {
    const { title, description } = projectData;

    try {
        return await prisma.projects.update({
            where: {
                id: projectId
            },
            data: {
                title,
                description
            }
        });
    } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        throw error;
    }
}

export async function deleteProject(projectId) {
    try {
        return await prisma.projects.delete({
            where: {
                id: projectId
            }
        });
    } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        throw error;
    }
}

export async function createProject(projectData) {
    const { title, description, userId } = projectData;

    const project = await prisma.$transaction(async (tx) => {

        // 1. Create project
        const newProject = await tx.projects.create({
            data: {
                title,
                description,
                owner_id: userId
            }
        });

        // 2. Add owner as project member
        await tx.project_members.create({
            data: {
                user_id: userId,
                project_id: newProject.id,
                role: "Admin"
            }
        });

        // 3. Both operations succeeded
        return newProject;
    });

    return project;
}

/**
 * Hands ownership of a project to another of its members.
 *
 * The membership check and both writes share one transaction so a member
 * cannot be removed between the check and the update, which would otherwise
 * leave owner_id pointing at a non-member.
 *
 * Returns undefined when the target user is not a member of the project.
 */
export async function transferProjectOwnership(projectId, newOwnerId) {
    return await prisma.$transaction(async (tx) => {
        const membership = await tx.project_members.findUnique({
            where: {
                user_id_project_id: {
                    user_id: newOwnerId,
                    project_id: projectId
                }
            }
        });

        if (!membership) {
            return undefined;
        }

        // The owner always holds Admin, so promote the incoming owner first.
        await tx.project_members.update({
            where: {
                user_id_project_id: {
                    user_id: newOwnerId,
                    project_id: projectId
                }
            },
            data: {
                role: "Admin"
            }
        });

        // The outgoing owner keeps their Admin membership and simply stops
        // being the owner, so they can then be demoted or removed normally.
        return await tx.projects.update({
            where: {
                id: projectId
            },
            data: {
                owner_id: newOwnerId
            }
        });
    });
}
