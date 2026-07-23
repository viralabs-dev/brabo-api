FROM node:24-alpine

# git: usado pelo LocalGitProvider (git init --bare) — Alpine não traz o
# binário por padrão.
RUN apk add --no-cache git

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

CMD ["sh", "-c", "pnpm install --frozen-lockfile=false && pnpm db:migrate && pnpm --filter api start:dev"]
