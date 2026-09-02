CREATE INDEX IF NOT EXISTS "buildings_user_id_idx" ON "buildings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_schedules_building_id_idx" ON "inspection_schedules" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_schedules_scheduled_date_idx" ON "inspection_schedules" USING btree ("scheduled_date");