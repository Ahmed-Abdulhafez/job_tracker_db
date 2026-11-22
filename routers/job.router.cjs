const express = require('express');
const router = express.Router();
const jobController = require('../controllers/job.controller.cjs');
const verifyToken = require('../middlewares/auth.middleware.cjs');

// create Job
router.post('/', verifyToken, jobController.createJob);

// get User Jobs
router.get('/', verifyToken, jobController.getUserJobs);

// get Job By Id
router.get('/:id', verifyToken, jobController.getJobById);

// update Job
router.put('/:id', verifyToken, jobController.updateJob);

// delete Job
router.delete('/:id', verifyToken, jobController.deleteJob);

module.exports = router;