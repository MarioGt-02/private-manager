CREATE TYPE "public"."object_status" AS ENUM('idea', 'ready', 'doing', 'waiting', 'done');--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"object_id" text NOT NULL,
	"title" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"object_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" "object_status" DEFAULT 'idea' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"current_state" text DEFAULT '' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_updates" ADD CONSTRAINT "object_updates_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_object_id_idx" ON "checklist_items" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "object_updates_object_id_idx" ON "object_updates" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "objects_status_idx" ON "objects" USING btree ("status");