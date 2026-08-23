FROM node:24-alpine

# git: usado pelo LocalGitProvider (git init --bare) — Alpine não traz o
# binário por padrão.
RUN apk add --no-cache git

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

# `--filter api...`: instala só a api e as dependências dela (incluindo
# packages/shared e as deps da raiz), nunca o workspace inteiro — apps/runner
# (node-pty, binding nativo) roda na máquina do usuário e não existe aqui;
# instalá-lo no container faria o postinstall compilar com node-gyp e quebrar
# o boot (Alpine não tem Python/toolchain). Mesmo padrão do Dockerfile.prod.
CMD ["sh", "-c", "pnpm install --frozen-lockfile=false --filter api... && pnpm db:migrate && pnpm --filter api start:dev"]
