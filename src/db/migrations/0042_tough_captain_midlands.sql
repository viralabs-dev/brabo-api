-- Nome de pasta legível para o workspace do projeto (RN-109).
--
-- Adiciona nullable primeiro: um `ADD COLUMN ... NOT NULL` sem default falha
-- contra `projects` não-vazia. O backfill abaixo grava, para toda linha
-- EXISTENTE, o que já é verdade no disco hoje — a pasta física continua
-- sendo o UUID puro, e este backfill NUNCA renomeia diretório nenhum.
ALTER TABLE "projects" ADD COLUMN "workspace_dir_name" text;--> statement-breakpoint
UPDATE "projects" SET "workspace_dir_name" = "id"::text WHERE "workspace_dir_name" IS NULL;--> statement-breakpoint
-- Rede de segurança, não o caminho principal: quem cria projeto
-- (`CreateProjectUseCase`) sempre grava `<slug>-<8 chars do id>` explicitamente
-- ANTES do insert (ver `workspaceDirNameFor` em
-- infrastructure/filesystem/project-workspaces-root.ts). Este trigger só entra
-- em ação se algum caminho esquecer de gravar o valor — inclusive fixture de
-- teste, que não conhece (nem precisa conhecer) o conceito de nome de pasta —
-- e nesse caso degrada para o MESMO valor que o backfill acima usou: o UUID.
-- Nunca reescreve um valor não-nulo, então não conflita com quem já preencheu.
CREATE OR REPLACE FUNCTION projects_workspace_dir_name_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_dir_name IS NULL THEN
    NEW.workspace_dir_name := NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER projects_workspace_dir_name_default_trg
BEFORE INSERT ON "projects"
FOR EACH ROW
EXECUTE FUNCTION projects_workspace_dir_name_default();--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "workspace_dir_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_dir_name_unique" UNIQUE("workspace_dir_name");
