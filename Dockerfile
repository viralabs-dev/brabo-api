# Imagem de PRODUÇÃO da api (Fase 5). O Dockerfile de dev ao lado continua
# existindo e não muda: ele bind-monta o repo e roda `start:dev`.
#
# Contexto de build: a RAIZ do repo (o monorepo pnpm precisa do lockfile e do
# packages/shared). O `.dockerignore` da raiz derruba o contexto de 742 MB para
# ~5 MB — sem ele este build manda node_modules e .pnpm-store pro daemon.
#
# hadolint global ignore=DL3018
# (não usamos apk aqui; o ignore evita ruído no lint do CI)

# ---------------------------------------------------------------------------
# Estágio 1: dependências. Separado do build pra a camada de deps só invalidar
# quando o lockfile/manifests mudarem, não a cada edição de código.
# ---------------------------------------------------------------------------
FROM node:24.11.1-alpine3.21 AS deps

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /repo

# Só os manifests: é o que decide o grafo de dependências.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# `--frozen-lockfile` (sem o `=false` do dev): em produção o lockfile é lei.
RUN pnpm install --frozen-lockfile --filter api...

# ---------------------------------------------------------------------------
# Estágio 2: build. `nest build` faz o typecheck, e o typecheck precisa do
# packages/shared — que é 100% tipos (não exporta nenhum valor em runtime), por
# isso ele NÃO aparece no estágio final.
# ---------------------------------------------------------------------------
FROM deps AS build

COPY apps/api apps/api
COPY packages/shared packages/shared
# O registro de gates viaja com a imagem porque a api o LÊ em runtime
# (`GET /internal/gates`). Só o arquivo — `docs/` inteiro entraria no contexto
# de build sem necessidade.
COPY docs/gates.yml docs/gates.yml

RUN pnpm --filter api build

# Árvore de produção isolada. `pnpm deploy` resolve o link do workspace num
# node_modules autocontido — copiar o node_modules do monorepo traria symlinks
# quebrados pra fora do contexto.
#
# RUN separado do build de propósito: são passos com invalidação de cache
# diferente, e juntar não economiza camada no estágio final — que é descartado.
# hadolint ignore=DL3059
RUN pnpm --filter api --prod --legacy deploy /prod

# ---------------------------------------------------------------------------
# Estágio 3: runtime. Só o compilado, as deps de produção e as migrations.
# ---------------------------------------------------------------------------
FROM node:24.11.1-alpine3.21 AS runtime

# Versão do artefato (ADR 0036). `tracing.ts` já lia `BRABO_VERSION` para o
# `service.version` do recurso OpenTelemetry, e sempre recebia o fallback "dev" —
# nada no repo definia a variável, então TODO span de TODO ambiente dizia "dev" e
# o atributo era inútil justamente para o que ele serve: saber qual build gerou o
# trace.
#
# É ARG e não só ENV para o `release.yml` poder assar a tag na imagem via bake. O
# default mantém "dev" para build local e `docker compose`, que não passam pelo
# workflow de release. Como é ENV, um overlay do Kubernetes ainda pode
# sobrescrever, mas não deveria: a imagem sabe a própria versão.
ARG BRABO_VERSION=dev

ENV NODE_ENV=production \
    BRABO_VERSION=$BRABO_VERSION

# `wget` (do busybox) já existe na imagem base e é o que o HEALTHCHECK usa —
# nada a instalar. Não instalamos git aqui: quem faz operação de git é o
# engine (Engine.Actions.GitExecutor); a api só cria o bare repo via
# LocalGitProvider, que roda `git` — então git É necessário.
#
# `apk upgrade` antes do install: a tag da base é pinada (bom pra
# reprodutibilidade) mas congela também os patches de segurança do Alpine. Sem
# este passo o trivy acusa CVEs de musl/zlib/libxml2 que já têm correção
# publicada, e o scan do CI nasceria vermelho por algo que um comando resolve.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache && apk add --no-cache git

# Remove o npm/npx/corepack que vêm empacotados na imagem oficial do Node.
#
# Não é higiene cosmética: os 24 achados HIGH/CRITICAL que o trivy reportava
# nesta imagem vinham TODOS de /usr/local/lib/node_modules/npm (minimatch, tar,
# glob, sigstore...), nenhum das nossas dependências. O runtime executa
# `node main.js` — gerenciador de pacote aqui é só superfície de ataque e
# ferramenta pronta pra quem conseguir execução no container.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Mesmos mount points do engine, com o MESMO caminho absoluto — a api grava o
# permissions.json em /data/project-workspaces/<project_id>/ e cria o bare repo
# em /data/git-repos, e o path absoluto do bare repo é PERSISTIDO NO BANCO e
# usado literalmente pelo engine. Caminhos diferentes nos dois containers
# quebram o push do dev agent.
#
# Os diretórios precisam existir AQUI, com dono correto: quando um volume
# nomeado é criado vazio, o Docker copia conteúdo e ownership do caminho na
# imagem — se o caminho não existir, o volume nasce root e o processo non-root
# não consegue escrever. `node` é uid 1000, igual ao usuário `engine`.
RUN mkdir -p /data/project-workspaces /data/git-repos \
 && chown -R node:node /data
VOLUME ["/data/project-workspaces", "/data/git-repos"]

WORKDIR /app

# `node` (uid 1000) já vem na imagem oficial — não criamos usuário novo.
COPY --from=build --chown=node:node /prod/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
# Os .sql não passam pelo tsc: são copiados pra o migrator achá-los.
COPY --from=build --chown=node:node /repo/apps/api/src/db/migrations ./db/migrations
# Mesmo motivo, mesmo remédio: o registro de gates é YAML, não passa pelo tsc,
# e `GET /internal/gates` o lê do disco em runtime. Sem esta linha a rota
# responderia erro só em produção — o loader sobe de `__dirname` até achar
# `docs/gates.yml`, e aqui ele acha em `/app/docs/gates.yml`.
COPY --from=build --chown=node:node /repo/docs/gates.yml ./docs/gates.yml

USER node

EXPOSE 3000

# `/health` é público (@Public) e faz `select 1` — valida o processo E o banco,
# não só a porta aberta.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

# `node` direto, sem npm/pnpm no meio: um processo só, PID 1 recebendo SIGTERM
# sem intermediário que engula o sinal.
CMD ["node", "main.js"]
