const { GoogleGenAI } = require("@google/genai");

const {
  getResumeAnalysisPrompt,
  getJobMatchingPrompt,
} = require("../prompts/prompts.cjs");

// Initialize Gemini client once
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Models priority order
const MODELS_TO_TRY = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 15000;

// Wait utility
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Check whether the error is retryable
function isRetryableError(error) {
  const status =
    error.status ||
    error.statusCode ||
    error.response?.status ||
    error.error?.code;

  return [429, 500, 502, 503, 504].includes(Number(status));
}

// Generate prompt based on task type
function buildPrompt(taskType, data) {
  switch (taskType) {
    case "ANALYZE_RESUME":
      return getResumeAnalysisPrompt ? getResumeAnalysisPrompt(data) : data;

    case "MATCH_JOB":
      return getJobMatchingPrompt(data.resumeData, data.jobDescription);

    default:
      throw new Error("Invalid AI task type specified");
  }
}

// Generate content with retry mechanism
async function callModelWithRetry(modelName, prompt) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      if (!response?.text) {
        throw new Error("Gemini returned an empty response");
      }

      return JSON.parse(response.text);
    } catch (error) {
      const shouldRetry = isRetryableError(error) && attempt < MAX_RETRIES;

      if (!shouldRetry) {
        throw error;
      }

      const delay = Math.min(
        INITIAL_RETRY_DELAY * Math.pow(1, attempt),
        MAX_RETRY_DELAY,
      );

      console.warn(
        `Gemini retry ${attempt + 1}/${MAX_RETRIES} ` +
          `for ${modelName} after ${delay}ms`,
      );

      await sleep(delay);
    }
  }
}

// Main AI service with model fallback
async function callGeminiAI(taskType, data) {
  const prompt = buildPrompt(taskType, data);

  let lastError;

  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`Trying Gemini model: ${modelName}`);

      const result = await callModelWithRetry(modelName, prompt);

      console.log(`Gemini model succeeded: ${modelName}`);

      return result;
    } catch (error) {
      console.warn(`Model ${modelName} failed:`, error.message);

      lastError = error;
    }
  }

  throw new Error(
    `All AI models failed: ${lastError?.message || "Unknown error"}`,
  );
}

module.exports = {
  callGeminiAI,
};
