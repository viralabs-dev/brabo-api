-- AT-606 (ADR 0225): fator do teto de preço que foi ao fio, congelado na linha do metering.
ALTER TABLE "token_usage" ADD COLUMN "price_ceiling_factor" real;
