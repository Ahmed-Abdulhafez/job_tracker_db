require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");

const userRoutes = require("./routers/user.router.cjs");
const jobRoutes = require("./routers/job.router.cjs");
const resumeRoutes = require("./routers/resume.routes.cjs");
const applicationRoutes = require("./routers/application.router.cjs");



const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
  res.json({ message: "Job Tracker API is running successfully!" });
});

app.use("/api/users", userRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/resumes", resumeRoutes);
app.use("/api/applications", applicationRoutes);


module.exports = app;
