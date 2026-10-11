import express from "express";
import {getAllProjectsController,getProjectByIdController, createProjectController, updateProjectController, deleteProjectController, transferProjectOwnershipController} from "../controllers/projects.controller.js";
import { authMiddleware} from "../middleware/auth.middleware.js";
import {projectRoleMiddleware} from "../middleware/projectRole.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getAllProjectsController);
router.get("/:projectId", authMiddleware,  projectRoleMiddleware(["Admin", "Member"]), getProjectByIdController);
router.post("/", authMiddleware, createProjectController);
router.put("/:projectId", authMiddleware,  projectRoleMiddleware(["Admin"]),updateProjectController);
router.put("/:projectId/owner", authMiddleware, projectRoleMiddleware(["Admin"]), transferProjectOwnershipController);
router.delete("/:projectId", authMiddleware, projectRoleMiddleware(["Admin"]), deleteProjectController);

export default router;