const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

/**
 * التحقق من أن المعرف عدد صحيح موجب صالح (أكبر من 0)
 */
const isValidId = (id) => {
  if (id === null || id === undefined) return false;
  if (typeof id === "boolean" || typeof id === "object") return false;

  const normalized = String(id).trim();
  if (!/^[1-9]\d*$/.test(normalized)) return false;

  const num = Number(normalized);
  return Number.isSafeInteger(num) && num > 0 && num <= MAX_SAFE_ID;
};

/**
 * التحقق من أن درجة التقييم عدد صحيح بين 0 و 100
 */
const isValidScore = (score) => {
  if (typeof score !== "number") return false;
  return Number.isInteger(score) && score >= 0 && score <= 100;
};

/**
 * التحقق الآمن من وجود هوية مستخدم موثّق في الطلب
 */
const isAuthenticated = (req) => {
  const userId = req?.user?.id;
  return Boolean(userId);
};

module.exports = {
  isValidId,
  isValidScore,
  isAuthenticated,
};