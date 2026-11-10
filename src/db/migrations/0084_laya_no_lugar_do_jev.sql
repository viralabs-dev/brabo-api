-- AT-626 (ADR 0290): o roteador do workspace passa de liga/desliga para jev | laya | desligado.
-- O booleano antigo vira coluna GERADA (mesmo nome), para o DTO e quem o lê.
CREATE TYPE "public"."tool_router" AS ENUM('jev', 'laya', 'desligado');--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "tool_router" "tool_router" DEFAULT 'jev' NOT NULL;--> statement-breakpoint
UPDATE "workspaces" SET "tool_router" = 'desligado' WHERE "tool_router_enabled" = false;--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "tool_router_enabled";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "tool_router_enabled" boolean GENERATED ALWAYS AS (tool_router <> 'desligado') STORED NOT NULL;
