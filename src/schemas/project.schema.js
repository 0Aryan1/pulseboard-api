import { z } from "zod";

export const createProjectSchema = z.object({
    title : z.string().min(1, "Title is required").max(100),
    description : z.string().min(1, "Description is required").max(500),
})

export const updateProjectSchema = z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional()
});

export const transferOwnershipSchema = z.object({
    userId: z.number().int().positive()
});