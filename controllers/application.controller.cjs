const crypto = require("crypto");
const db = require("../config/db");
const { callGeminiAI } = require("../services/aiServiceGoogelAi.cjs");

const ALLOWED_STATUSES = [
  "SAVED",
  "APPLIED",
  "INTERVIEWING",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
];

function buildRequestHash({ userId, resumeId, jobId, resumeSnapshot, jobDescriptionSnapshot }) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        userId: Number(userId),
        resumeId: Number(resumeId),
        jobId: Number(jobId),
        resumeSnapshot,
        jobDescriptionSnapshot,
      })
    )
    .digest("hex");
}

function parseResumeData(parsedData) {
  if (!parsedData) return null;
  if (typeof parsedData === "string") {
    try {
      return JSON.parse(parsedData);
    } catch {
      return null;
    }
  }
  return typeof parsedData === "object" ? parsedData : null;
}

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * POST /api/applications/evaluate
 * تقييم توافق السيرة الذاتية مع الوظيفة وتوليد خطاب التغطية مع دعم Idempotency
 */
exports.evaluateJobApplication = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: User not authenticated",
    });
  }

  const resumeId = Number(req.body?.resume_id);
  const jobId = Number(req.body?.job_id);

  if (!Number.isInteger(resumeId) || resumeId <= 0 || !Number.isInteger(jobId) || jobId <= 0) {
    return res.status(400).json({
      success: false,
      error: "Valid positive integer resume_id and job_id are required",
    });
  }

  const headerKey = req.get("Idempotency-Key")?.trim();
  const idempotencyKey = headerKey && headerKey.length <= 100 ? headerKey : crypto.randomUUID();

  let requestId = null;
  let applicationId = null;
  let resumeSnapshot = null;
  let jobDescriptionSnapshot = null;
  let resumeData = null;

  // 1. جلب بيانات السيرة والوظيفة + التحقق من Idempotency قبل استدعاء AI
  let conn = await db.getConnection();
  try {
    const [resumeRows] = await conn.execute(
      `SELECT id, user_id, parsed_data
       FROM resumes
       WHERE id = ? AND user_id = ?`,
      [resumeId, userId]
    );

    if (resumeRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Resume not found",
      });
    }

    resumeData = parseResumeData(resumeRows[0].parsed_data);
    if (!resumeData || typeof resumeData !== "object") {
      return res.status(422).json({
        success: false,
        error: "Invalid resume parsed data",
      });
    }

    const [jobRows] = await conn.execute(
      `SELECT id, user_id, description
       FROM jobs
       WHERE id = ? AND user_id = ?`,
      [jobId, userId]
    );

    if (jobRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    resumeSnapshot = JSON.stringify(resumeData);
    jobDescriptionSnapshot = String(jobRows[0].description || "");

    if (!jobDescriptionSnapshot.trim()) {
      return res.status(422).json({
        success: false,
        error: "Job description is empty",
      });
    }

    const requestHash = buildRequestHash({
      userId,
      resumeId,
      jobId,
      resumeSnapshot,
      jobDescriptionSnapshot,
    });

    // التحقق مما إذا كان الطلب مكرراً بنفس Idempotency-Key
    const [existingRequests] = await conn.execute(
      `SELECT id, application_id, request_hash, status, evaluation_id, response_data
       FROM evaluation_requests
       WHERE user_id = ? AND idempotency_key = ?`,
      [userId, idempotencyKey]
    );

    if (existingRequests.length > 0) {
      const existing = existingRequests[0];

      if (existing.request_hash !== requestHash) {
        return res.status(409).json({
          success: false,
          error: "Idempotency-Key reused with different request payload",
        });
      }

      if (existing.status === "COMPLETED" && existing.response_data) {
        const cachedResult = safeJsonParse(existing.response_data, {});
        return res.status(200).json({
          success: true,
          message: "Idempotent replay: Evaluation already completed",
          idempotent_replay: true,
          application_id: existing.application_id,
          evaluation_id: existing.evaluation_id,
          request_id: existing.id,
          match_score: cachedResult.match_score,
          missing_skills: cachedResult.missing_skills || [],
          ai_suggestions: cachedResult.ai_suggestions || [],
          cover_letter: cachedResult.cover_letter || "",
        });
      }

      if (existing.status === "PROCESSING" || existing.status === "PENDING") {
        return res.status(202).json({
          success: true,
          message: "Evaluation request is already in progress",
          application_id: existing.application_id,
          request_id: existing.id,
          status: existing.status,
        });
      }
    }

    // إنشاء Application (إن لم يكن موجوداً) وتسجيل Evaluation Request داخل Transaction
    await conn.beginTransaction();

    const [appResult] = await conn.execute(
      `INSERT INTO applications (user_id, job_id, status)
       VALUES (?, ?, 'SAVED')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [userId, jobId]
    );
    applicationId = appResult.insertId;

    const [reqResult] = await conn.execute(
      `INSERT INTO evaluation_requests (
          user_id,
          application_id,
          resume_id,
          job_id,
          idempotency_key,
          request_hash,
          status,
          attempts,
          resume_snapshot,
          job_description_snapshot
       )
       VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', 1, ?, ?)`,
      [
        userId,
        applicationId,
        resumeId,
        jobId,
        idempotencyKey,
        requestHash,
        resumeSnapshot,
        jobDescriptionSnapshot,
      ]
    );
    requestId = reqResult.insertId;

    await conn.commit();
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
    }
    console.error("Error preparing evaluation request:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to initialize job evaluation request",
    });
  } finally {
    if (conn) conn.release();
  }

  // 2. استدعاء Gemini AI خارج Transaction وخارج حجز Connection
  let aiResult;
  try {
    aiResult = await callGeminiAI("MATCH_JOB", {
      resumeData,
      jobDescription: jobDescriptionSnapshot,
    });

    if (!aiResult || typeof aiResult !== "object") {
      throw new Error("Invalid AI response structure");
    }

    const matchScore = Number(aiResult.match_score);
    if (!Number.isInteger(matchScore) || matchScore < 0 || matchScore > 100) {
      throw new Error("Invalid match_score returned by AI");
    }

    const missingSkills = Array.isArray(aiResult.missing_skills) ? aiResult.missing_skills : [];
    const aiSuggestions = Array.isArray(aiResult.ai_suggestions) ? aiResult.ai_suggestions : [];
    const coverLetter = typeof aiResult.cover_letter === "string" ? aiResult.cover_letter : "";

    const normalizedPayload = {
      match_score: matchScore,
      missing_skills: missingSkills,
      ai_suggestions: aiSuggestions,
      cover_letter: coverLetter,
    };

    // 3. حفظ التقييم وتحديث Application و Evaluation Request داخل Transaction ذرية
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [evalResult] = await conn.execute(
      `INSERT INTO application_evaluations (
          application_id,
          resume_id,
          request_id,
          match_score,
          missing_skills,
          ai_suggestions,
          cover_letter,
          resume_snapshot,
          job_description_snapshot
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        resumeId,
        requestId,
        matchScore,
        JSON.stringify(missingSkills),
        JSON.stringify(aiSuggestions),
        coverLetter,
        resumeSnapshot,
        jobDescriptionSnapshot,
      ]
    );

    const evaluationId = evalResult.insertId;

    await conn.execute(
      `UPDATE applications
       SET latest_evaluation_id = ?
       WHERE id = ? AND user_id = ?`,
      [evaluationId, applicationId, userId]
    );

    await conn.execute(
      `UPDATE evaluation_requests
       SET status = 'COMPLETED',
           evaluation_id = ?,
           response_data = ?,
           last_error = NULL
       WHERE id = ? AND user_id = ?`,
      [evaluationId, JSON.stringify(normalizedPayload), requestId, userId]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Job matching and cover letter generated successfully",
      application_id: applicationId,
      evaluation_id: evaluationId,
      request_id: requestId,
      ...normalizedPayload,
    });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
    }

    console.error("Error matching resume with job:", error);

    if (requestId) {
      let errConn;
      try {
        errConn = await db.getConnection();
        await errConn.execute(
          `UPDATE evaluation_requests
           SET status = 'FAILED',
               last_error = ?
           WHERE id = ? AND user_id = ?`,
          [String(error.message || "Unknown error").slice(0, 2000), requestId, userId]
        );
      } catch (updateErr) {
        console.error("Failed to mark evaluation_request as FAILED:", updateErr);
      } finally {
        if (errConn) errConn.release();
      }
    }

    return res.status(502).json({
      success: false,
      error: "Failed to evaluate resume with job",
      request_id: requestId,
    });
  } finally {
    if (conn) conn.release();
  }
};

/**
 * GET /api/applications
 * جلب جميع طلبات التقديم للمستخدم مع Pagination وفلترة حسب الحالة
 */
exports.getAllApplication = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated",
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid application status",
      });
    }

    let whereClause = "WHERE a.user_id = ?";
    const queryParams = [userId];

    if (status) {
      whereClause += " AND a.status = ?";
      queryParams.push(status);
    }

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total
       FROM applications a
       ${whereClause}`,
      queryParams
    );

    const total = Number(countResult[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    const [rows] = await db.query(
      `SELECT
          a.id AS application_id,
          a.status,
          a.applied_at,
          a.created_at AS application_created_at,
          a.updated_at AS application_updated_at,

          j.id AS job_id,
          j.title AS job_title,
          j.company_name,
          j.location,
          j.source_url,
          j.extracted_skills,

          e.id AS evaluation_id,
          e.match_score,
          e.missing_skills,
          e.ai_suggestions,
          e.cover_letter,
          e.created_at AS evaluation_created_at

       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id AND j.user_id = a.user_id
       LEFT JOIN application_evaluations e ON e.id = a.latest_evaluation_id
       ${whereClause}
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    const formattedData = rows.map((row) => ({
      ...row,
      extracted_skills: safeJsonParse(row.extracted_skills, []),
      missing_skills: safeJsonParse(row.missing_skills, []),
      ai_suggestions: safeJsonParse(row.ai_suggestions, []),
    }));

    return res.status(200).json({
      success: true,
      message: "Applications retrieved successfully",
      data: formattedData,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get All Applications Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve applications",
    });
  }
};

/**
 * GET /api/applications/:id
 * جلب تفاصيل طلب تقديم واحد مع سجل التقييمات المرتبطة به
 */
exports.getApplicationById = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated",
      });
    }

    const applicationId = Number(req.params.id);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid application id",
      });
    }

    const [appRows] = await db.query(
      `SELECT
          a.id AS application_id,
          a.status,
          a.applied_at,
          a.latest_evaluation_id,
          a.created_at,
          a.updated_at,

          j.id AS job_id,
          j.title AS job_title,
          j.company_name,
          j.location,
          j.source_url,
          j.description AS job_description,
          j.extracted_skills

       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id AND j.user_id = a.user_id
       WHERE a.id = ? AND a.user_id = ?`,
      [applicationId, userId]
    );

    if (appRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const [evaluations] = await db.query(
      `SELECT
          id AS evaluation_id,
          resume_id,
          request_id,
          match_score,
          missing_skills,
          ai_suggestions,
          cover_letter,
          created_at
       FROM application_evaluations
       WHERE application_id = ?
       ORDER BY created_at DESC, id DESC`,
      [applicationId]
    );

    const app = appRows[0];

    return res.status(200).json({
      success: true,
      data: {
        ...app,
        extracted_skills: safeJsonParse(app.extracted_skills, []),
        evaluations: evaluations.map((ev) => ({
          ...ev,
          missing_skills: safeJsonParse(ev.missing_skills, []),
          ai_suggestions: safeJsonParse(ev.ai_suggestions, []),
        })),
      },
    });
  } catch (error) {
    console.error("Get Application By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve application details",
    });
  }
};

/**
 * PATCH /api/applications/:id/status
 * تحديث حالة طلب التقديم وضبط applied_at عند الانتقال إلى APPLIED
 */
exports.updateApplicationStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated",
      });
    }

    const applicationId = Number(req.params.id);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid application id",
      });
    }

    const nextStatus = req.body?.status ? String(req.body.status).trim().toUpperCase() : "";
    if (!ALLOWED_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const [existingRows] = await db.query(
      `SELECT id, status, applied_at
       FROM applications
       WHERE id = ? AND user_id = ?`,
      [applicationId, userId]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const current = existingRows[0];
    const shouldSetAppliedAt = nextStatus === "APPLIED" && !current.applied_at;

    await db.query(
      `UPDATE applications
       SET status = ?,
           applied_at = CASE WHEN ? THEN NOW() ELSE applied_at END
       WHERE id = ? AND user_id = ?`,
      [nextStatus, shouldSetAppliedAt ? 1 : 0, applicationId, userId]
    );

    const [updatedRows] = await db.query(
      `SELECT id AS application_id, status, applied_at, updated_at
       FROM applications
       WHERE id = ? AND user_id = ?`,
      [applicationId, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Application status updated successfully",
      data: updatedRows[0],
    });
  } catch (error) {
    console.error("Update Application Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update application status",
    });
  }
};

/**
 * DELETE /api/applications/:id
 * حذف طلب التقديم مع ضمان ملكية المستخدم
 */
exports.deleteApplication = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated",
      });
    }

    const applicationId = Number(req.params.id);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid application id",
      });
    }

    const [result] = await db.query(
      `DELETE FROM applications
       WHERE id = ? AND user_id = ?`,
      [applicationId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Application deleted successfully",
    });
  } catch (error) {
    console.error("Delete Application Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete application",
    });
  }
};