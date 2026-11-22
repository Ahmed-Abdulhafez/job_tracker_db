
const db = require("../config/db");
const { GoogleGenAI } = require("@google/genai");

// Initialize the Google Gemini AI client.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Define the available AI models in fallback order.
const MODELS_TO_TRY = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];

// Set the maximum execution time for each AI model.
const AI_TIMEOUT = 18000;

// Validate that a route ID is a positive integer string.
// Keeping IDs as strings avoids BIGINT precision issues.
const isValidId = (id) => {
  return typeof id === "string" && /^[1-9]\d*$/.test(id);
};

// Parse a positive integer and enforce a maximum value.
const parsePositiveInt = (value, defaultValue, maxValue) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    return defaultValue;
  }

  return Math.min(parsedValue, maxValue);
};

// Normalize skills returned from MySQL JSON columns.
const normalizeSkills = (skills) => {
  if (Array.isArray(skills)) {
    return skills.filter(
      (skill) => typeof skill === "string" && skill.trim()
    );
  }

  if (typeof skills === "string") {
    try {
      const parsedSkills = JSON.parse(skills);

      if (Array.isArray(parsedSkills)) {
        return parsedSkills.filter(
          (skill) => typeof skill === "string" && skill.trim()
        );
      }
    } catch (error) {
      console.warn("Failed to parse stored skills:", error.message);
    }
  }

  return [];
};

// Extract technical and soft skills from a job description using Gemini AI.
const extractJobSkills = async (description) => {
  // Return an empty array if the API key is not configured.
  if (!process.env.GEMINI_API_KEY) {
    console.warn("Gemini API key is missing.");
    return [];
  }

  // Prepare the prompt with strict JSON output requirements.
  const aiPrompt = `
    Analyze the following job description and extract all required
    technical and soft skills.

    Return ONLY a valid JSON array of strings.
    Do not include explanations, markdown, or additional text.

    Example:
    ["Node.js", "Express.js", "MySQL", "Communication"]

    Job Description:
    ${description}
  `;

  // Try each configured model until one successfully returns valid data.
  for (const modelName of MODELS_TO_TRY) {
    let timeoutId;

    try {
      console.log(`Trying Gemini model: ${modelName}`);

      // Start the AI generation request.
      const aiPromise = ai.models.generateContent({
        model: modelName,
        contents: aiPrompt,
      });

      // Create a timeout to prevent waiting indefinitely.
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`AI request timed out: ${modelName}`));
        }, AI_TIMEOUT);
      });

      // Wait for either the AI response or the timeout.
      const response = await Promise.race([
        aiPromise,
        timeoutPromise,
      ]);

      // Clear the timeout after receiving a response.
      clearTimeout(timeoutId);

      // Read and clean the generated response.
      const rawContent = response.text;

      if (typeof rawContent !== "string" || !rawContent.trim()) {
        throw new Error("Gemini returned an empty response.");
      }

      // Remove markdown code fences if the model includes them.
      const cleanedContent = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      // Parse the response and verify its structure.
      const parsedSkills = JSON.parse(cleanedContent);

      if (!Array.isArray(parsedSkills)) {
        throw new Error("AI response must be a JSON array.");
      }

      // Keep only non-empty string values and remove duplicates.
      const validSkills = [
        ...new Set(
          parsedSkills
            .filter(
              (skill) =>
                typeof skill === "string" && skill.trim().length > 0
            )
            .map((skill) => skill.trim())
        ),
      ];

      console.log(`Skills extracted successfully using ${modelName}`);

      return validSkills;
    } catch (error) {
      // Clear any pending timeout before trying another model.
      clearTimeout(timeoutId);

      console.warn(
        `Gemini model ${modelName} failed:`,
        error.message
      );
    }
  }

  // Return an empty array if all AI models fail.
  console.warn("All Gemini models failed. Returning empty skills.");

  return [];
};

// Create a new job for the authenticated user.
exports.createJob = async (req, res) => {
  try {
    // Extract job information from the request body.
    const {
      title,
      company_name,
      location,
      source_url,
      description,
    } = req.body;

    // Get the authenticated user's ID from the authentication middleware.
    const userId = req.user.id;

    // Validate the required job fields.
    if (
      typeof title !== "string" ||
      !title.trim() ||
      typeof description !== "string" ||
      !description.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Job title and description are required.",
      });
    }

    // Validate optional text fields.
    if (
      company_name !== undefined &&
      company_name !== null &&
      typeof company_name !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Company name must be a string.",
      });
    }

    if (
      location !== undefined &&
      location !== null &&
      typeof location !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Location must be a string.",
      });
    }

    if (
      source_url !== undefined &&
      source_url !== null &&
      typeof source_url !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Source URL must be a string.",
      });
    }

    // Extract job skills using AI.
    // Job creation will continue even if AI extraction fails.
    const extractedSkills = await extractJobSkills(description.trim());

    // Prepare the SQL query to insert the new job.
    const query = `
      INSERT INTO jobs (
        user_id,
        title,
        company_name,
        location,
        source_url,
        description,
        extracted_skills
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    // Execute the parameterized query to prevent SQL injection.
    const [result] = await db.execute(query, [
      userId,
      title.trim(),
      company_name?.trim() || null,
      location?.trim() || null,
      source_url?.trim() || null,
      description.trim(),
      JSON.stringify(extractedSkills),
    ]);

    // Return the newly created job information.
    return res.status(201).json({
      success: true,
      message: "Job created successfully.",
      data: {
        id: result.insertId,
        user_id: userId,
        title: title.trim(),
        company_name: company_name?.trim() || null,
        location: location?.trim() || null,
        source_url: source_url?.trim() || null,
        description: description.trim(),
        extracted_skills: extractedSkills,
      },
    });
  } catch (error) {
    // Log the error for server-side debugging.
    console.error("Error in createJob:", error);

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while creating the job.",
    });
  }
};

// Retrieve all jobs belonging to the authenticated user.
exports.getUserJobs = async (req, res) => {
  try {
    // Get the authenticated user's ID.
    const userId = req.user.id;

    // Extract and validate pagination parameters.
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const limit = parsePositiveInt(req.query.limit, 10, 100);

    // Calculate the number of records to skip.
    const offset = (page - 1) * limit;

    // Extract the optional search keyword.
    const searchKeyword =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    // Build the search pattern for title and company name.
    const searchPattern = `%${searchKeyword}%`;

    // Retrieve the user's jobs with pagination and search.
    const query = `
      SELECT
        id,
        title,
        company_name,
        location,
        source_url,
        description,
        extracted_skills,
        created_at,
        updated_at
      FROM jobs
      WHERE user_id = ?
        AND (
          ? = ''
          OR title LIKE ?
          OR company_name LIKE ?
        )
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;

    // Execute the main query using parameterized values.
    const [jobs] = await db.execute(query, [
      userId,
      searchKeyword,
      searchPattern,
      searchPattern,
      limit,
      offset,
    ]);

    // Count all matching records to calculate pagination metadata.
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM jobs
      WHERE user_id = ?
        AND (
          ? = ''
          OR title LIKE ?
          OR company_name LIKE ?
        )
    `;

    // Execute the count query using the same search conditions.
    const [countResult] = await db.execute(countQuery, [
      userId,
      searchKeyword,
      searchPattern,
      searchPattern,
    ]);

    // Convert the database count into a JavaScript number.
    const totalJobs = Number(countResult[0].total);

    // Calculate the total number of available pages.
    const totalPages = Math.ceil(totalJobs / limit);

    // Normalize JSON skills before returning the records.
    const formattedJobs = jobs.map((job) => ({
      ...job,
      extracted_skills: normalizeSkills(job.extracted_skills),
    }));

    // Return the jobs and pagination information.
    return res.status(200).json({
      success: true,
      message: "Jobs retrieved successfully.",
      pagination: {
        total_jobs: totalJobs,
        current_page: page,
        total_pages: totalPages,
        per_page: limit,
      },
      data: formattedJobs,
    });
  } catch (error) {
    // Log the error for server-side debugging.
    console.error("Error in getUserJobs:", error);

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while retrieving jobs.",
    });
  }
};

// Retrieve a specific job by its ID.
exports.getJobById = async (req, res) => {
  try {
    // Extract the job ID from the route parameters.
    const jobId = req.params.id;

    // Get the authenticated user's ID.
    const userId = req.user.id;

    // Validate the provided job ID.
    if (!isValidId(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID.",
      });
    }

    // Retrieve the job only if it belongs to the authenticated user.
    const query = `
      SELECT
        id,
        user_id,
        title,
        company_name,
        location,
        source_url,
        description,
        extracted_skills,
        created_at,
        updated_at
      FROM jobs
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `;

    // Execute the ownership-aware query.
    const [jobs] = await db.execute(query, [jobId, userId]);

    // Return 404 if the job does not exist or belongs to another user.
    if (jobs.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Job not found.",
      });
    }

    // Extract the matching job record.
    const job = jobs[0];

    // Normalize the JSON skills field.
    job.extracted_skills = normalizeSkills(job.extracted_skills);

    // Return the requested job details.
    return res.status(200).json({
      success: true,
      message: "Job retrieved successfully.",
      data: job,
    });
  } catch (error) {
    // Log the error for server-side debugging.
    console.error("Error in getJobById:", error);

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while retrieving the job.",
    });
  }
};

// Update an existing job owned by the authenticated user.
exports.updateJob = async (req, res) => {
  try {
    // Extract the job ID and authenticated user ID.
    const jobId = req.params.id;
    const userId = req.user.id;

    // Validate the provided job ID.
    if (!isValidId(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID.",
      });
    }

    // Extract the submitted update fields.
    const {
      title,
      company_name,
      location,
      source_url,
      description,
    } = req.body;

    // Check whether at least one supported field was provided.
    const allowedFields = [
      "title",
      "company_name",
      "location",
      "source_url",
      "description",
    ];

    const hasUpdates = allowedFields.some((field) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
    );

    // Reject empty update requests.
    if (!hasUpdates) {
      return res.status(400).json({
        success: false,
        message: "At least one field must be provided for updating.",
      });
    }

    // Validate fields that must contain non-empty strings.
    if (
      title !== undefined &&
      (typeof title !== "string" || !title.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Job title must be a non-empty string.",
      });
    }

    if (
      description !== undefined &&
      (typeof description !== "string" || !description.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Job description must be a non-empty string.",
      });
    }

    // Validate optional fields.
    const optionalFields = [
      { name: "company_name", value: company_name },
      { name: "location", value: location },
      { name: "source_url", value: source_url },
    ];

    for (const field of optionalFields) {
      if (
        field.value !== undefined &&
        field.value !== null &&
        typeof field.value !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: `${field.name} must be a string or null.`,
        });
      }
    }

    // Retrieve the existing job while verifying its ownership.
    const [jobs] = await db.execute(
      "SELECT * FROM jobs WHERE id = ? AND user_id = ? LIMIT 1",
      [jobId, userId]
    );

    // Return 404 if the job is unavailable to the current user.
    if (jobs.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Job not found.",
      });
    }

    // Extract the existing job record.
    const job = jobs[0];

    // Preserve existing values when fields are not submitted.
    const updatedTitle =
      title !== undefined ? title.trim() : job.title;

    const updatedCompanyName =
      company_name !== undefined
        ? company_name?.trim() || null
        : job.company_name;

    const updatedLocation =
      location !== undefined
        ? location?.trim() || null
        : job.location;

    const updatedSourceUrl =
      source_url !== undefined
        ? source_url?.trim() || null
        : job.source_url;

    const updatedDescription =
      description !== undefined
        ? description.trim()
        : job.description;

    // Normalize the previously stored skills.
    let extractedSkills = normalizeSkills(job.extracted_skills);

    // Re-extract skills only when the job description changes.
    if (updatedDescription !== job.description) {
      extractedSkills = await extractJobSkills(updatedDescription);
    }

    // Prepare the SQL query to update the job information.
    const updateQuery = `
      UPDATE jobs
      SET
        title = ?,
        company_name = ?,
        location = ?,
        source_url = ?,
        description = ?,
        extracted_skills = ?
      WHERE id = ? AND user_id = ?
    `;

    // Execute the ownership-aware update query.
    await db.execute(updateQuery, [
      updatedTitle,
      updatedCompanyName,
      updatedLocation,
      updatedSourceUrl,
      updatedDescription,
      JSON.stringify(extractedSkills),
      jobId,
      userId,
    ]);

    // Return the updated job information.
    return res.status(200).json({
      success: true,
      message: "Job updated successfully.",
      data: {
        id: jobId,
        user_id: userId,
        title: updatedTitle,
        company_name: updatedCompanyName,
        location: updatedLocation,
        source_url: updatedSourceUrl,
        description: updatedDescription,
        extracted_skills: extractedSkills,
      },
    });
  } catch (error) {
    // Log the error for server-side debugging.
    console.error("Error in updateJob:", error);

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while updating the job.",
    });
  }
};

// Delete a specific job owned by the authenticated user.
exports.deleteJob = async (req, res) => {
  try {
    // Extract the job ID and authenticated user ID.
    const jobId = req.params.id;
    const userId = req.user.id;

    // Validate the provided job ID.
    if (!isValidId(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID.",
      });
    }

    // Delete the job only if it belongs to the authenticated user.
    const query = `
      DELETE FROM jobs
      WHERE id = ? AND user_id = ?
    `;

    // Execute the deletion query.
    const [result] = await db.execute(query, [jobId, userId]);

    // Return 404 if no matching job was deleted.
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Job not found.",
      });
    }

    // Confirm successful deletion.
    return res.status(200).json({
      success: true,
      message: "Job deleted successfully.",
    });
  } catch (error) {
    // Log the error for server-side debugging.
    console.error("Error in deleteJob:", error);

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while deleting the job.",
    });
  }
};
