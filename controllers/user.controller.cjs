
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

// ======================================================
// USER REGISTER
// ======================================================

exports.userRegister = async (req, res) => {
  try {
    // 1. Extract registration data from the request body.
    const { full_name, email, password } = req.body;

    // 2. Validate that all required fields are provided.
    if (
      typeof full_name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !full_name.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid registration data.",
      });
    }

    // 3. Normalize user input to maintain consistent database values.
    const normalizedName = full_name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Validate the full name length.
    if (normalizedName.length < 3 || normalizedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Full name must be between 3 and 100 characters.",
      });
    }

    // 5. Validate the email format.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    // 6. Validate the password length.
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({
        success: false,
        message: "Password must be between 8 and 72 characters.",
      });
    }

    // 7. Check whether the email is already registered.
    const [existingUsers] = await db.execute(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered.",
      });
    }

    // 8. Generate a secure password hash using bcrypt.
    const saltRounds = Number(process.env.SALT) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 9. Insert the new user into the database.
    // The database automatically assigns the default USER role.
    const [result] = await db.execute(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES (?, ?, ?)`,
      [normalizedName, normalizedEmail, passwordHash]
    );

    // 10. Return the successful registration response.
    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      user: {
        id: result.insertId,
        full_name: normalizedName,
        email: normalizedEmail,
      },
    });

  } catch (error) {
    // 11. Handle duplicate email errors caused by concurrent requests.
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Email is already registered.",
      });
    }

    // 12. Log unexpected errors and return a generic server response.
    console.error("Registration Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// ======================================================
// USER LOGIN
// ======================================================

exports.userLogin = async (req, res) => {
  try {
    // 1. Extract login credentials from the request body.
    const { email, password } = req.body;

    // 2. Validate the required login fields.
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // 3. Normalize the email before querying the database.
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Retrieve the user by email.
    const [users] = await db.execute(
      `SELECT id, full_name, email, password_hash, role
       FROM users
       WHERE email = ?`,
      [normalizedEmail]
    );

    // 5. Check whether the user exists.
    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = users[0];

    // 6. Compare the submitted password with the stored password hash.
    const isPasswordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    // 7. Reject the login request if the password is incorrect.
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // 8. Ensure that the JWT secret is configured.
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    // 9. Generate a signed JWT containing the user's identity and role.
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1d",
      }
    );

    // 10. Configure secure cookie options.
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.COOKIE_SAME_SITE || "lax",
      maxAge: 60 * 60 * 1000,
    };

    // 11. Store the JWT in an HTTP-only cookie.
    res.cookie("token", token, cookieOptions);

    // 12. Return the authenticated user's public information.
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        token: token
      },
    });

  } catch (error) {
    // 13. Handle unexpected login errors.
    console.error("Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// ======================================================
// GET ALL USERS
// ======================================================

exports.getAllUsers = async (req, res) => {
  try {
    // 1. Retrieve all users using only public fields.
    const [users] = await db.execute(
      `SELECT id, full_name, email, role, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    // 2. Return the retrieved users.
    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });

  } catch (error) {
    // 3. Log database errors and return a server error response.
    console.error("Get All Users Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// ======================================================
// GET USER BY ID
// ======================================================

exports.getUserById = async (req, res) => {
  try {
    // 1. Extract the user ID from the route parameters.
    const { id } = req.params;

    // 2. Validate the user ID.
    if (!/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    // 3. Retrieve the user using the provided ID.
    const [users] = await db.execute(
      `SELECT id, full_name, email, role, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [id]
    );

    // 4. Check whether the requested user exists.
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // 5. Return the requested user's public information.
    return res.status(200).json({
      success: true,
      user: users[0],
    });

  } catch (error) {
    // 6. Handle unexpected database errors.
    console.error("Get User By ID Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// ======================================================
// GET MY PROFILE
// ======================================================

exports.getMyProfile = async (req, res) => {
  try {
    // 1. Ensure that the authentication middleware identified the user.
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Extract the authenticated user's ID.
    const userId = req.user.id;

    // 3. Retrieve the authenticated user's profile.
    const [users] = await db.execute(
      `SELECT id, full_name, email, role, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [userId]
    );

    // 4. Check whether the user still exists in the database.
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // 5. Return the authenticated user's profile.
    return res.status(200).json({
      success: true,
      user: users[0],
    });

  } catch (error) {
    // 6. Handle unexpected profile retrieval errors.
    console.error("Get My Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// ======================================================
// UPDATE USER PROFILE
// ======================================================

exports.updateUserProfile = async (req, res) => {
  try {
    // 1. Ensure that the user is authenticated.
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // 2. Extract the new full name from the request body.
    const { full_name } = req.body;

    // 3. Validate the full name.
    if (
      typeof full_name !== "string" ||
      full_name.trim().length < 3 ||
      full_name.trim().length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Full name must be between 3 and 100 characters.",
      });
    }

    // 4. Normalize the new full name.
    const normalizedName = full_name.trim();

    // 5. Update the authenticated user's profile.
    const [result] = await db.execute(
      "UPDATE users SET full_name = ? WHERE id = ?",
      [normalizedName, req.user.id]
    );

    // 6. Check whether the user exists.
    if (result.affectedRows === 0) {
      const [users] = await db.execute(
        "SELECT id FROM users WHERE id = ?",
        [req.user.id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }
    }

    // 7. Return the updated profile information.
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: {
        id: req.user.id,
        full_name: normalizedName,
      },
    });

  } catch (error) {
    // 8. Handle unexpected profile update errors.
    console.error("Update Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// ======================================================
// DELETE USER
// ======================================================

exports.deleteUser = async (req, res) => {
  try {
    // 1. Extract the user ID from the route parameters.
    const { id } = req.params;

    // 2. Validate the user ID.
    if (!/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    // 3. Delete the user from the database.
    const [result] = await db.execute(
      "DELETE FROM users WHERE id = ?",
      [id]
    );

    // 4. Check whether a user was actually deleted.
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // 5. Return a successful deletion response.
    return res.status(200).json({
      success: true,
      message: "User deleted successfully.",
    });

  } catch (error) {
    // 6. Handle database errors, including foreign key constraints.
    console.error("Delete User Error:", error);

    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        success: false,
        message: "Cannot delete this user because related records exist.",
      });
    }

    // 7. Return a generic server error for unexpected failures.
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};