ALTER TABLE "buildings" ADD COLUMN "has_sprinkler" boolean;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "has_water_spray" boolean;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "has_smoke_control" boolean;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "is_multi_use_business" boolean;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "is_apartment" boolean;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "is_performance_design" boolean;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "longitude" double precision;