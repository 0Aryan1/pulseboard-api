import express from "express";
import upload from "../middleware/upload.middleware.js";
import { createAttachmentController, getAttachmentsController, getAttachmentsByIdController, downloadAttachmentController, deleteAttachmentController} from "../controllers/attachments.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { taskAccessMiddleware } from "../middleware/taskAccess.middleware.js";

const router = express.Router({
    mergeParams: true
});

router.post("/", authMiddleware,taskAccessMiddleware(["Admin", "Member"]), upload.single("file"), createAttachmentController);
router.get("/", authMiddleware,taskAccessMiddleware(["Admin", "Member"]), getAttachmentsController);
router.get("/:attachmentId", authMiddleware,taskAccessMiddleware(["Admin", "Member"]), getAttachmentsByIdController);
router.get("/:attachmentId/download", authMiddleware,taskAccessMiddleware(["Admin", "Member"]), downloadAttachmentController);
router.delete("/:attachmentId", authMiddleware,taskAccessMiddleware(["Admin", "Member"]), deleteAttachmentController);

export default router;

