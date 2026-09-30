-- RN-659 (AT-313): projeto NOVO nasce com promoção de histórias automática.
-- Só o DEFAULT da coluna muda: nenhuma linha é reescrita, então projeto que
-- nasceu `manual` continua `manual` (a troca é por Configurações, RN-048).
ALTER TABLE "projects" ALTER COLUMN "story_promotion" SET DEFAULT 'auto';
