
import { formatTask } from "../src/data/tasks.data.js";

describe("formatTask", () => {
  test("formats task data with creator details", () => {
    const task = {
      id: 1,
      title: "Learn unit testing",
      description: "Practice with Jest",
      status: "Pending",
      project_id: 10,
      created_at: new Date(),
      created_by: 7,
      users: {
        id: 7,
        name: "Aryan",
        email: "aryan@example.com",
      },
    };

    const result = formatTask(task);

    expect(result.created_by).toBe(7);
    expect(result.created_by_name).toBe("Aryan");
    expect(result.created_by_email).toBe("aryan@example.com");
  });


test("uses created_by when the users object is missing", () => {
  const task = {
    id: 2,
    title: "Fallback test",
    description: "Test missing user details",
    status: "Pending",
    project_id: 10,
    created_at: new Date(),
    created_by: 7,
    users: undefined,
  };

  const result = formatTask(task);

  expect(result.created_by).toBe(7);
  expect(result.created_by_name).toBeUndefined();
  expect(result.created_by_email).toBeUndefined();
});


test("formats a task when users property is absent", () => {
  const task = {
    id: 3,
    title: "Missing relation test",
    description: "No users property",
    status: "Pending",
    project_id: 10,
    created_at: new Date(),
    created_by: 9,
  };

  const result = formatTask(task);

  expect(result.id).toBe(3);
  expect(result.created_by).toBe(9);
  expect(result.created_by_name).toBeUndefined();
  expect(result.created_by_email).toBeUndefined();
});

});
