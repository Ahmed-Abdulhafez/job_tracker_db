
const Joi = require("joi");

exports.registerSchema = Joi.object({
  full_name: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .required(),

  email: Joi.string()
    .trim()
    .email()
    .max(255)
    .required(),

  password: Joi.string()
    .min(8)
    .max(128)
    .required(),
});

exports.loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email()
    .required(),

  password: Joi.string()
    .required(),
});
