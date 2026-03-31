-- Migration: version 1 → 2
-- Generated: 2026-03-30T17:25:48.724Z

ALTER TABLE "config"."lookups" ADD COLUMN "display_order" int DEFAULT 0;
ALTER TABLE "config"."lookups" ALTER COLUMN "is_editable" SET DEFAULT TRUE;