ALTER TABLE "objects" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "objects_status_archived_at_idx" ON "objects" USING btree ("status","archived_at");