import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  status: z.enum(["Pending", "In Progress", "Completed"]),
});

// title is optional so a status change can send just the status, instead of
// resending a possibly stale title over a teammate's rename.
export const updateTaskSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["Pending", "In Progress", "Completed"]),
});
