const cloudinary = require("../config/cloudinary");

const ALLOWED_RESOURCE_TYPES = ["image", "raw", "video"];

function normalizeResourceType(resourceType) {
  return ALLOWED_RESOURCE_TYPES.includes(resourceType) ? resourceType : null;
}

/**
 * استخراج الـ public_id بدقة من كائن req.file
 */
function extractPublicId(file) {
  if (!file || typeof file !== "object") return null;
  const candidate = file.filename || file.public_id || null;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

/**
 * حذف ملف من Cloudinary مع تجربة الأنواع المحتملة عند استخدام resource_type: "auto"
 */
async function deleteCloudinaryFile(publicId, preferredResourceType = null) {
  if (!publicId || typeof publicId !== "string") {
    return { deleted: false, reason: "MISSING_PUBLIC_ID" };
  }

  const cleanId = publicId.trim();
  const normalizedPreferred = normalizeResourceType(preferredResourceType);

  const candidates = Array.from(
    new Set([
      ...(normalizedPreferred ? [normalizedPreferred] : []),
      "raw",
      "image",
    ]),
  );

  for (const resourceType of candidates) {
    try {
      const response = await cloudinary.uploader.destroy(cleanId, {
        resource_type: resourceType,
        invalidate: true,
      });

      console.log(
        `[Cloudinary Delete] public_id=${cleanId} | resource_type=${resourceType} | result=${response?.result}`,
      );

      if (response?.result === "ok") {
        return { deleted: true, resource_type: resourceType, result: "ok" };
      }
    } catch (error) {
      console.error(
        `[Cloudinary Delete Error] public_id=${cleanId} | resource_type=${resourceType}:`,
        error.message,
      );
    }
  }

  return { deleted: false, reason: "NOT_FOUND_OR_FAILED" };
}

module.exports = {
  deleteCloudinaryFile,
  extractPublicId,
  normalizeResourceType,
};
