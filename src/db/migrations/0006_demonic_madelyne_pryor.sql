CREATE TABLE IF NOT EXISTS "driving_distances" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_id_a" integer NOT NULL,
	"building_id_b" integer NOT NULL,
	"distance_km" double precision NOT NULL,
	"duration_minutes" double precision NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driving_distances" ADD CONSTRAINT "driving_distances_building_id_a_buildings_id_fk" FOREIGN KEY ("building_id_a") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driving_distances" ADD CONSTRAINT "driving_distances_building_id_b_buildings_id_fk" FOREIGN KEY ("building_id_b") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driving_distances_pair_idx" ON "driving_distances" USING btree ("building_id_a","building_id_b");