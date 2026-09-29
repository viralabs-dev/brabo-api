CREATE TABLE "detected_language_declines" (
	"user_id" uuid NOT NULL,
	"language" text NOT NULL,
	"declined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detected_language_declines_user_id_language_pk" PRIMARY KEY("user_id","language")
);
--> statement-breakpoint
ALTER TABLE "detected_language_declines" ADD CONSTRAINT "detected_language_declines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_evidencia_de_idioma_idx" ON "session_events" USING btree ("actor_id","created_at") WHERE "session_events"."actor_kind" = 'user' AND "session_events"."type" IN ('chat.message', 'chat.structured_question_answered');