import { z } from "zod";

const projectMemberRole = z.enum(["Admin", "Member"]);

export const createProjectMemberSchema = z.object({
    userId: z.number().int().positive(),
    role: projectMemberRole
});

export const updateProjectMemberSchema = z.object({
    role: projectMemberRole
});
