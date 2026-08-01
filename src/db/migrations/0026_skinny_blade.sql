ALTER TABLE "models" ADD COLUMN "supports_tool_calling" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "supports_streaming" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "supports_vision" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill DIRIGIDO das linhas que o seed cria (Fase 9a — ADR 0040). Os sete
-- modelos abaixo têm tool calling nativo verificado, e sem isto o default
-- `false` bloquearia o rebind de agente na UI e a demo de gates, que roda no
-- qwen2.5-coder:7b. Um UPDATE cego em toda a tabela seria mais simples e
-- mentiria sobre qualquer modelo que o operador tenha inserido por SQL.
UPDATE "models" SET "supports_tool_calling" = true
WHERE ("provider", "name") IN (
  ('ollama',    'llama3.2:1b'),
  ('ollama',    'qwen2.5-coder:7b'),
  ('anthropic', 'claude-opus-4-8'),
  ('anthropic', 'claude-sonnet-5'),
  ('anthropic', 'claude-haiku-4-5-20251001'),
  ('openai',    'gpt-4o'),
  ('openai',    'gpt-4o-mini')
);