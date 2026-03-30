-- Migration: version 1 → 2
-- Generated: 2026-03-30T17:25:48.724Z

ALTER TABLE "config"."lookup_values" ALTER COLUMN "is_active" SET DEFAULT TRUE;
ALTER TABLE "config"."lookup_values" ALTER COLUMN "is_hidden" SET DEFAULT FALSE;