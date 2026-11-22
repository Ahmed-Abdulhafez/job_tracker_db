
const Joi = require("joi");

exports.evaluateApplicationSchema = Joi.object({
  resume_id: Joi.number()
    .integer()
    .positive()
    .required(),

  job_id: Joi.number()
    .integer()
    .positive()
    .required(),
});
