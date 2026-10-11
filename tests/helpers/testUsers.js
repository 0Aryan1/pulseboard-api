import { randomUUID } from "node:crypto";

export const TEST_PASSWORD = "TestPassword123!";

// Signs up and logs in a fresh user through the real auth endpoints.
export async function createTestUser(api, name = "Test User") {
  const email = `test-${randomUUID()}@example.com`;

  const signupResponse = await api
    .post("/api/v1/auth/signup")
    .send({ name, email, password: TEST_PASSWORD });

  if (signupResponse.statusCode !== 201) {
    throw new Error(`Signup failed with status ${signupResponse.statusCode}`);
  }

  const loginResponse = await api
    .post("/api/v1/auth/login")
    .send({ email, password: TEST_PASSWORD });

  if (loginResponse.statusCode !== 200) {
    throw new Error(`Login failed with status ${loginResponse.statusCode}`);
  }

  return {
    id: signupResponse.body.data.id,
    email,
    token: loginResponse.body.data.token,
  };
}

// Projects must go first: projects.owner_id does not cascade when a user is
// deleted, and deleting a project cascades to its members, tasks and comments.
export async function deleteTestUsers(prisma, users) {
  const userIds = users.filter(Boolean).map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  await prisma.projects.deleteMany({
    where: { owner_id: { in: userIds } },
  });

  await prisma.users.deleteMany({
    where: { id: { in: userIds } },
  });
}
