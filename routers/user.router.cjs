const express = require("express");
const userController = require("../controllers/user.controller.cjs");
const validate = require("../middlewares/validate.middleware.cjs");

const {
  registerSchema,
  loginSchema,
} = require("../validations/user.validation.cjs");
const verifyToken = require("../middlewares/auth.middleware.cjs");
const router = express.Router();

// User Registration Routes
router.post("/register",validate(registerSchema), userController.userRegister);

// User Login Routes
router.post("/login",validate(loginSchema), userController.userLogin);

// Get All Users Route
router.get("/", userController.getAllUsers);

// Get User profile Route
router.get("/profile", verifyToken, userController.getMyProfile);

// Update User profile Route
router.put("/profile", verifyToken, userController.updateUserProfile);

// Get User By ID Route
router.get("/:id", userController.getUserById);

// delete User
router.delete("/:id", userController.deleteUser);

module.exports = router;
