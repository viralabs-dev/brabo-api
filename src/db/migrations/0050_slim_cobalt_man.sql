CREATE TYPE "public"."user_locale" AS ENUM('pt-BR', 'en');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" "user_locale" DEFAULT 'pt-BR' NOT NULL;