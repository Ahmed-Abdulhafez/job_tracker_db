const express = require("express");
const router = express.Router();

const jobController = require("../controllers/job.controller.cjs");
const verifyToken = require("../middlewares/auth.middleware.cjs");
const { isAdmin } = require("../middlewares/isAdmin.middleware.cjs");

// Admin routes - إدارة الوظائف (إنشاء، تعديل، حذف)
router.post("/", verifyToken, isAdmin, jobController.createJob);
router.put("/:id", verifyToken, isAdmin, jobController.updateJob);
router.delete("/:id", verifyToken, isAdmin, jobController.deleteJob);

// Authenticated user routes - عرض الوظائف
router.get("/", verifyToken, jobController.getUserJobs);
router.get("/:id", verifyToken, jobController.getJobById);

module.exports = router;