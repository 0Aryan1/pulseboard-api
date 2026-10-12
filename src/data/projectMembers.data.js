import prisma from "../prisma.js";

function isRecordNotFound(error) {
  return error.code === "P2025";
}

function isUniqueConstraintError(error) {
  return error.code === "P2002";
}

function formatProjectMember(member) {
  return {
    id: member.users.id,
    name: member.users.name,
    email: member.users.email,
    role: member.role,
  };
}

export async function getProjectMembers(projectId) {
  const members = await prisma.project_members.findMany({
    where: {
      project_id: projectId,
    },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      user_id: "asc",
    },
  });

  return members.map(formatProjectMember);
}

export async function getProjectMemberIds(projectId) {
  const members = await prisma.project_members.findMany({
    where: { project_id: projectId },
    select: { user_id: true },
  });

  return members.map((member) => member.user_id);
}

export async function getUserProjectIds(userId) {
  const memberships = await prisma.project_members.findMany({
    where: { user_id: userId },
    select: { project_id: true },
  });

  return memberships.map((membership) => membership.project_id);
}

export async function addProjectMember(projectId, userId, role) {
  try {
    return await prisma.project_members.create({
      data: {
        project_id: projectId,
        user_id: userId,
        role,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function updateProjectMember(projectId, userId, role) {
  try {
    return await prisma.project_members.update({
      where: {
        user_id_project_id: {
          user_id: userId,
          project_id: projectId,
        },
      },
      data: {
        role,
      },
    });
  } catch (error) {
    if (isRecordNotFound(error)) return undefined;
    throw error;
  }
}

export async function deleteProjectMember(projectId, userId) {
  try {
    return await prisma.project_members.delete({
      where: {
        user_id_project_id: {
          user_id: userId,
          project_id: projectId,
        },
      },
    });
  } catch (error) {
    if (isRecordNotFound(error)) return undefined;
    throw error;
  }
}
