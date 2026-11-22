
-- =========================================================
-- DATABASE: JOB TRACKER
-- Resume & Job Application Tracking System
-- MySQL 8.0.16+
-- Character Set: utf8mb4
-- =========================================================

CREATE DATABASE IF NOT EXISTS job_tracker_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE job_tracker_db;


-- =========================================================
-- 1. USERS
-- مسؤول عن تخزين بيانات المستخدمين وإدارة صلاحياتهم.
-- كل مستخدم يمتلك سير ذاتية ووظائف وطلبات تقديم خاصة به.
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    email VARCHAR(255) NOT NULL UNIQUE,

    password_hash VARCHAR(255) NOT NULL,

    full_name VARCHAR(100) NOT NULL,

    role ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB;


-- =========================================================
-- 2. RESUMES
-- مسؤول عن تخزين السير الذاتية التي يرفعها المستخدم.
--
-- raw_text:
-- النص المستخرج من ملف PDF أو DOCX.
--
-- parsed_data:
-- البيانات المنظمة المستخرجة بواسطة Gemini AI.
--
-- overall_score:
-- نتيجة تقييم جودة السيرة الذاتية.
-- =========================================================


CREATE TABLE IF NOT EXISTS resumes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    file_name VARCHAR(255) NOT NULL,

    file_url TEXT NOT NULL,

    cloudinary_public_id VARCHAR(255) NULL,

    cloudinary_resource_type ENUM('image', 'raw', 'video')
        NOT NULL DEFAULT 'raw',

    raw_text LONGTEXT NOT NULL,

    parsed_data JSON NOT NULL,

    overall_score TINYINT UNSIGNED NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes to improve query performance.
    INDEX idx_resumes_user_id (user_id),
    INDEX idx_resumes_score (overall_score),
    INDEX idx_resumes_user_created (user_id, created_at),

    -- Ensure the resume score is between 0 and 100.
    -- CONSTRAINT chk_resume_score
    --     CHECK (overall_score BETWEEN 0 AND 100),

    -- Link each resume to its owner.
    CONSTRAINT fk_resumes_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;



-- =========================================================
-- 3. JOBS
-- مسؤول عن تخزين الوظائف التي يضيفها المستخدم.
--
-- extracted_skills:
-- المهارات المستخرجة من وصف الوظيفة بواسطة AI.
--
-- كل وظيفة مرتبطة بالمستخدم الذي أضافها.
-- =========================================================


CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    title VARCHAR(150) NOT NULL,

    company_name VARCHAR(150) NULL,

    location VARCHAR(150) NULL,

    source_url VARCHAR(2048) NULL,

    description LONGTEXT NOT NULL,

    extracted_skills JSON NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    -- Optimize user-specific job retrieval and sorting.
    INDEX idx_jobs_user_created (user_id, created_at),

    -- Link each job to its owner.
    CONSTRAINT fk_jobs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;



-- =========================================================
-- 4. APPLICATIONS
-- مسؤول عن إدارة طلبات التقديم على الوظائف.
--
-- مهم:
-- هذا الجدول لا يخزن تاريخ التقييمات.
-- يحتفظ فقط ببيانات التقديم والحالة الحالية.
--
-- latest_evaluation_id:
-- يشير إلى أحدث تقييم مرتبط بطلب التقديم.
--
-- كل مستخدم يستطيع إنشاء Application واحدة
-- لكل وظيفة داخل حسابه.
-- =========================================================

CREATE TABLE IF NOT EXISTS applications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    job_id BIGINT UNSIGNED NOT NULL,

    -- أحدث تقييم مرتبط بطلب التقديم.
    latest_evaluation_id BIGINT UNSIGNED NULL,

    status ENUM(
        'SAVED',
        'APPLIED',
        'INTERVIEWING',
        'ACCEPTED',
        'REJECTED',
        'WITHDRAWN'
    ) NOT NULL DEFAULT 'SAVED',

    applied_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    -- منع إنشاء Application مكررة لنفس المستخدم والوظيفة.
    CONSTRAINT uq_application_user_job
        UNIQUE (user_id, job_id),

    -- Indexes للـ Dashboard والفلترة.
    INDEX idx_applications_user_status (user_id, status),

    INDEX idx_applications_job_id (job_id),

    INDEX idx_applications_created (created_at),

    -- ربط Application بالمستخدم.
    CONSTRAINT fk_applications_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    -- ربط Application بالوظيفة.
    CONSTRAINT fk_applications_job
        FOREIGN KEY (job_id)
        REFERENCES jobs(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;


-- =========================================================
-- 5. APPLICATION EVALUATIONS
-- مسؤول عن الاحتفاظ بتاريخ جميع عمليات تقييم الوظائف.
--
-- كل Application يمكن أن تمتلك Evaluations متعددة.
--
-- resume_snapshot:
-- نسخة من بيانات السيرة الذاتية وقت التقييم.
--
-- job_description_snapshot:
-- نسخة من وصف الوظيفة وقت التقييم.
--
-- request_id:
-- يربط التقييم بطلب AI الذي أنشأه.
-- UNIQUE يمنع حفظ أكثر من نتيجة لنفس الطلب.
-- =========================================================

CREATE TABLE IF NOT EXISTS application_evaluations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    application_id BIGINT UNSIGNED NOT NULL,

    resume_id BIGINT UNSIGNED NULL,

    request_id BIGINT UNSIGNED NOT NULL,

    match_score TINYINT UNSIGNED NOT NULL,

    missing_skills JSON NULL,

    ai_suggestions JSON NULL,

    cover_letter LONGTEXT NULL,

    -- الاحتفاظ بنسخة من بيانات CV وقت التقييم.
    resume_snapshot JSON NOT NULL,

    -- الاحتفاظ بنسخة من وصف الوظيفة وقت التقييم.
    job_description_snapshot LONGTEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- كل طلب تقييم ينتج عنه سجل واحد فقط.
    CONSTRAINT uq_evaluation_request
        UNIQUE (request_id),

    -- Indexes لاسترجاع تاريخ التقييمات.
    INDEX idx_evaluations_application (
        application_id,
        created_at
    ),

    INDEX idx_evaluations_resume (resume_id),

    INDEX idx_evaluations_score (match_score),

    -- التأكد أن نسبة التوافق بين 0 و100.
    CONSTRAINT chk_match_score
        CHECK (match_score BETWEEN 0 AND 100),

    -- ربط التقييم بطلب التقديم.
    CONSTRAINT fk_evaluations_application
        FOREIGN KEY (application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE,

    -- الاحتفاظ بالتقييم حتى لو حُذفت السيرة الأصلية.
    CONSTRAINT fk_evaluations_resume
        FOREIGN KEY (resume_id)
        REFERENCES resumes(id)
        ON DELETE SET NULL

) ENGINE=InnoDB;


-- =========================================================
-- 6. EVALUATION REQUESTS
-- مسؤول عن إدارة عمليات تقييم الوظائف باستخدام Gemini AI.
--
-- Idempotency:
-- منع تكرار نفس الطلب باستخدام idempotency_key.
--
-- request_hash:
-- التأكد من أن المفتاح لم يستخدم مع بيانات مختلفة.
--
-- status:
-- PENDING     = في انتظار التنفيذ.
-- PROCESSING  = قيد التنفيذ.
-- COMPLETED   = اكتمل بنجاح.
-- FAILED      = فشل نهائي.
--
-- attempts:
-- عدد محاولات التنفيذ.
--
-- locked_at:
-- وقت استحواذ Worker على المهمة.
--
-- lease_token:
-- هوية القفل الحالي لمنع Worker قديم من حفظ النتيجة.
--
-- next_retry_at:
-- موعد إعادة المحاولة.
--
-- response_data:
-- تخزين نتيجة Gemini لإعادة إرسالها عند تكرار الطلب.
--
-- snapshots:
-- الاحتفاظ بمدخلات التحليل حتى يمكن استعادة المهمة.
-- =========================================================

CREATE TABLE IF NOT EXISTS evaluation_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    application_id BIGINT UNSIGNED NOT NULL,

    resume_id BIGINT UNSIGNED NULL,

    job_id BIGINT UNSIGNED NULL,

    -- المفتاح الفريد القادم من Frontend.
    idempotency_key VARCHAR(100) NOT NULL,

    -- بصمة بيانات الطلب.
    request_hash CHAR(64) NOT NULL,

    status ENUM(
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
    ) NOT NULL DEFAULT 'PENDING',

    attempts INT UNSIGNED NOT NULL DEFAULT 0,

    max_attempts INT UNSIGNED NOT NULL DEFAULT 3,

    locked_at DATETIME NULL,

    lease_token CHAR(36) NULL,

    next_retry_at DATETIME NULL,

    evaluation_id BIGINT UNSIGNED NULL,

    response_data JSON NULL,

    -- Snapshot لمدخلات التحليل حتى يمكن استعادة المهمة.
    resume_snapshot JSON NOT NULL,

    job_description_snapshot LONGTEXT NOT NULL,

    last_error TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    -- منع تكرار نفس الطلب لنفس المستخدم.
    CONSTRAINT uq_user_idempotency
        UNIQUE (user_id, idempotency_key),

    -- Index للبحث عن المهام القابلة للتنفيذ والاستعادة.
    INDEX idx_evaluation_recovery (
        status,
        next_retry_at,
        locked_at
    ),

    INDEX idx_evaluation_user (user_id, created_at),

    INDEX idx_evaluation_application (application_id),

    -- عدد المحاولات يجب ألا يتجاوز الحد المسموح.
    CONSTRAINT chk_evaluation_attempts
        CHECK (attempts <= max_attempts),

    -- ربط الطلب بالمستخدم.
    CONSTRAINT fk_requests_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    -- ربط الطلب بالـ Application.
    CONSTRAINT fk_requests_application
        FOREIGN KEY (application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE,

    -- يمكن الاحتفاظ بالطلب حتى لو حُذفت السيرة.
    CONSTRAINT fk_requests_resume
        FOREIGN KEY (resume_id)
        REFERENCES resumes(id)
        ON DELETE SET NULL,

    -- يمكن الاحتفاظ بالطلب حتى لو حُذفت الوظيفة.
    CONSTRAINT fk_requests_job
        FOREIGN KEY (job_id)
        REFERENCES jobs(id)
        ON DELETE SET NULL

) ENGINE=InnoDB;


-- =========================================================
-- 7. ADDITIONAL RELATIONSHIPS
-- إضافة العلاقات التي تعتمد على جداول تم إنشاؤها لاحقاً.
--
-- Applications -> Latest Evaluation
-- Evaluation Requests -> Generated Evaluation
-- Evaluation -> Original Evaluation Request
-- =========================================================

ALTER TABLE applications
ADD CONSTRAINT fk_applications_latest_evaluation
    FOREIGN KEY (latest_evaluation_id)
    REFERENCES application_evaluations(id)
    ON DELETE SET NULL;


ALTER TABLE evaluation_requests
ADD CONSTRAINT fk_requests_evaluation
    FOREIGN KEY (evaluation_id)
    REFERENCES application_evaluations(id)
    ON DELETE SET NULL;


ALTER TABLE application_evaluations
ADD CONSTRAINT fk_evaluations_request
    FOREIGN KEY (request_id)
    REFERENCES evaluation_requests(id)
    ON DELETE RESTRICT;


-- =========================================================
-- END OF DATABASE SCHEMA
-- =========================================================
