import prisma from "../prisma.js";

export function formatTask(task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    project_id: task.project_id,
    created_at: task.created_at,
    created_by: task.users?.id ?? task.created_by,
    created_by_name: task.users?.name,
    created_by_email: task.users?.email,
  };
}

export async function getProjectTasks(projectId) {
  const tasks = await prisma.tasks.findMany({
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
      id: "asc",
    },
  });

  return tasks.map(formatTask);
}

export async function getProjectTasksById(projectId, taskId) {
  const task = await prisma.tasks.findFirst({
    where: {
      project_id: projectId,
      id: taskId,
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
  });

  return task ? formatTask(task) : undefined;
}

export async function createProjectTasks(projectId, taskData, userId) {
  const { title, description, status } = taskData;

  return await prisma.tasks.create({
    data: {
      title,
      description,
      status,
      project_id: projectId,
      created_by: userId,
    },
  });
}

export async function updateProjectTasks(projectId, taskId, taskData) {
    const { title, description, status } = taskData;

    const task = await prisma.tasks.findFirst({
        where: {
            id: taskId,
            project_id: projectId
        }
    });

    if (!task) {
        return undefined;
    }

    return await prisma.tasks.update({
        where: {
            id: taskId
        },
        data: {
            title,
            description,
            status
        }
    });
}

export async function deleteProjectTasks(projectId, taskId) {

    const task = await prisma.tasks.findFirst({
        where: {
            id: taskId,
            project_id: projectId
        }
    });

    if (!task) {
        return undefined;
    }

    return await prisma.tasks.delete({
        where: {
            id: taskId
        }
    });
}
