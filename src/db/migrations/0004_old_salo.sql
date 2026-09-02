ALTER TABLE "buildings" ALTER COLUMN "use_approval_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "recurring_inspection_month" integer;