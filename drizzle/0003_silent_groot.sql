ALTER TABLE "objects" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ordered_objects AS (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "status" ORDER BY "created_at", "id") - 1)::integer AS "position"
  FROM "objects"
)
UPDATE "objects"
SET "position" = ordered_objects."position"
FROM ordered_objects
WHERE "objects"."id" = ordered_objects."id";--> statement-breakpoint
CREATE INDEX "objects_status_position_idx" ON "objects" USING btree ("status","position");
