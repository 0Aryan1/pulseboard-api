
import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";

jest.unstable_mockModule("../src/socket.js", () => ({
  emitToProject: jest.fn(),
  removeUserFromProject: jest.fn(),
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/prisma.js");
const { uploadQueue } = await import("../src/queue.js");

describe("Tasks API integration", () => {
  let token;
  let userId;
  let projectId;

  const email = `test-${randomUUID()}@example.com`;
  const password = "TestPassword123!";

  beforeAll(async () => {
    const signupResponse = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Integration Tester",
        email,
        password,
      });

    expect(signupResponse.statusCode).toBe(201);

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });

    expect(loginResponse.statusCode).toBe(200);
    token = loginResponse.body.data.token;

    const user = await prisma.users.findUnique({
      where: { email },
    });

    expect(user).not.toBeNull();
    userId = user.id;

    const project = await prisma.projects.create({
      data: {
        title: "Integration Test Project",
        description: "Created for automated tests",
        owner_id: userId,
      },
    });

    projectId = project.id;

    await prisma.project_members.create({
      data: {
        user_id: userId,
        project_id: projectId,
        role: "Admin",
      },
    });
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.projects.deleteMany({
        where: { id: projectId },
      });
    }

    if (userId) {
      await prisma.users.deleteMany({
        where: { id: userId },
      });
    }

    await prisma.$disconnect();
    await uploadQueue.close();
  });

  test("POST creates a task in the database", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Test task",
        description: "Created by an integration test",
        status: "Pending",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.title).toBe("Test task");
    expect(response.body.data.project_id).toBe(projectId);
    expect(response.body.data.created_by).toBe(userId);

    const savedTask = await prisma.tasks.findUnique({
      where: { id: response.body.data.id },
    });

    expect(savedTask).not.toBeNull();
    expect(savedTask.title).toBe("Test task");
  });


  
  test("POST rejects unauthenticated requests without saving a task", async () => {
    const beforeCount = await prisma.tasks.count({
      where: { project_id: projectId },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .send({
        title: "Unauthorized task",
        description: "Should not be created",
        status: "Pending",
      });

    expect(response.statusCode).toBe(401);
    expect(response.body.success).toBe(false);

    const afterCount = await prisma.tasks.count({
      where: { project_id: projectId },
    });

    expect(afterCount).toBe(beforeCount);
  });


  
  test("POST rejects invalid task data without saving a task", async () => {
    const beforeCount = await prisma.tasks.count({
      where: { project_id: projectId },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "",
        description: "Invalid task",
        status: "Pending",
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.success).toBe(false);

    const afterCount = await prisma.tasks.count({
      where: { project_id: projectId },
    });

    expect(afterCount).toBe(beforeCount);
  });



  test("POST rejects a user who is not a project member", async () => {
    const otherEmail = `outsider-${randomUUID()}@example.com`;

    const signupResponse = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Project Outsider",
        email: otherEmail,
        password: "TestPassword123!",
      });

    expect(signupResponse.statusCode).toBe(201);

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: otherEmail,
        password: "TestPassword123!",
      });

    expect(loginResponse.statusCode).toBe(200);

    const outsiderToken = loginResponse.body.data.token;

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({
        title: "Unauthorized project task",
        description: "Should not be created",
        status: "Pending",
      });

    expect(response.statusCode).toBe(403);
    expect(response.body.success).toBe(false);

    // Clean up the additional test user.
    await prisma.users.deleteMany({
      where: { email: otherEmail },
    });
  });


  test("POST rejects an invalid task status without saving a task", async () => {
    const beforeCount = await prisma.tasks.count({
      where: { project_id: projectId },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Invalid status task",
        description: "Should not be created",
        status: "Unknown",
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.success).toBe(false);

    const afterCount = await prisma.tasks.count({
      where: { project_id: projectId },
    });

    expect(afterCount).toBe(beforeCount);
  });



test("PUT updates an existing task", async () => {
  const createResponse = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Task before update",
      description: "Original description",
      status: "Pending",
    });

  expect(createResponse.statusCode).toBe(201);

  const taskId = createResponse.body.data.id;

  const updateResponse = await request(app)
    .put(`/api/v1/projects/${projectId}/tasks/${taskId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Task after update",
      description: "Updated description",
      status: "In Progress",
    });

  expect(updateResponse.statusCode).toBe(200);
  expect(updateResponse.body.success).toBe(true);
  expect(updateResponse.body.data.title).toBe("Task after update");
  expect(updateResponse.body.data.status).toBe("In Progress");

  const savedTask = await prisma.tasks.findUnique({
    where: { id: taskId },
  });

  expect(savedTask.title).toBe("Task after update");
  expect(savedTask.status).toBe("In Progress");
});


test("PUT rejects invalid task data without updating the task", async () => {
  const createResponse = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Task to protect",
      description: "Original description",
      status: "Pending",
    });

  expect(createResponse.statusCode).toBe(201);

  const taskId = createResponse.body.data.id;

  const response = await request(app)
    .put(`/api/v1/projects/${projectId}/tasks/${taskId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "",
      description: "Invalid update",
      status: "Pending",
    });

  expect(response.statusCode).toBe(400);
  expect(response.body.success).toBe(false);

  const savedTask = await prisma.tasks.findUnique({
    where: { id: taskId },
  });

  expect(savedTask.title).toBe("Task to protect");
  expect(savedTask.description).toBe("Original description");
  expect(savedTask.status).toBe("Pending");
});


test("PUT returns 400 when the task id is not a number", async () => {
  const response = await request(app)
    .put(`/api/v1/projects/${projectId}/tasks/abc`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Updated task",
      description: "Testing invalid IDs",
      status: "Pending",
    });

  expect(response.statusCode).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toBeUndefined();
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
  expect(response.body.error.message).toBe("Invalid project or task ID");
  expect(response.body.error.details).toEqual([]);
});


test("PUT returns 404 when the task does not exist", async () => {
  const response = await request(app)
    .put(`/api/v1/projects/${projectId}/tasks/999999999`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Updated task",
      description: "Testing a missing task",
      status: "Pending",
    });

  expect(response.statusCode).toBe(404);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toBeUndefined();
  expect(response.body.error.code).toBe("NOT_FOUND");
  expect(response.body.error.message).toBe("Task not found");
  expect(response.body.error.details).toEqual([
    {
      field: "taskId",
      message: "Task with the specified ID does not exist",
    },
  ]);
});


test("DELETE removes an existing task", async () => {
  const createResponse = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Task to delete",
      description: "Will be deleted by the test",
      status: "Pending",
    });

  expect(createResponse.statusCode).toBe(201);

  const taskId = createResponse.body.data.id;

  const deleteResponse = await request(app)
    .delete(`/api/v1/projects/${projectId}/tasks/${taskId}`)
    .set("Authorization", `Bearer ${token}`);

  expect(deleteResponse.statusCode).toBe(200);
  expect(deleteResponse.body.success).toBe(true);

  const deletedTask = await prisma.tasks.findUnique({
    where: { id: taskId },
  });

  expect(deletedTask).toBeNull();
});


test("DELETE rejects a non-member of the project", async () => {
  const createResponse = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Protected task",
      description: "Must not be deleted by an outsider",
      status: "Pending",
    });

  expect(createResponse.statusCode).toBe(201);

  const taskId = createResponse.body.data.id;

  const outsiderEmail = `outsider-${randomUUID()}@example.com`;

  try {
    const signupResponse = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Project Outsider",
        email: outsiderEmail,
        password: "TestPassword123!",
      });

    expect(signupResponse.statusCode).toBe(201);

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: outsiderEmail,
        password: "TestPassword123!",
      });

    expect(loginResponse.statusCode).toBe(200);

    const outsiderToken = loginResponse.body.data.token;

    const deleteResponse = await request(app)
      .delete(`/api/v1/projects/${projectId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(deleteResponse.statusCode).toBe(403);
    expect(deleteResponse.body.success).toBe(false);

    const savedTask = await prisma.tasks.findUnique({
      where: { id: taskId },
    });

    expect(savedTask).not.toBeNull();
    expect(savedTask.title).toBe("Protected task");
  } finally {
    await prisma.users.deleteMany({
      where: { email: outsiderEmail },
    });
  }
});


test("DELETE returns 404 when the task does not exist", async () => {
  const response = await request(app)
    .delete(`/api/v1/projects/${projectId}/tasks/999999999`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(404);
  expect(response.body.success).toBe(false);
});


test("DELETE returns 400 when the task id is not a number", async () => {
  const beforeCount = await prisma.tasks.count({
    where: { project_id: projectId },
  });

  const response = await request(app)
    .delete(`/api/v1/projects/${projectId}/tasks/abc`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toBeUndefined();
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
  expect(response.body.error.message).toBe("Invalid project or task ID");
  expect(response.body.error.details).toEqual([]);

  const afterCount = await prisma.tasks.count({
    where: { project_id: projectId },
  });

  expect(afterCount).toBe(beforeCount);
});


test("GET lists the tasks of a project", async () => {
  const createResponse = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Task to list",
      description: "Created to test listing tasks",
      status: "Pending",
    });

  expect(createResponse.statusCode).toBe(201);

  const taskId = createResponse.body.data.id;

  const response = await request(app)
    .get(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(200);
  expect(response.body.success).toBe(true);
  expect(Array.isArray(response.body.data)).toBe(true);

  const listedTask = response.body.data.find((task) => task.id === taskId);

  expect(listedTask).toBeDefined();
  expect(listedTask.title).toBe("Task to list");
  expect(listedTask.project_id).toBe(projectId);
  expect(listedTask.created_by_email).toBe(email);
});


test("GET returns 400 when the project id is not a number", async () => {
  const response = await request(app)
    .get("/api/v1/projects/abc/tasks")
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toBeUndefined();
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
  expect(response.body.error.message).toBe("Invalid project ID");
  expect(response.body.error.details).toEqual([]);
});


test("GET returns a single task by id", async () => {
  const createResponse = await request(app)
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Task to fetch",
      description: "Created to test fetching a task by id",
      status: "Pending",
    });

  expect(createResponse.statusCode).toBe(201);

  const taskId = createResponse.body.data.id;

  const response = await request(app)
    .get(`/api/v1/projects/${projectId}/tasks/${taskId}`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.data.id).toBe(taskId);
  expect(response.body.data.title).toBe("Task to fetch");
  expect(response.body.data.project_id).toBe(projectId);
});


test("GET returns 404 when the task does not exist", async () => {
  const response = await request(app)
    .get(`/api/v1/projects/${projectId}/tasks/999999999`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(404);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toBeUndefined();
  expect(response.body.error.code).toBe("NOT_FOUND");
  expect(response.body.error.message).toBe("Task not found");
  expect(response.body.error.details).toEqual([
    {
      field: "taskId",
      message: "Task with the specified ID does not exist",
    },
  ]);
});


test("GET returns 400 when the task id is not a number", async () => {
  const response = await request(app)
    .get(`/api/v1/projects/${projectId}/tasks/abc`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.statusCode).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.data).toBeUndefined();
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
  expect(response.body.error.message).toBe("Invalid project or task ID");
  expect(response.body.error.details).toEqual([]);
});


test("GET rejects a non-member listing the project's tasks", async () => {
  const outsiderEmail = `outsider-${randomUUID()}@example.com`;

  try {
    const signupResponse = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Project Outsider",
        email: outsiderEmail,
        password: "TestPassword123!",
      });

    expect(signupResponse.statusCode).toBe(201);

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: outsiderEmail,
        password: "TestPassword123!",
      });

    expect(loginResponse.statusCode).toBe(200);

    const outsiderToken = loginResponse.body.data.token;

    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.statusCode).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toBeUndefined();
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(response.body.error.message).toBe(
      "You do not have access to this project",
    );
  } finally {
    await prisma.users.deleteMany({
      where: { email: outsiderEmail },
    });
  }
});


test("GET returns 404 when the task belongs to a different project", async () => {
  const secondProject = await prisma.projects.create({
    data: {
      title: "Second Integration Test Project",
      description: "Created to test project isolation",
      owner_id: userId,
    },
  });

  try {
    await prisma.project_members.create({
      data: {
        user_id: userId,
        project_id: secondProject.id,
        role: "Admin",
      },
    });

    const createResponse = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Task in original project",
        description: "Must not be visible through another project",
        status: "Pending",
      });

    expect(createResponse.statusCode).toBe(201);

    const taskId = createResponse.body.data.id;

    const response = await request(app)
      .get(`/api/v1/projects/${secondProject.id}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.statusCode).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toBeUndefined();
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.message).toBe("Task not found");
  } finally {
    await prisma.projects.deleteMany({
      where: { id: secondProject.id },
    });
  }
});

});
