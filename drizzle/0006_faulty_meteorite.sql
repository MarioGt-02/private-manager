CREATE TABLE "object_dependencies" (
	"object_id" text NOT NULL,
	"depends_on_object_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_dependencies_object_id_depends_on_object_id_pk" PRIMARY KEY("object_id","depends_on_object_id")
);
--> statement-breakpoint
ALTER TABLE "object_dependencies" ADD CONSTRAINT "object_dependencies_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_dependencies" ADD CONSTRAINT "object_dependencies_depends_on_object_id_objects_id_fk" FOREIGN KEY ("depends_on_object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_dependencies_depends_on_idx" ON "object_dependencies" USING btree ("depends_on_object_id");