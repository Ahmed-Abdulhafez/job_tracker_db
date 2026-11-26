const express = require("express");
const userController = require("../controllers/user.controller.cjs");
const validate = require("../middlewares/validate.middleware.cjs");

const {
  registerSchema,
  loginSchema,
} = require("../validations/user.validation.cjs");

const verifyToken = require("../middlewares/auth.middleware.cjs");
const { isAdmin } = require("../middlewares/isAdmin.middleware.cjs");

const router = express.Router();

// Public Auth Routes - User Registration and User Login
router.post("/register", validate(registerSchema), userController.userRegister);
router.post("/login", validate(loginSchema), userController.userLogin);

// Get User profile and Update User profile
router.get("/profile", verifyToken, userController.getMyProfile);
router.put("/profile", verifyToken, userController.updateUserProfile);

// Admin Routes - delete User and Get All Users
router.get("/", verifyToken, isAdmin, userController.getAllUsers);
router.delete("/:id", verifyToken, isAdmin, userController.deleteUser);

// Get User By ID
router.get("/:id", verifyToken, userController.getUserById);

module.exports = router;
