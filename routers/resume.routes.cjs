const express = require("express");
const router = express.Router();
const resumeController = require("../controllers/resume.controller.cjs");
const authMiddleware = require("../middlewares/auth.middleware.cjs"); // التحقق من المصادقة
const uploadResume = require("../middlewares/upload.middleware.cjs"); // ملف إعدادات Cloudinary Multer
const {
  extractTextFromCloudinary,
} = require("../middlewares/extract.text.middleware.cjs");

const verifyToken = require("../middlewares/auth.middleware.cjs"); 

// Route to upload and analyze resume
router.post(
  "/upload",
  authMiddleware, // 1. التحقق من المصادقة
  // uploadCloudinary.single("resume")
  uploadResume, // 2. الرفع المباشر إلى Cloudinary وتوليد req.file.path
  extractTextFromCloudinary, // 3. جلب الملف من الرابط واستخراج النص
  resumeController.uploadAndAnalyzeResume, // 4. التحليل والحفظ في MySQL
);

// get All Resumes ForUser
router.get("/all", verifyToken, resumeController.getAllResumesForUser);

// get All Resumes
router.get("/", authMiddleware, resumeController.getAllResumes);

// update Resume By Id
router.put("/:id", authMiddleware, resumeController.updateResumeById);

// delete Resume By Id
router.delete("/:id", authMiddleware, resumeController.deleteResumeById);

module.exports = router;
    