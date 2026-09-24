CREATE TYPE "public"."object_table_column_type" AS ENUM('text', 'number', 'date', 'currency', 'checkbox');--> statement-breakpoint
CREATE TABLE "object_table_cells" (
	"id" text PRIMARY KEY NOT NULL,
	"row_id" text NOT NULL,
	"column_id" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_table_columns" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "object_table_column_type" NOT NULL,
	"currency" text,
	"position" integer DEFAULT 0 NOT NULL,
	"carry_forward" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_table_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"carry_forward" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"object_id" text NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_table_cells" ADD CONSTRAINT "object_table_cells_row_id_object_table_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."object_table_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_table_cells" ADD CONSTRAINT "object_table_cells_column_id_object_table_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."object_table_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_table_columns" ADD CONSTRAINT "object_table_columns_table_id_object_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."object_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_table_rows" ADD CONSTRAINT "object_table_rows_table_id_object_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."object_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_tables" ADD CONSTRAINT "object_tables_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_table_cells_row_column_idx" ON "object_table_cells" USING btree ("row_id","column_id");--> statement-breakpoint
CREATE INDEX "object_table_cells_column_id_idx" ON "object_table_cells" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "object_table_columns_table_id_idx" ON "object_table_columns" USING btree ("table_id","position");--> statement-breakpoint
CREATE INDEX "object_table_rows_table_id_idx" ON "object_table_rows" USING btree ("table_id","position");--> statement-breakpoint
CREATE INDEX "object_tables_object_id_idx" ON "object_tables" USING btree ("object_id","position");