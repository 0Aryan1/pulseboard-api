
import { jest } from "@jest/globals";

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.unstable_mockModule("../src/prisma.js", () => ({
  default: {
    tasks: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

const {
  getProjectTasks,
  getProjectTasksById,
  createProjectTasks,
  updateProjectTasks,
  deleteProjectTasks,
} = await import("../src/data/tasks.data.js");

describe("getProjectTasksById", () => {
  test("returns undefined when the task is not found", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await getProjectTasksById(10, 999);

    expect(result).toBeUndefined();

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project_id: 10,
          id: 999,
        }),
      }),
    );
  });

  test("returns the formatted task when found", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    mockFindFirst.mockResolvedValue({
      id: 999,
      title: "Learn testing",
      description: "Practice Jest",
      status: "Pending",
      project_id: 10,
      created_by: 7,
      created_at: createdAt,
      users: {
        id: 7,
        name: "Aryan",
        email: "aryan@example.com",
      },
    });

    const result = await getProjectTasksById(10, 999);

    expect(result).toEqual({
      id: 999,
      title: "Learn testing",
      description: "Practice Jest",
      status: "Pending",
      project_id: 10,
      created_at: createdAt,
      created_by: 7,
      created_by_name: "Aryan",
      created_by_email: "aryan@example.com",
    });
  });
});

describe("getProjectTasks", () => {
  test("fetches and formats tasks for a project", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 1,
        title: "Learn testing",
        description: "Write unit tests",
        status: "Pending",
        project_id: 10,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        created_by: 7,
        users: {
          id: 7,
          name: "Aryan",
          email: "aryan@example.com",
        },
      },
    ]);

    const result = await getProjectTasks(10);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project_id: 10,
        },
        orderBy: { id: "asc" },
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Learn testing");
    expect(result[0].created_by_name).toBe("Aryan");
  });

  test("returns an empty array when the project has no tasks", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await getProjectTasks(10);

    expect(result).toEqual([]);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test("propagates errors from the database", async () => {
    mockFindMany.mockRejectedValue(new Error("Database error"));

    await expect(getProjectTasks(10)).rejects.toThrow("Database error");
  });
});

describe("createProjectTasks", () => {
  test("creates a task for the project and user", async () => {
    const createdTask = {
      id: 1,
      title: "Learn testing",
      description: "Write unit tests",
      status: "Pending",
      project_id: 10,
      created_by: 7,
    };
    mockCreate.mockResolvedValue(createdTask);

    const result = await createProjectTasks(
      10,
      {
        title: "Learn testing",
        description: "Write unit tests",
        status: "Pending",
      },
      7,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        title: "Learn testing",
        description: "Write unit tests",
        status: "Pending",
        project_id: 10,
        created_by: 7,
      },
    });
    expect(result).toEqual(createdTask);
  });

  test("ignores project_id and created_by from the task data", async () => {
    mockCreate.mockResolvedValue({ id: 1 });

    await createProjectTasks(
      10,
      {
        title: "Learn testing",
        description: "Write unit tests",
        status: "Pending",
        project_id: 99,
        created_by: 42,
      },
      7,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 10,
        created_by: 7,
      }),
    });
  });

  test("propagates errors from the database", async () => {
    mockCreate.mockRejectedValue(new Error("Database error"));

    await expect(
      createProjectTasks(
        10,
        {
          title: "Learn testing",
          description: "Write unit tests",
          status: "Pending",
        },
        7,
      ),
    ).rejects.toThrow("Database error");
  });
});

describe("updateProjectTasks", () => {
  test("returns undefined and skips update when the task is not in the project", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await updateProjectTasks(10, 999, { title: "New title" });

    expect(result).toBeUndefined();
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        id: 999,
        project_id: 10,
      },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("updates and returns the task when found", async () => {
    mockFindFirst.mockResolvedValue({ id: 1, project_id: 10 });
    const updatedTask = {
      id: 1,
      title: "New title",
      description: "New description",
      status: "Done",
      project_id: 10,
    };
    mockUpdate.mockResolvedValue(updatedTask);

    const result = await updateProjectTasks(10, 1, {
      title: "New title",
      description: "New description",
      status: "Done",
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        title: "New title",
        description: "New description",
        status: "Done",
      },
    });
    expect(result).toEqual(updatedTask);
  });

  test("only updates title, description and status", async () => {
    mockFindFirst.mockResolvedValue({ id: 1, project_id: 10 });
    mockUpdate.mockResolvedValue({ id: 1 });

    await updateProjectTasks(10, 1, {
      title: "New title",
      project_id: 99,
      created_by: 42,
    });

    const { data } = mockUpdate.mock.calls[0][0];
    expect(data).not.toHaveProperty("project_id");
    expect(data).not.toHaveProperty("created_by");
    expect(data.title).toBe("New title");
  });

  test("propagates errors from the database", async () => {
    mockFindFirst.mockResolvedValue({ id: 1, project_id: 10 });
    mockUpdate.mockRejectedValue(new Error("Database error"));

    await expect(
      updateProjectTasks(10, 1, { title: "New title" }),
    ).rejects.toThrow("Database error");
  });
});

describe("deleteProjectTasks", () => {
  test("returns undefined and skips delete when the task is not in the project", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await deleteProjectTasks(10, 999);

    expect(result).toBeUndefined();
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        id: 999,
        project_id: 10,
      },
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test("deletes and returns the task when found", async () => {
    const task = { id: 1, title: "Learn testing", project_id: 10 };
    mockFindFirst.mockResolvedValue(task);
    mockDelete.mockResolvedValue(task);

    const result = await deleteProjectTasks(10, 1);

    expect(mockDelete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
    expect(result).toEqual(task);
  });

  test("propagates errors from the database", async () => {
    mockFindFirst.mockResolvedValue({ id: 1, project_id: 10 });
    mockDelete.mockRejectedValue(new Error("Database error"));

    await expect(deleteProjectTasks(10, 1)).rejects.toThrow("Database error");
  });
});
