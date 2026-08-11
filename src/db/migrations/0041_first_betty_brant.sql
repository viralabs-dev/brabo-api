CREATE TYPE "public"."socket_ticket_scope" AS ENUM('heartbeat', 'terminal');--> statement-breakpoint
CREATE TABLE "session_socket_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" "socket_ticket_scope" NOT NULL,
	"ticket_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_socket_tickets" ADD CONSTRAINT "session_socket_tickets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_socket_tickets" ADD CONSTRAINT "session_socket_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_socket_tickets" ADD CONSTRAINT "session_socket_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_socket_tickets_hash_idx" ON "session_socket_tickets" USING btree ("ticket_hash");--> statement-breakpoint
CREATE INDEX "session_socket_tickets_session_idx" ON "session_socket_tickets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_socket_tickets_expires_idx" ON "session_socket_tickets" USING btree ("expires_at");