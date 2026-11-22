const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const {
  deleteCloudinaryFile,
  extractPublicId,
  normalizeResourceType,
} = require("../utils/cloudinaryHelper.cjs");

async function fetchFileBufferWithRetry(
  url,
  { timeoutMs = 20000, retries = 2 } = {}
) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const cloudinaryError = response.headers.get("x-cld-error");

        console.error("Cloudinary Fetch Error:", {
          status: response.status,
          statusText: response.statusText,
          cloudinaryError,
        });

        throw new Error(
          `Cloudinary returned ${response.status}: ${
            cloudinaryError || response.statusText
          }`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1))
        );
      }
    }
  }

  throw lastError;
}

exports.extractTextFromCloudinary = async (req, res, next) => {
  let parser;
  const publicId = extractPublicId(req.file);
  const resourceType =
    normalizeResourceType(
      req.file?.resource_type || req.file?.cloudinary_resource_type
    ) || "raw";

  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded or file path missing from Cloudinary",
      });
    }

    const fileUrl = req.file.path;
    const mimetype = req.file.mimetype;

    // 1. Download file from Cloudinary with timeout & retry
    const fileBuffer = await fetchFileBufferWithRetry(fileUrl, {
      timeoutMs: 20000,
      retries: 2,
    });

    let rawText = "";

    // 2. Extract text based on file type
    if (mimetype === "application/pdf") {
      parser = new PDFParse({
        data: fileBuffer,
      });

      const data = await parser.getText();
      rawText = data?.text || "";
    } else if (
      mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimetype === "application/msword"
    ) {
      const result = await mammoth.extractRawText({
        buffer: fileBuffer,
      });

      rawText = result?.value || "";
    } else {
      await deleteCloudinaryFile(publicId, resourceType);
      return res.status(400).json({
        success: false,
        error: "Unsupported file format for text extraction",
      });
    }

    // 3. Validate extracted text
    if (!rawText || !rawText.trim()) {
      await deleteCloudinaryFile(publicId, resourceType);
      return res.status(422).json({
        success: false,
        error: "Could not extract text from the file or file is empty",
      });
    }

    // 4. Attach data to request
    req.rawText = rawText.trim();
    req.fileUrl = fileUrl;

    return next();
  } catch (error) {
    console.error("Error extracting text from Cloudinary file:", error);

    // حذف الملف من Cloudinary لأن تحميله أو استخراج النص منه فشل بعد الرفع
    await deleteCloudinaryFile(publicId, resourceType);

    const isTimeout =
      error?.name === "TimeoutError" ||
      error?.code === "ETIMEDOUT" ||
      error?.cause?.code === "ETIMEDOUT";

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? "Timed out while downloading file from Cloudinary"
        : "Failed to process file text",
      details: error.message,
    });
  } finally {
    if (parser) {
      await parser.destroy().catch((destroyError) => {
        console.error("PDF Parser Cleanup Error:", destroyError);
      });
    }
  }
};