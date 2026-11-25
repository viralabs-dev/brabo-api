CREATE TABLE "automacoes_do_projeto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"categoria" text NOT NULL,
	"chave" text NOT NULL,
	"ligada" boolean NOT NULL,
	"origem" text DEFAULT 'manual' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automacoes_do_projeto_project_id_categoria_chave_unique" UNIQUE("project_id","categoria","chave"),
	CONSTRAINT "automacoes_do_projeto_origem_check" CHECK ("automacoes_do_projeto"."origem" in ('padrao', 'oferta', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "automacoes_do_projeto" ADD CONSTRAINT "automacoes_do_projeto_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automacoes_do_projeto" ADD CONSTRAINT "automacoes_do_projeto_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;