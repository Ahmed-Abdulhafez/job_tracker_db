
const db = require("../config/db");
const cloudinary = require("../config/cloudinary");
const { callGeminiAI } = require("../services/aiServiceGoogelAi.cjs");
const { isValidScore, isAuthenticated } = require("../utils/validators.cjs");
const {
  deleteCloudinaryFile,
  extractPublicId,
  normalizeResourceType,
} = require("../utils/cloudinaryHelper.cjs");

// ======================================================
// HELPER FUNCTIONS
// ======================================================



exports.uploadAndAnalyzeResume = async (req, res) => {
  const startTime = Date.now();

  // 1. التحقق من المصادقة
  if (!isAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  // 2. التحقق من وجود الملف المرفوع
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please upload a resume file.",
    });
  }

  const userId = req.user.id;
  const fileName =
    typeof req.file.originalname === "string" ? req.file.originalname.trim() : "";
  const fileUrl = req.fileUrl || req.file.path || req.file.secure_url || "";
  const cloudinaryPublicId = extractPublicId(req.file);
  const resourceType =
    normalizeResourceType(
      req.file?.resource_type || req.file?.cloudinary_resource_type
    ) || "raw";
  const rawText = typeof req.rawText === "string" ? req.rawText.trim() : "";

  // 3. التحقق من صحة بيانات الملف والنص المستخرج
  if (!fileName || !fileUrl || !rawText) {
    await deleteCloudinaryFile(cloudinaryPublicId, resourceType);
    return res.status(422).json({
      success: false,
      message: "Invalid resume file or unable to extract text content.",
    });
  }

  let stage = "AI_ANALYSIS";

  try {
    // 4. تحليل السيرة الذاتية عبر Gemini AI
    const aiStartTime = Date.now();
    const parsedData = await callGeminiAI("ANALYZE_RESUME", rawText);
    const aiDurationMs = Date.now() - aiStartTime;

    if (
      !parsedData ||
      typeof parsedData !== "object" ||
      Array.isArray(parsedData)
    ) {
      throw new Error("Invalid AI analysis response structure.");
    }

    const overallScore = Number(parsedData.overall_score);
    if (!isValidScore(overallScore)) {
      throw new Error("AI returned an invalid resume score.");
    }

    // 5. حفظ السيرة الذاتية ونتيجة التحليل في قاعدة البيانات
    stage = "DATABASE_INSERT";
    const [result] = await db.execute(
      `INSERT INTO resumes (
          user_id,
          file_name,
          file_url,
          cloudinary_public_id,
          cloudinary_resource_type,
          raw_text,
          parsed_data,
          overall_score
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        fileName,
        fileUrl,
        cloudinaryPublicId,
        resourceType,
        rawText,
        JSON.stringify(parsedData),
        overallScore,
      ]
    );

    const totalDurationMs = Date.now() - startTime;
    console.log(
      `Resume uploaded & analyzed | userId=${userId} | resumeId=${result.insertId} | aiMs=${aiDurationMs} | totalMs=${totalDurationMs}`
    );

    return res.status(201).json({
      success: true,
      message: "Resume analyzed successfully.",
      resume: {
        id: result.insertId,
        file_name: fileName,
        file_url: fileUrl,
        overall_score: overallScore,
        parsed_data: parsedData,
      },
    });
  } catch (error) {
    console.error(`Upload And Analyze Resume Error [stage=${stage}]:`, error);

    // 6. حذف الملف من Cloudinary عند فشل تحليل AI أو فشل الحفظ في قاعدة البيانات
    await deleteCloudinaryFile(cloudinaryPublicId, resourceType);

    if (stage === "AI_ANALYSIS") {
      return res.status(502).json({
        success: false,
        message: "Failed to analyze resume with AI service.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to upload and analyze resume.",
    });
  }
};


// ======================================================
// GET ALL RESUMES FOR AUTHENTICATED USER
// ======================================================

exports.getAllResumesForUser = async (req, res) => {
  try {
    // 1. Ensure that the user is authenticated.
    if (!isAuthenticated(req)) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Extract pagination parameters.
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(
        1,
        Number.parseInt(req.query.limit, 10) || 10
      )
    );

    // 3. Calculate the database offset.
    const offset = (page - 1) * limit;

    // 4. Retrieve the user's resumes using pagination.
    const [resumes] = await db.execute(
      `SELECT
        id,
        user_id,
        file_name,
        file_url,
        overall_score,
        parsed_data,
        created_at,
        updated_at
       FROM resumes
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    // 5. Count the total resumes belonging to the user.
    const [[countResult]] = await db.execute(
      "SELECT COUNT(*) AS total FROM resumes WHERE user_id = ?",
      [req.user.id]
    );

    // 6. Calculate the total number of pages.
    const total = Number(countResult.total);

    // 7. Return resumes and pagination metadata.
    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      resumes,
    });

  } catch (error) {
    // 8. Handle unexpected database errors.
    console.error("Get User Resumes Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve resumes.",
    });
  }
};


// ======================================================
// GET ALL RESUMES (ADMIN ONLY)
// ======================================================

exports.getAllResumes = async (req, res) => {
  try {
    // 1. Ensure that the authenticated user is an administrator.
    if (!isAuthenticated(req) || req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Administrator access required.",
      });
    }

    // 2. Retrieve resumes with their owners' basic information.
    const [resumes] = await db.execute(
      `SELECT
        r.id,
        r.user_id,
        r.file_name,
        r.file_url,
        r.overall_score,
        r.created_at,
        u.full_name,
        u.email
       FROM resumes r
       INNER JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC`
    );

    // 3. Return the retrieved resumes.
    return res.status(200).json({
      success: true,
      count: resumes.length,
      resumes,
    });

  } catch (error) {
    // 4. Handle unexpected database errors.
    console.error("Get All Resumes Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve resumes.",
    });
  }
};


// ======================================================
// UPDATE RESUME BY ID
// ======================================================

exports.updateResumeById = async (req, res) => {
  try {
    // 1. Ensure that the user is authenticated.
    if (!isAuthenticated(req)) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Extract the resume ID from route parameters.
    const { id: resumeId } = req.params;

    // 3. Validate the resume ID.
    if (!isValidId(resumeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resume ID.",
      });
    }

    // 4. Extract allowed update fields.
    const {
      file_name,
      parsed_data,
      overall_score,
    } = req.body;

    // 5. Ensure that at least one update field is provided.
    if (
      file_name === undefined &&
      parsed_data === undefined &&
      overall_score === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "No update data provided.",
      });
    }

    // 6. Prepare dynamic update fields.
    const updateFields = [];
    const values = [];

    // 7. Validate and add the file name if provided.
    if (file_name !== undefined) {
      if (
        typeof file_name !== "string" ||
        !file_name.trim() ||
        file_name.trim().length > 255
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid file name.",
        });
      }

      updateFields.push("file_name = ?");
      values.push(file_name.trim());
    }

    // 8. Validate and add parsed resume data if provided.
    if (parsed_data !== undefined) {
      if (
        !parsed_data ||
        typeof parsed_data !== "object" ||
        Array.isArray(parsed_data)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid parsed resume data.",
        });
      }

      updateFields.push("parsed_data = ?");
      values.push(JSON.stringify(parsed_data));
    }

    // 9. Validate and add the overall score if provided.
    if (overall_score !== undefined) {
      const score = Number(overall_score);

      if (!isValidScore(score)) {
        return res.status(400).json({
          success: false,
          message: "Score must be an integer between 0 and 100.",
        });
      }

      updateFields.push("overall_score = ?");
      values.push(score);
    }

    // 10. Add resume ID and owner ID to query parameters.
    values.push(resumeId, req.user.id);

    // 11. Update only the authenticated user's resume.
    const query = `
      UPDATE resumes
      SET ${updateFields.join(", ")}
      WHERE id = ? AND user_id = ?
    `;

    const [result] = await db.execute(query, values);

    // 12. Check whether the resume exists and belongs to the user.
    if (result.affectedRows === 0) {
      const [existingResume] = await db.execute(
        "SELECT id FROM resumes WHERE id = ? AND user_id = ?",
        [resumeId, req.user.id]
      );

      if (existingResume.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Resume not found.",
        });
      }
    }

    // 13. Return a successful update response.
    return res.status(200).json({
      success: true,
      message: "Resume updated successfully.",
    });

  } catch (error) {
    // 14. Handle unexpected update errors.
    console.error("Update Resume Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update resume.",
    });
  }
};


// ======================================================
// DELETE RESUME BY ID
// ======================================================

exports.deleteResumeById = async (req, res) => {
  try {
    // 1. Ensure that the user is authenticated.
    if (!isAuthenticated(req)) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Extract the resume ID from route parameters.
    const { id: resumeId } = req.params;

    // 3. Validate the resume ID.
    if (!isValidId(resumeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resume ID.",
      });
    }

    // 4. Retrieve the resume only if it belongs to the authenticated user.
    const [resumes] = await db.execute(
      `SELECT
        id,
        cloudinary_public_id,
        cloudinary_resource_type
       FROM resumes
       WHERE id = ? AND user_id = ?`,
      [resumeId, req.user.id]
    );

    // 5. Check whether the resume exists.
    if (resumes.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Resume not found.",
      });
    }

    const resume = resumes[0];

    // 6. Delete the file from Cloudinary if a public ID exists.
    if (resume.cloudinary_public_id) {
      const cloudinaryResult = await cloudinary.uploader.destroy(
        resume.cloudinary_public_id,
        {
          resource_type:
            resume.cloudinary_resource_type || "raw",
        }
      );

      // 7. Verify the Cloudinary deletion result.
      if (
        cloudinaryResult.result !== "ok" &&
        cloudinaryResult.result !== "not found"
      ) {
        throw new Error("Cloudinary file deletion failed.");
      }
    }

    // 8. Delete the database record after Cloudinary cleanup.
    const [deleteResult] = await db.execute(
      `DELETE FROM resumes
       WHERE id = ? AND user_id = ?`,
      [resumeId, req.user.id]
    );

    // 9. Check whether the database record was deleted.
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Resume not found.",
      });
    }

    // 10. Return a successful deletion response.
    return res.status(200).json({
      success: true,
      message: "Resume deleted successfully.",
    });

  } catch (error) {
    // 11. Handle unexpected deletion errors.
    console.error("Delete Resume Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete resume.",
    });
  }
};
