CREATE TYPE "public"."recurrence_basis" AS ENUM('scheduled_date', 'completion_date');--> statement-breakpoint
CREATE TYPE "public"."recurrence_frequency" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "recurrence_series_id" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "recurrence_frequency" "recurrence_frequency";--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "recurrence_interval" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "recurrence_basis" "recurrence_basis";--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "recurrence_next_date" date;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "previous_occurrence_id" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "next_occurrence_id" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "occurrence_note" text;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_previous_occurrence_id_objects_id_fk" FOREIGN KEY ("previous_occurrence_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_next_occurrence_id_objects_id_fk" FOREIGN KEY ("next_occurrence_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "objects_recurrence_series_id_idx" ON "objects" USING btree ("recurrence_series_id");