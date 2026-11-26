module.exports.isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized! User authentication data is missing.",
    });
  }

  const userRole = String(req.user.role || "").toLowerCase();

  if (userRole !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access Denied! You must be an admin to perform this action.",
    });
  }

  return next();
};