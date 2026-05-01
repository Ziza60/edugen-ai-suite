-- Edugen Data Dump
SET session_replication_role = 'replica';

-- Data for tutor_sessions

-- Data for course_landings

-- Data for landing_page_permissions

-- Data for pptx_export_reports

-- Data for courses

-- Data for course_sources

-- Data for course_reviews
INSERT INTO "course_reviews" ( "id", "course_id", "user_id", "review_token", "is_active", "created_at", "expires_at") VALUES ('5f257ee9-24c1-4934-b8df-55ab963b0f8d', '43c41ec9-d179-4fe6-9506-dbdb0bec3acc', '389a5d7f-5d24-46ed-a315-e4e86ec53c3b', 'e12dd7e5-580a-4107-ba62-bee1d62035e5', True, '2026-03-13T03:22:07.105143+00:00', NULL) ON CONFLICT DO NOTHING;

-- Data for review_comments
INSERT INTO "review_comments" ( "id", "review_id", "module_id", "reviewer_name", "comment", "resolved", "created_at") VALUES ('11039cb4-c010-4a52-94b5-6ea962c3ac16', '5f257ee9-24c1-4934-b8df-55ab963b0f8d', 'b8fa6c5c-cc45-483f-a272-202ac174bd68', 'Pedro', 'melhorei alguns paragrafos do segundo módulo', False, '2026-03-13T03:23:27.350181+00:00') ON CONFLICT DO NOTHING;

-- Data for profiles

-- Data for subscriptions

-- Data for course_modules

-- Data for workspaces

-- Data for workspace_members

-- Data for certificates

-- Data for course_quiz_questions

-- Data for course_flashcards

-- Data for course_images

-- Data for workspace_invites

SET session_replication_role = 'origin';
