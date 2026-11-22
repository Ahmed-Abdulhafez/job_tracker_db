const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const {
  deleteCloudinaryFile,
  extractPublicId,
  normalizeResourceType,
} = require("../utils/cloudinaryHelper.cjs");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "ats_resumes",
    allowed_formats: ["pdf", "docx", "doc"],
    resource_type: "auto",
    public_id: (req, file) => {
      const uniqueSuffix =
        Date.now() + "-" + Math.round(Math.random() * 1e9);
      return `resume-${uniqueSuffix}`;
    },
  },
});

const rawUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
});

/**
 * Wrapper حول multer لالتقاط أخطاء الرفع والاتصال بـ Cloudinary وتنظيف أي ملف نتج قبل الفشل
 */
const uploadResume = (req, res, next) => {
  rawUpload.single("resume")(req, res, async (err) => {
    if (!err) {
      return next();
    }

    console.error("Cloudinary / Multer Upload Error:", err);

    // محاولة تنظيف أي ملف وُجد في req.file أو داخل كائن الخطأ في حال رُفع قبل الفشل
    const publicId =
      extractPublicId(req.file) ||
      err?.public_id ||
      err?.filename ||
      null;

    const resourceType =
      normalizeResourceType(
        req.file?.resource_type ||
          req.file?.cloudinary_resource_type ||
          err?.resource_type
      ) || "raw";

    if (publicId) {
      await deleteCloudinaryFile(publicId, resourceType);
    }

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "File size exceeds the 5 MB limit.",
      });
    }

    return res.status(502).json({
      success: false,
      message: "Failed to upload resume to cloud storage.",
    });
  });
};

module.exports = uploadResume;