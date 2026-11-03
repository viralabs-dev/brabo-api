CREATE TABLE "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"autor_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_autor_id_users_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_attachments_session_idx" ON "chat_attachments" USING btree ("session_id");