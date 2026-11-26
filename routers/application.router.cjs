const express = require("express");
const router = express.Router();

const validate = require("../middlewares/validate.middleware.cjs");
const {
  evaluateApplicationSchema,
  // يمكنك إضافة schemas أخرى هنا إذا أنشأتها في application.validation.cjs:
  // updateApplicationStatusSchema,
  // applicationIdParamSchema,
} = require("../validations/application.validation.cjs");

const applicationController = require("../controllers/application.controller.cjs");
const verifyToken = require("../middlewares/auth.middleware.cjs");
const { isAdmin } = require("../middlewares/isAdmin.middleware.cjs");


// 1. تقييم السيرة الذاتية مع الوظيفة وتوليد خطاب التغطية
router.post(
  "/evaluate",
  verifyToken,
  validate(evaluateApplicationSchema),
  applicationController.evaluateJobApplication,
);

// 2. جلب جميع طلبات التقديم للمستخدم (مع pagination وفلترة حسب status)
router.get(
  "/",
  verifyToken,
  isAdmin,
  applicationController.getAllApplication,
);

// 3. جلب تفاصيل طلب تقديم واحد مع تاريخ التقييمات المرتبطة به
router.get(
  "/:id",
  verifyToken,
  applicationController.getApplicationById,
);

// 4. تحديث حالة طلب التقديم (SAVED, APPLIED, INTERVIEWING, ACCEPTED, REJECTED, WITHDRAWN)
router.patch(
  "/:id/status",
  verifyToken,
  // إذا أضفت updateApplicationStatusSchema يمكنك تفعيل السطر التالي:
  // validate(updateApplicationStatusSchema),
  applicationController.updateApplicationStatus,
);

// 5. حذف طلب تقديم معين
router.delete(
  "/:id",
  verifyToken,
  applicationController.deleteApplication,
);

module.exports = router;