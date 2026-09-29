CREATE TABLE "session_language_overrides" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"language" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_language_overrides_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "response_language" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "detected_language" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "detected_language_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_language_overrides" ADD CONSTRAINT "session_language_overrides_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_language_overrides" ADD CONSTRAINT "session_language_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_idioma_detectado_so_confirmado" CHECK (("users"."detected_language" IS NULL) = ("users"."detected_language_confirmed_at" IS NULL));