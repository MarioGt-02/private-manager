CREATE TYPE "public"."category_color" AS ENUM('blue', 'cyan', 'teal', 'green', 'lime', 'amber', 'orange', 'red', 'rose', 'violet', 'indigo', 'slate', 'brown');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" "category_color" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "category_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_unique" ON "categories" USING btree (lower(btrim("name")));--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "categories" ("id", "name", "color") VALUES
('c9300000-0000-4000-8000-000000000001', 'Tech & Software', 'blue'),
('c9300000-0000-4000-8000-000000000002', 'Maker & DIY', 'orange'),
('c9300000-0000-4000-8000-000000000003', 'Home & Life', 'slate'),
('c9300000-0000-4000-8000-000000000004', 'Vehicles', 'amber'),
('c9300000-0000-4000-8000-000000000005', 'Creative', 'violet'),
('c9300000-0000-4000-8000-000000000006', 'Health & Sport', 'green'),
('c9300000-0000-4000-8000-000000000007', 'Work & Business', 'cyan'),
('c9300000-0000-4000-8000-000000000008', 'Study & Learning', 'indigo');
