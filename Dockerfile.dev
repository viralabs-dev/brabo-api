FROM node:24-alpine

# UID/GID do usuário que roda o container — casam com o dono do bind mount
# no host (ver docker-compose.yml `build.args` e .env.example), pra tudo que
# for escrito em `apps/api/dist`/`node_modules` nascer com o SEU dono, nunca
# root. Default 1000 é o mais comum em máquina Linux de desenvolvedor único
# — e coincide com o usuário `node` que a própria imagem já traz.
ARG DEV_UID=1000
ARG DEV_GID=1000

# git: usado pelo LocalGitProvider (git init --bare) — Alpine não traz o
# binário por padrão.
RUN apk add --no-cache git

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Só cria grupo/usuário quando o UID/GID pedido diverge do que a imagem já
# tem — `node:24-alpine` já vem com o usuário "node" em 1000:1000, o default
# mais comum, e recriar um grupo/usuário nesse UID quebraria o build
# (`addgroup`/`adduser` recusam ID já em uso). USER abaixo referencia o par
# numérico, não o nome — não importa se quem acabou dono dele foi "node" ou
# "devuser".
RUN (getent group "$DEV_GID" >/dev/null 2>&1 || addgroup -g "$DEV_GID" devuser) \
  && (getent passwd "$DEV_UID" >/dev/null 2>&1 || adduser -D -u "$DEV_UID" -G "$(getent group "$DEV_GID" | cut -d: -f1)" devuser)

WORKDIR /workspace

# Os dois volumes NOMEADOS do compose (`/data/git-repos`,
# `/data/project-workspaces`) precisam existir aqui, com o dono certo, ANTES
# do USER: um volume nomeado novo herda dono e conteúdo do caminho que existir
# NA IMAGEM, e quando o caminho não existe ele nasce root — deixando o processo
# non-root de fora. Sem estas duas linhas, `git init --bare` do LocalGitProvider
# morria com "permissão negada: /data/git-repos/<slug>.git" e o
# permissions.json de cada projeto não tinha onde ser escrito.
#
# O Dockerfile.prod (`:104-109`) já fazia exatamente isto, com este mesmo
# comentário, desde que o modo produção existe. A lição estava aprendida e
# nunca tinha atravessado para o desenvolvimento — que é justamente onde
# alguém provisiona um repositório pela primeira vez.
RUN mkdir -p /data/git-repos /data/project-workspaces \
  && chown -R "${DEV_UID}:${DEV_GID}" /data

USER ${DEV_UID}:${DEV_GID}

# `--filter api...`: instala só a api e as dependências dela (incluindo
# packages/shared e as deps da raiz), nunca o workspace inteiro — apps/runner
# (node-pty, binding nativo) roda na máquina do usuário e não existe aqui;
# instalá-lo no container faria o postinstall compilar com node-gyp e quebrar
# o boot (Alpine não tem Python/toolchain). Mesmo padrão do Dockerfile.prod.
CMD ["sh", "-c", "pnpm install --frozen-lockfile=false --filter api... && pnpm db:migrate && pnpm --filter api start:dev"]
