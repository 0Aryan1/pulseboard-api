import {
  createProjectMemberSchema,
  updateProjectMemberSchema,
} from "../src/schemas/projectMember.schema.js";

describe("createProjectMemberSchema", () => {
  test("accepts the Admin role", () => {
    const result = createProjectMemberSchema.safeParse({
      userId: 1,
      role: "Admin",
    });

    expect(result.success).toBe(true);
  });

  test("accepts the Member role", () => {
    const result = createProjectMemberSchema.safeParse({
      userId: 1,
      role: "Member",
    });

    expect(result.success).toBe(true);
  });

  test("rejects a role that is only part of an allowed role", () => {
    const result = createProjectMemberSchema.safeParse({
      userId: 1,
      role: "min",
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(["role"]);
  });
});

describe("updateProjectMemberSchema", () => {
  test("rejects a role that is only part of an allowed role", () => {
    const result = updateProjectMemberSchema.safeParse({ role: "min" });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(["role"]);
  });
});
