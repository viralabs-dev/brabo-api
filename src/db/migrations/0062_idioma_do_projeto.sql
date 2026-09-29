ALTER TABLE "projects" ADD COLUMN "language" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
-- RN-619: os projetos que já existiam recebem o idioma do TITULAR do workspace
-- (`workspaces.created_by`, a pessoa de quem é a credencial que os agentes
-- gastam — RN-058/RN-616), pela MESMA cadeia de precedência da conta (RN-618):
-- escolha da conta > detectado confirmado > idioma da interface. Nesta
-- migração os dois primeiros ainda são NULL para todo mundo, então o valor
-- efetivo é o `users.locale` do titular — a cadeia está escrita inteira para a
-- migração continuar certa se rodar depois de alguém escolher.
UPDATE "projects" AS p
SET "language" = COALESCE(u."response_language", u."detected_language", u."locale"::text)
FROM "workspaces" AS w
JOIN "users" AS u ON u."id" = w."created_by"
WHERE w."id" = p."workspace_id";
