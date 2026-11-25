CREATE TABLE "webhook_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"integration_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "webhook_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_jobs_due_at_index" ON "webhook_jobs" USING btree ("due_at") WHERE "webhook_jobs"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "webhook_jobs_integration_id_index" ON "webhook_jobs" USING btree ("integration_id");