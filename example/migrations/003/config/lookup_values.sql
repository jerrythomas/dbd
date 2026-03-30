-- Migration: version 2 → 3
-- Generated: 2026-03-30T17:29:46.588Z

ALTER TABLE "config"."lookup_values" ADD COLUMN "notes" text;