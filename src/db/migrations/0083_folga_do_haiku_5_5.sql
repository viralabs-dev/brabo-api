-- AT-743 (RN-1007, ADR 0223): folga de raciocinio curada a mao do Haiku 5.5 na Anthropic direta (teto 4096 + 12288 = 16384).
UPDATE "models" SET "reasoning_budget" = 12288 WHERE "provider"::text = 'anthropic' AND "name" = 'claude-haiku-5-5';
