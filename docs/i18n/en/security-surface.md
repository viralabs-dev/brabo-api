---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# Api's Exposed Surface

Every registered route, with its authentication classification and the
justification for the ones left open. Decisions in
[ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **This document is the source of truth for a test**, not a copy of one.
> `apps/api/test/interfaces/route-surface.spec.ts` boots the application,
> enumerates the routes **registered at runtime**, and compares them
> against the table below. A new route with no row here **fails the
> test**; a row whose classification differs from the real annotation
> **fails the test**; an orphan row (matching no route at all) **fails
> the test**. The documentation can't go stale in silence.

## Classifications

| value | what it means |
|---|---|
| `public` | `@Public()` — no token. Each one justified below |
| `engine-service` | `EngineServiceGuard`: `X-Brabo-Service-Token` matching the shared secret. This is the internal api↔engine surface, outside the JWT |
| `role:<role>` | authenticated and restricted by the domain's RBAC (`@RequireRole`) |
| `jwt` | authenticated, no role required on the route — the scope comes from the resource itself |

## The fifteen public routes

There were four until Phase 6. Phase 7a added eight at once — first-party
auth — ADR 0084 added two more, social login, and the runner device-key
onda added the binary proxy. Each one is justified below. Opening any more
still requires touching the assertion in `route-surface.spec.ts`, which
lists the public ones literally to force the conversation.

### Infrastructure

**`GET /live`** — liveness. Doesn't touch the database on purpose:
responds as long as the process is alive. Requiring a token here would
make kubelet restart the pod at the first hiccup in the auth path,
turning a degradation into a full outage.

**`GET /health`** — readiness, with `select 1`. Same reasoning: kubelet
is the caller, and it carries no token. Reveals only whether the
database responds.

**`GET /metrics`** — Prometheus scrape, which also carries no token at
all. Exposure controlled by NETWORK, not by auth: the NetworkPolicy only
opens it to the `monitoring` namespace, and the production Ingress
blocks the path. Without `@Public()` the target would show as `down`
while everything else stays green.

**`GET /git/oauth/:provider/callback`** — the GitHub/GitLab OAuth
return. The user's browser lands here coming from the provider, with no
api session. It isn't unrestricted, though: the `state` parameter is
validated by HMAC (`GIT_OAUTH_STATE_SECRET`), and without a valid
`state` the call is refused.

That guarantee is worth exactly as much as the key, which is why it
stopped having a default: in production the api **refuses to boot** with
the repository's example key, which is public (ADR 0059,
[RN-093](business-rules/api.md#rn-093)). With a known key, this route goes
back to being unrestricted in practice — anyone can sign a `state` for
whichever project they want.

**`GET /runner-releases/binary`** — proxies the runner's standalone
binary from GitHub Releases so the browser never talks to GitHub
directly. Public for the same reason as `/metrics`/JWKS: the binary
itself is not a secret, and requiring a session to download the very
tool that lets someone authenticate would be backwards. `platform` is a
closed allowlist (`linux-x64`/`linux-arm64`/`darwin-arm64` —
the three targets the release matrix builds; `darwin-x64` left in
[ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) and `win32-x64` in
[ADR 0187](adr/0187-runner-sem-binario-win32-x64.md), and both are refused with
their own message pointing at the npm package), never interpolated raw into the GitHub URL — closing the
SSRF/path-injection vector an open parameter would leave. The resolved
asset URL (never the binary's bytes) is cached in memory for a few
minutes, purely to stay under GitHub's unauthenticated rate limit under
concurrent downloads; since session 3 of FASE 29 the parsed
`checksums.txt` — a few hundred bytes of *text* — is memoised in that
same entry, so hash and binary always come from the same release.

Since [RN-525](business-rules/produto.md#rn-525) ([ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md))
the route no longer streams unverified bytes: it checks the sha256 of
what it downloaded against the release's `checksums.txt` and answers
**502 with a named `motivo`** when it cannot — including when the
release publishes no manifest at all, which is a *refusal*, never bytes
served with a warning. Read the guarantee narrowly: this is **integrity
against the manifest, not provenance**. The route does **not** verify
the manifest's `cosign` signature (`checksums.txt.bundle`), so anyone
who can rewrite the Release rewrites both files and passes. Both ways to
close it were measured and refused for now — `cosign` in the image is
155 MB, and `@sigstore/verify` would make a `@Public()` route depend on
a second third-party host (`tuf-repo-cdn.sigstore.dev`) to check
something no Release carries yet. The consumer that *does* verify the
signature is `install.sh`. Because verifying the hash means reading
every byte, the download lands in a temporary file under `/tmp` (the
pod's `emptyDir`, mounted because the rootfs is read-only) with a
256 MiB ceiling, and is streamed back only after the hash matches —
never buffered in the 512Mi process.

### First-party auth

The seven `/auth/*` routes plus JWKS. **All of them need to be public for
the same structural reason:** they're the path through which an access
token is OBTAINED, and the global `JwtAuthGuard` requires one. An auth
route behind the guard would ask for the credential it itself issues.
`logout` is the only one that could be authenticated, and isn't, on
purpose: it already carries the credential it cares about — the refresh
in the cookie, with its CSRF pair — and logging out needs to work even
with an expired access token.

> **What protects these routes isn't the rate limit.** `RateLimitGuard`
> exempts `@Public()` routes — on purpose, so as not to strangle
> `/health` until kubelet restarts the pod. What holds this surface is
> **progressive lockout** by email and by IP, inside the use cases. It's
> not an optional reinforcement: it's the only defense that exists here.
> See
> [RN-030](business-rules/api.md#rn-030) and [RN-031](business-rules/api.md#rn-031).

**`POST /auth/register`** — sign-up. Responds `202` for both a new
address and one already registered; in the second case nothing is
created and the address's owner gets a notice. A `409 Conflict`, which is
what good REST sense would ask for, would hand the user list to anyone
with a wordlist.

**`POST /auth/login`** — authentication. A nonexistent email, a wrong
password, and a locked account all return the **same** 401 response, and
take the **same** time (the no-account branch checks against a dummy
hash with identical parameters).

**`POST /auth/refresh`** — rotation. The refresh token itself is the
credential, so the route can't require another one.

**`POST /auth/logout`** — revokes the presented token's family. Always
`204`, even for an unknown token: answering 401 here would be a
token-validity oracle.

**`POST /auth/verify-email`**, **`POST /auth/request-password-reset`**,
**`POST /auth/reset-password`** — account flows. Whoever reaches them has
no session yet, by definition. The credential is the single-use token
that came by email; an invalid, expired, or already-used link all get an
identical response.

**`GET /.well-known/jwks.json`** — the **public** half of the Ed25519
pair that signs access tokens. Same reasoning as `/metrics`: the
consumer has no token, and requiring one would mean asking for a
credential in order to validate a credential. Publishing the public key
is the format's whole purpose — what can never leave here is the JWK's
`d` component, locked down by a test.

### Social login (ADR 0084)

**`GET /auth/oauth/:provider/start`** — redirects straight to the
provider (GitHub/GitLab). Public for the same structural reason as the
other seven: it's the entry point itself, before any session exists. The
`state` it generates is HMAC-signed with its OWN purpose
(`signSocialOauthState`/[RN-273](business-rules/api.md#rn-273)) — never the
same `state` as `GET /git/oauth/:provider/callback` above, even though
both routes sign with the SAME `GIT_OAUTH_STATE_SECRET` key. The
`purpose` field in the payload is what keeps a `state` from one flow
being accepted by the other's verifier.

**`GET /auth/oauth/:provider/callback`** — receives the provider's
return. Same reasoning as the git-connection callback: the browser
arrives with no session, `state` is HMAC-verified, and the route never
returns JSON — it always redirects, to `WEB_ORIGIN/` on success (with
the session cookies already written) and to
`WEB_ORIGIN/login?oauth_error=1` on failure, without detailing the
reason in the URL.

## Notes

- **`POST /workspaces/:workspaceId/projects` decides where the agent will
  write, and that's why it's a security-surface route, not just a
  registration one**
  ([ADR 0072](adr/0072-projeto-local-ou-container.md)/
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
  [RN-169](business-rules/api.md#rn-169)/[RN-421](business-rules/api.md#rn-421)/
  [RN-422](business-rules/api.md#rn-422)). The body gained `executionMode`
  (`container` — the default and the always-been behavior —, `mounted`, the
  old `local`, renamed, or `runner`) and `workspacePath`. In `mounted`/
  `runner` the absolute path supplied becomes the **terminal scope root**
  of ADR 0055: what's typed here is what the agent can read and write. No
  new route, and no role change (`RequireRole('maintainer')`, as it already
  was) — what changed is the reach of what the route grants.

  Since [ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md)
  ([RN-501](business-rules/api.md#rn-501)) the TWO modes that aren't
  `container` validate the SAME thing at creation time: only the LEXICAL
  form — absolute, no `..`, never root or a system folder, never
  overlapping the Brabo checkout in either direction (RN-422/RN-423) — with
  no disk I/O at all. `mounted` adds one rule of its own: the path must sit
  inside `BRABO_PROJECTS_BASE`, the only folder of the machine both
  containers can see (ADR 0141), and with no base configured the refusal
  says the MODE is unavailable on this installation rather than blaming the
  path.

  **The security-relevant part of that change is what did NOT move.** The
  path supplied is still the terminal scope root, and the lexical predicate
  is still what contains it — it runs on every derivation of the root, on
  READS too, because writing straight to the database is the only way to
  bypass creation. What was deferred is the DISK check (does it exist? is
  it a directory? can this process write to it?), which never contained
  anything: it answered "will this work", not "is this allowed". It now
  runs in `materializarWorkspaceMontado`, when Infra starts the container
  (and, as a declared exception, on mode conversion), and the base rule is
  re-applied there BEFORE the `mkdir -p` — so a path written outside the
  product can't make the api create a folder anywhere it reaches.

  The base rule deliberately stays OUT of the lexical predicate: that one
  runs on every read, and a LEGACY `mounted` project outside the base would
  start failing when merely read. `runner` continues to be confirmed by the
  runner itself, the only party with authority over the real host (RN-423,
  see `POST /internal/projects/:projectId/workspace-verification` below);
  `mounted` is now confirmed by the materialization, which stamps
  `workspace_verified_at` the same way. The mode is **frozen** afterward:
  `UpdateProjectDto` deliberately omits both fields, otherwise
  `PartialType(CreateProjectDto)` would expose them on a `PATCH` with no
  guard at all.
- **`GET /workspaces/:workspaceId/containers` now lists EVERY project of the
  workspace, and the page it feeds became the human path to START a container**
  ([RN-521](business-rules/api.md#rn-521),
  [ADR 0136](adr/0136-pagina-global-de-containers.md)). The role did not change
  (`viewer`, as it already was) and neither did the scope: it still answers only
  for projects of the workspace the caller can see. What changed is the row set
  — a project that never provisioned a container used to be ABSENT and now
  appears with `registrado: null`, a THIRD state that is neither `stopped` nor
  "could not be observed". The read is still bounded the same way: three batched
  queries regardless of project count, and at most
  `TETO_DE_VERIFICACOES_POR_CARGA` (20) broker calls per load, with rows that
  have no container never eligible and therefore never able to crowd out a real
  one.

  **Nothing on this page acts directly.** Stopping, removing and starting are
  all `proposed_action`, always with a HUMAN clicking, never an agent, and every
  ceiling in `decide.ts` is untouched: both start types require `maintainer`,
  and `container_remove` stays in the absolute ceiling of the privileged-command
  family ([RN-418](business-rules/api.md#rn-418)) — never auto-approvable, "always
  allow" refused at the source. The screen branches the start action by
  `execution_mode` exactly as the backend does
  ([RN-497](business-rules/produto.md#rn-497)/[RN-503](business-rules/api.md#rn-503)):
  `container`/`mounted` propose `container_start` (broker) and `runner` proposes
  `container_start_via_runner` (local agent), with the payload each schema
  actually accepts.

  The screen's own refusals are honesty, not enforcement: it does not offer the
  button with no image decided (the RN-105 gate, valid in all THREE modes since
  [RN-494](business-rules/broker.md#rn-494)), nor for a `runner` project whose folder no
  local agent ever confirmed, nor to a role below `maintainer` — and it says
  which of the three it is, in text. **Who refuses for real is still the
  `RolesGuard` and the use cases.** The role read here is the WORKSPACE one, not
  the effective project role (`projectRole ?? workspaceRole`,
  [RN-471](business-rules/web.md#rn-471)): a member demoted inside one project still
  sees the button and gets a 403, a declared cost of not paying an N+1 of
  `project_members` on a cross-project page.
- **`PUT /projects/:projectId/mirror-path` writes a path on the USER's
  machine, and the api never sees that machine** ([RN-515](business-rules/api.md#rn-515),
  [ADR 0147](adr/0147-agente-local-com-capacidades.md), point 4). It stores
  the destination the `espelho` capability copies the project's work to — a
  folder OUTSIDE the mounted base, which is precisely why a bind mount cannot
  reach it and a local agent has to.

  The minimum is `maintainer`, the same as `execution-mode` and
  `projects-base` above, and for the same reason: this route is about a path
  on the operator's own filesystem, not about project metadata.

  What the api can validate here is ONLY the LEXICAL shape, and the refusal
  message says so. It reuses `caminhoDeWorkspaceLocalValido` — absolute, no
  `..`/`.`, never the root, never a system folder, never overlapping Brabo's
  own checkout — exactly as `runner` creation does ([RN-423](business-rules/runner.md#rn-423)),
  and for the same reason: there is no disk here to ask. It does NOT require
  `BRABO_PROJECTS_BASE`, because being outside the base is the point.

  Two refusals are specific to this route. The destination may not be inside
  `workspacePath` nor contain it — the same loop seen from both sides, since
  writing the mirror inside its own source makes the mirror copy itself — and
  the comparison is by SEGMENT (`dentroDoEscopo`), so `/base-outra` is not
  inside `/base`. And a project in `execution_mode: container` may not have a
  destination at all: its source is a managed volume ON THE SERVER, and the
  process that would copy runs on the USER's machine, which cannot see it.
  Both are **400**.

  The other half of the guard — resolving symlinks with `realpath`, so a link
  in any segment of the destination cannot point back into the source — is the
  RUNNER's, on the machine where both paths actually exist. **This route does
  not establish that guarantee**; it only rules out the loop as WRITTEN.
  Clearing is `mirrorPath: null`, and the key is required: omitting it would
  be indistinguishable from asking to clear, and clearing in silence is the
  defect. Writing the mirror is never a `proposed_action` — it is
  configuration the user declared, not an agent asking to act.
- **`GET /projects/:projectId/mirror-state` is `viewer`, one notch below the
  route that WRITES the destination** ([RN-517](business-rules/api.md#rn-517),
  [ADR 0147](adr/0147-agente-local-com-capacidades.md), point 7). It returns
  what the last mirror round did: which of the three states is current
  (`never` | `synced` | `failed`), the last successful sync with its counts,
  the frozen destination of that round, and the last error.

  The asymmetry with `PUT .../mirror-path` (`maintainer`) is deliberate and
  is the rule of [RN-102](business-rules/api.md#rn-102) applied: the minimum
  belongs to the ENDPOINT, and this one only READS. The destination itself
  already rides on every project read (`GET /projects/:projectId`,
  `viewer`), so requiring `maintainer` here would lock information away from
  someone who already sees it in the same project — the worse of the two
  defects, because it is invisible to whoever lost the capability.

  What it does NOT expose is worth stating: no file names, no content, no
  path other than the destination the caller can already read. The counts
  are counts.
- **`GET /workspaces/:workspaceId/projects-base` reveals a piece of the
  operator's filesystem topology, and that's why it isn't `viewer`**
  ([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md),
  [RN-500](business-rules/api.md#rn-500)). It returns
  `{ projectsBase: string | null }` — the single host folder mounted by
  identity into the `api` and `engine` containers, under which every
  `mounted` project lives. `null` is the normal state of an installation
  that doesn't offer Mounted mode, and it's how the project wizard learns
  not to offer a mode this installation can't honor.

  The minimum is `maintainer`: the **same** as `POST
  /workspaces/:workspaceId/projects` above, because deciding what that
  route offers is the only thing this value is for. Inheriting `viewer`
  from the neighboring `projects-*` reads — they sit next to each other in
  the same controller — would hand an absolute host path to everyone who
  can look at the workspace, for no capability in return. `workspaceId`
  doesn't enter the computation: the base is **installation**
  configuration, identical for every workspace, and the parameter is there
  only to give the `RolesGuard` a scope.

  Since [ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)
  ([RN-573](business-rules/api.md#rn-573)) the response also carries
  `brokerConfigurado: boolean` — whether `BROKER_URL` is set, read through
  `ContainerBrokerPort.configurado()`. It discloses one bit of installation
  topology (is there a Docker-socket-holding broker at all), never its
  address, and the minimum stays `maintainer`. The same bit rides on every
  row of `GET /workspaces/:workspaceId/containers` (`viewer`,
  [RN-574](business-rules/api.md#rn-574)), a deliberate widening: that page must
  say BEFORE the click that `container`/`mounted` cannot start here, and
  anyone who can see the page could already infer the absence from
  `naoObservado: broker-nao-configurado` whenever a row is
  `provisioning`/`running`. It says the
  variable exists, never that the broker answers.
- **`GET /workspaces/:workspaceId/project-folders` serves directory
  listings from a client-supplied path, and its whole safety is ONE
  containment** ([RN-504](business-rules/web.md#rn-504),
  [ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)). It exists
  because the project wizard lost both of its "browse for a folder"
  mechanisms at once: `FolderBrowserModal` used to navigate through the
  RUNNER's websocket, and `RunnerOnboardingPanel` used
  `showDirectoryPicker`, which hands back a browser handle and never an
  absolute path. With the runner leaving project creation, the browser has
  no way to list a filesystem — so the api lists it, and the api only sees
  one folder: the mounted-projects base.

  The containment is that base and nothing else. `path` is optional and
  defaults to `BRABO_PROJECTS_BASE`; every supplied `path` must satisfy
  `dentroDaBaseDeProjetos` — the same `dentroDoEscopo` the ADR 0055
  terminal scope uses, so `/home/you/brabo2` is NOT inside `/home/you/brabo`
  even though the string starts the same. Leaving the base is a **400**, not
  a 403: 403 would suggest some other role would see it, and none does. The
  request is malformed, not under-authorized. `..` and `.` are refused
  outright rather than resolved, for the same reason the creation predicate
  refuses them — resolving accepts that the path read is not the path asked
  for.

  The caps are part of the contract, not an implementation detail:
  directories only, at most 500 of them (sorted BEFORE the cut), never
  recursive, dot-prefixed entries excluded, and symlinks reported but never
  descended into — so a link pointing outside the base is not a way out of
  it. What is excluded is COUNTED (`arquivos`, `simbolicos`, `truncado`), so
  a folder full of code never comes back looking empty
  ([RN-180](business-rules/web.md#rn-180)). There is no POST companion:
  creating a folder belongs to materializing the mounted workspace, never to
  the picker.

  The minimum is `maintainer`, the same as `POST
  /workspaces/:workspaceId/projects` and `projects-base` above, and for the
  same reason one step further: `projects-base` reveals ONE path on the
  operator's machine, this route reveals the TOPOLOGY under it. Whoever
  can't create a project has nothing to do with the list of folders a
  project could be created in.
- **`GET /`** is the NestJS scaffold's "Hello World!"
  (`src/app.controller.ts`). It's behind the guard and leaks nothing, but
  serves no purpose — a removal candidate. It stayed recorded here instead
  of being removed, since that's a product decision, out of scope for this
  session.
- **`GET /internal/projects/:projectId/git-remote` is the only route in the
  product that returns a DECRYPTED secret** — the workspace owner's git
  token ([ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
  It exists because the engine works on the filesystem and doesn't hold the
  master key; replicating it in the engine would double the blast radius of
  the product's most sensitive secret. Two properties keep it defensible:
  the `origin` it returns is **clean** (the credential comes in a separate
  field, never embedded in the URL), and the consumer is obligated to
  inject it per invocation, never to a file — see `Engine.Actions.GitAuth`
  and the reasoning for that in [RN-076](business-rules/engine.md#rn-076). If this
  route ever starts returning the already-authenticated URL, the token
  would end up in `.git/config`, inside the folder where the dev agent has
  auto-approved reads.

  In `runner` mode that per-invocation injection travels one more hop — the
  `env` field of the `exec` message ([RN-507](business-rules/runner.md#rn-507)) — and
  it stops at the container boundary: the product's Docker port has **no `env`
  field**, deliberately ([ADR 0130](adr/0130-broker-de-container.md)), so a
  command routed into the container by `docker exec` can never carry the token.
  That containment held; what did not was the reporting. Until
  [RN-558](business-rules/runner.md#rn-558) the runner ran such a command **anyway**,
  with the credential helper installed and the variables empty, and the
  resulting authentication failure was indistinguishable from a bad token or a
  broken network — on the *common* path, since the registered `running`
  container that RN-507 demands exists only because that same runner brought it
  up. The runner now **refuses** the pair (credential present, container
  active) before executing anything, and the engine classifies the refusal with
  origin `politica` rather than `codigo`. The refusal text names neither the
  variables nor their values, only how many there were. The credential still
  does not cross the container boundary, and since
  [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
  ([RN-676](business-rules/runner.md#rn-676)) it does not need to: the engine marks
  the authenticated `fetch` (`gitCredenciado: true`, set from one place,
  `RunnerRouter.exec_git_credenciado/5`) and the runner runs THAT command on
  the host, where the `env` reaches the child process; the dev agent's
  commands still go to `docker exec`. The trust boundary is the mark, not the
  `env`: a command carrying `env` WITHOUT the mark is still refused while a
  container is active, so the credential field never becomes a way out of the
  container. No ADR 0130 port changed.
- **The PO's three read routes** — `GET /internal/projects/:projectId/business-rules`,
  `GET /internal/projects/:projectId/backlog` ([RN-164](business-rules/engine.md#rn-164))
  and `GET /internal/projects/:projectId/product-metrics` ([RN-407](business-rules/contracts.md#rn-407)) —
  return no secret at all and **accept nothing beyond the project id**: no
  search term, no pagination, no filter. That's on purpose. A read route for
  an agent is a surface the model chooses to call, and a parameter is where
  the model writes whatever it wants; here there's nowhere to write. The
  scope is closed to the project by the path, and the cost per call is
  constant (three reads in the backlog, two in the rules, one query against
  `proposed_actions` filtered by index in the product metrics).
- **The dev agent's contract read** — `GET /internal/projects/:projectId/module-contracts`
  ([RN-684](business-rules/api.md#rn-684), [ADR 0200](adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md))
  — follows the same rule: no secret, nothing beyond the project id, one
  entry per module of the current `module_map`. Its writing twin,
  `POST /internal/sessions/:sessionId/module-contracts`, takes only the
  Architect's declaration (what each module exposes) and validates every name
  against the current `module_map`; neither route touches a worktree.
- **`POST /internal/projects/:projectId/workspace-verification`** (RN-423,
  ADR 0104) is called only by the engine, after a runner connects and sends
  `workspace_confirm` over the channel — never directly by the runner,
  which doesn't hold the service token. The runner is the SOURCE OF TRUTH
  for the path (it OVERWRITES `workspacePath`, without requiring it to
  match what was typed at creation), but the reported path still goes
  through the SAME lexical check as creation
  (`caminhoDeWorkspaceLocalValido`) — system root and overlap with the
  Brabo checkout remain forbidden even coming from the runner. `400` if the
  project isn't in `runner` mode.

  Since [ADR 0151](adr/0151-base-consentida-no-runner.md)
  ([RN-529](business-rules/runner.md#rn-529)) the runner can ALSO be born with a
  **base** — one folder of that machine under which each project is a
  subfolder. Two things about it belong on this page. First, the base is
  **local and never arrives over the wire**: it comes from `--base` or from
  `$XDG_CONFIG_HOME/brabo/runner.json`, never from a server field, so the
  invariant of [ADR 0130](adr/0130-broker-de-container.md)/
  [ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) holds on this side too —
  whoever owns the root is whoever executes, and only the **relative
  segment** travels. `resolverPastaDoProjetoNaBase` refuses an ABSOLUTE
  segment lexically rather than reinterpreting it. Second, the base does
  **not** enter the validation of `--dir`, exactly as the base rule stays out
  of the api's lexical predicate: a project whose folder predates the base
  keeps working. The guard is a THIRD sibling of `guard.ts`, reusing
  `dentroDoEscopo`/`realpathMaisProximo`/`semBarraFinal` and the same
  lexical-then-`realpath` double pass — and it inherits the same TOCTOU
  caveat in writing: best-effort, never the security boundary.

  Since [RN-532](business-rules/runner.md#rn-532) (same ADR, points 3 to 6) that
  base has a CONSUMER: the `workspace_create`/`workspace_create_result`
  pair. Three things about it belong on this page. First, **no new write
  route was born**: having created the folder, the runner pushes the
  `workspace_confirm` that already existed, and it is that one — through
  this very endpoint — that stamps `workspace_verified_at`. The engine
  still does not write the table, and the single path that stamps stays
  single. Second, what travels is the **relative segment**, never an
  absolute path, and the runner refuses an absolute one lexically. Third,
  the capability `workspace` is the only one of the four whose declaration
  depends on the runner's STATE rather than its version — it is declared
  only when a base was consented — so it is by that declaration, and by
  nothing else, that the server learns a base exists. Nobody REQUIRES it at
  join time: a runner without a base connects and serves its project as
  always, and only `workspace_create` is refused, with a NAMED answer.
  Creating that folder is consented configuration, not an agent asking to
  act: it is **not** a `proposed_action`, and no ceiling in `decide.ts`
  gains an exception.
- **`POST /internal/projects/:projectId/container-exec`** ([RN-492](business-rules/engine.md#rn-492),
  [ADR 0134](adr/0134-dev-agents-executam-dentro-do-container.md)) is called
  only by the engine, when `Engine.Actions.TerminalExecutor` decided a
  terminal command belongs inside the project's real container. It proxies
  to `ContainerBrokerPort.exec` — the api never runs the command itself.
  Unlike `container-spec` below, this is the ENGINE calling the api, not
  the broker; the response body never throws for a broker refusal or an
  unreachable one (`{ sucesso: false, motivo }` is the normal shape, per
  RN-486 — a `running` row never guarantees the container is up right
  now), so a dead container is a regular failed command, not a 5xx.
- **`POST /internal/projects/:projectId/mirror-sync-result`** ([RN-517](business-rules/api.md#rn-517),
  [ADR 0147](adr/0147-agente-local-com-capacidades.md), point 7) is called
  only by the engine, after the runner pushes `mirror_sync_result` over the
  channel — never directly by the runner, which doesn't hold the service
  token. The same shape and the same path as `workspace-verification` above,
  and for the same reason: the runner is the only party that knows what
  happened on the user's machine, and the engine repasses rather than writing
  the table itself.

  It writes TELEMETRY and nothing else: a row in `project_mirror_states`,
  never the event log (a mirror round has no session and
  `session_events.session_id` is `NOT NULL`) and never a `proposed_action`.
  The body carries an outcome, three counts and an error message — no path
  the api acts on, nothing executed, nothing granted. Recording never breaks
  what it measures: the copy is already finished when this is called, and a
  refusal here is only logged by the engine.
- **`GET /internal/projects/:projectId/container-spec`** ([ADR 0130](adr/0130-broker-de-container.md),
  [RN-485](business-rules/produto.md#rn-485)) is the only `engine-service` route whose
  caller is NOT the engine — it is the container **broker**, the single process
  in the product with access to a Docker daemon. The classification names the
  MECHANISM (`BRABO_SERVICE_TOKEN` in its own header, compared in constant
  time), not the sender, and the secret is deliberately the same one: the three
  services run in the same cluster and read the same Secret, so a second secret
  would give the impression of compartmentalising without compartmentalising
  anything (the full reasoning is in `service-token.ts`). What makes the route
  worth its existence is the direction of the call: the broker does not RECEIVE
  a container spec, it comes here to READ project identity, execution mode and
  the Architect's current image decision, and composes the spec itself. A spec
  travelling in a request body would make the containment of a root-equivalent
  process depend on its caller being correct. It returns **no absolute path at
  all** — the bind source is resolved by the daemon against the HOST
  filesystem, so a path from inside the api container would silently mount an
  empty folder. What travels instead is `localizacao`
  ([RN-503](business-rules/api.md#rn-503),
  [ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)): a discriminated locator
  saying which of the broker's TWO roots resolves the folder (`gerenciada` →
  `PROJECT_WORKSPACES_HOST_ROOT`, `montada` → `BRABO_PROJECTS_HOST_BASE`, or
  `indisponivel` with a reason) plus the RELATIVE segment that root does not
  cover. The api never learns where those roots are on the host, and the broker
  never learns anything about the project — neither side alone can write an
  arbitrary path, which is the containment. The broker refuses `start` naming
  whichever root is missing, never falling back to the other, and revalidates
  the segment (`..`, absolute, empty, `NUL` all refused) plus the concatenated
  result before it becomes a `-v`. It also drops `rationale`, which exists so a
  human can review the decision and has no consumer in a `docker run`.
- **`GET /internal/projects/:projectId/container-spec` gained
  `usuarioDaPasta`, and the classification didn't change** — still
  `engine-service`, still called only by the broker ([ADR 0180](adr/0180-container-com-o-dono-da-pasta.md),
  [RN-627](business-rules/contracts.md#rn-627)). The field is the `{ uid, gid }` of the
  project folder as the api `stat`s it, or `null` (runner mode, unreachable
  folder, root-owned folder). The broker re-validates it (integers in
  1..2^31-1; `0` is refused by name) and uses it as `--user`; it never reads a
  user from a request body, so there is still no field in which a caller writes
  `privileged`, `cap_add` or a mount. It runs the container with LESS power than
  before (non-root instead of root), `--cap-drop ALL` intact.
- **`POST /projects/:projectId/runner-ticket` is classified `role:developer`
  like any other route, but does NOT accept a session JWT** (ADR 0105,
  RN-424) — only a Personal Access Token (`brb_…`) OR a runner device key
  (Ed25519, see below). The automatic classification
  (`route-surface.spec.ts`) doesn't distinguish the mechanisms, because
  the role REQUIREMENT is the same; what changes is only how
  `request.user` gets established. `PatAuthGuard` runs in place of
  `JwtAuthGuard` on this route (`@RequirePatAuth()`, the same structural
  pattern as `@ServiceRoute()`/`EngineServiceGuard` — bypass by metadata,
  never an `if` a new route could forget), and it's the ONLY place in the
  api that accepts either of these credential formats: on any other route
  a `brb_...` fails JWT verification normally, and a device-key JWT fails
  it too (its `kid` never resolves against the session-token issuer's own
  keys). The five routes under `/projects/:projectId/personal-access-tokens`
  (issue/list/revoke the PAT itself, plus the two `maintainer` ones —
  RN-427, list/revoke of ANY user in the project) remain regular session
  JWT — only the route the TOKEN ITSELF authenticates changes mechanism.
- **`GET /runner/projects` is classified `jwt` and accepts NO session JWT at
  all** ([RN-543](business-rules/produto.md#rn-543),
  [ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)). It is the route by
  which a MACHINE agent discovers the projects it serves, and it is the first
  `@RequirePatAuth()` route with no `:projectId` in the path — which is exactly
  what it exists to solve: the caller does not yet know which projects there
  are. Two consequences, both pinned by tests:
  - **Only a MACHINE credential gets in** (`runner_device_keys.project_id`
    NULL). A credential bound to a project — a PAT, or a device key from the
    ADR 0118 flow — describes one project and has nothing to discover;
    `PatAuthGuard` refuses it with 403 and a message of its OWN, never the
    "wrong project" one, which would lie about the reason. The comparison that
    refuses key-of-A-on-B was NOT removed: it disappears only for `null`, and
    both directions are pinned.
  - **There is no `@RequireRole`, because there is no project to resolve one
    against.** The `developer` minimum — the SAME as `runner-ticket` — is
    applied PER ROW inside `ListRunnerProjectsUseCase`, with the product's
    single ruler (`ResolveEffectiveRoleUseCase.forProject`). Nothing is
    loosened: what comes out is exactly the set of projects for which
    `runner-ticket` would already authorize this user. The automatic
    classifier reads `@RequireRole` and sees no mechanism, so it lands on
    `jwt` — the same approximation this document already corrects in prose for
    `runner-ticket` above. The route never touches a session JWT:
    `JwtAuthGuard` abstains on `@RequirePatAuth()` routes, and the public key
    `PatAuthGuard` verifies comes from `runner_device_keys`, never from the
    session issuer.

  It returns the project id, name, `workspaceDirName` and the verification
  state — never an absolute path. What crosses the wire is the SEGMENT, and
  the root belongs to whoever executes, the same invariant as the broker
  (ADR 0144) and the runner base (ADR 0151).

  Since [RN-544](business-rules/runner.md#rn-544) the route has its CONSUMER: run
  without `--project`, `brabo-runner` calls it at start and opens **one
  connection per project listed** — and, since
  [RN-550](business-rules/runner.md#rn-550), when that list comes back **empty** it
  keeps calling, on a declared cadence (15s, 30s, then 60s repeating), until
  the first project shows up. That polling is bounded on the failure side, not
  on the waiting side: ten consecutive failed calls and the process exits 1
  naming the count, any answer (empty included) resets the counter, and the
  moment one connection is live the polling **stops** — with a live connection
  the list is still read only at start, for the reason below. Each connection
  is rooted at
  `<base>/<workspaceDirName>` through the same guards
  (`resolverPastaDoProjetoNaBase`, then RN-434/RN-435). Three things about
  that belong on this page. First, **nothing on the engine changed**: the
  `terminal:<projectId>` topic, the socket id and the ticket describe a
  CONNECTION, and N connections satisfy them byte for byte — the refusal of a
  second runner on the same project is untouched, and so are the mirror
  ([RN-516](business-rules/runner.md#rn-516)) and `workspace_create`
  ([RN-532](business-rules/runner.md#rn-532)), both of which already travelled in
  the grant of THAT connection's join. Second, the discovery JWT carries **no
  `projectId` claim** — the guard compares `payload.projectId !==
  request.params.projectId`, and on a route with no project in the path both
  must be `undefined`; signing an invented project id there would be refused
  with a 403 that says the wrong thing. Third, **the runner never guesses the
  species of its own key**: on disk a machine key and a project key are the
  same file (a private JWK with a `kid`), the server is the one that knows,
  and the named 403 is relayed with its own message and its own fix
  (`--project`) instead of being flattened into a generic connection failure.
  The new mode requires BOTH a machine credential and a **consented base** —
  without a base there is nowhere to derive each project's folder from, and
  inventing one would write a path on the user's disk they never consented
  to; without both, running with no `--project` still prints usage.
- **A client of the `/runner` socket must NEVER let `phoenix.js` reconnect on
  its own** ([RN-108](business-rules/web.md#rn-108)). The ticket is
  single-use, and the built-in auto-reconnect repeats the SAME `params` — so a
  socket built without `reconnectAfterMs` retries a dead ticket forever. This
  is not hypothetical: `apps/runner/src/channel.ts` shipped that way while its
  own docblock claimed the opposite, and it was measured in real use — the same
  ticket refused every ~5.13s (the ceiling of the library's internal backoff),
  61 `REFUSED CONNECTION TO EngineWeb.RunnerSocket` in a few hours, and, on top
  of the runner's OWN retry policy, 530 requests in one minute against the
  300 req/min `RATE_LIMIT_USER` ceiling. The limit is **per user**, so the
  denial of service landed on the account owner's BROWSER, as a 429 — an
  unauthenticated third party is not involved, but a misbuilt client is enough
  to lock its own user out. Reconnection is always the caller's own policy,
  with a fresh ticket each attempt; the option is now REQUIRED by the type
  (`OpcoesDoSocket`) and asserted by a test over the option passed to the
  constructor, since a test that only checks "it connects" passed throughout.
- **The two `/projects/:projectId/runner-device-keys` routes ARE regular
  session JWT**, unlike `runner-ticket` above — the caller is a screen (the
  device-keys section of Settings, and the `RunnerOnboardingPanel` recognizing
  an already-paired machine). Until [ADR 0203](adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)
  ([RN-687](business-rules/web.md#rn-687)) there was a third, a `POST` through
  which the browser registered the Ed25519 public key it had just generated
  (ADR 0118). That flow was retired and the route went with it, because it had
  no other caller: keys are now born on the machine — `brabo-runner
  device-key create` ([RN-551](business-rules/runner.md#rn-551)) generates the pair
  and writes the private half to disk, mode 600, under
  `$XDG_CONFIG_HOME/brabo/` (else `~/.config/brabo/`) — and registered by the
  installer through the internal route below. The private half still never
  crosses the wire; only the public JWK and the registration `id` ever do.
  What that CLI deliberately does not have is a credential to register with —
  the registration stays with whoever holds the service token (the installer,
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) point 1), so
  each side holds exactly one secret and neither sees the other's. The file
  the runner reads never exists without its `kid`: `create` writes a
  `.parcial` name the reader ignores, and `finish --id <id>` stamps and
  renames. Project keys registered by the browser BEFORE ADR 0203 keep
  working: `PatAuthGuard` still accepts them, `GET` lists them and `DELETE`
  revokes them. `GET` lists the caller's own keys, revoked ones
  included ([RN-519](business-rules/api.md#rn-519)) — it is what makes
  revocation reachable at all, and until it existed an orphan key (tab
  closed midway through the automatic-setup flow) was invisible and
  permanent. It never returns the public JWK: what the list exists for is
  revoking, and `lastUsedAt: null` is the signal of the orphan. `DELETE`
  revokes the caller's own key, idempotently, same shape as the PAT's
  self-service revoke. `PatAuthGuard`
  is what LATER accepts a JWT signed by that key's private half on
  `runner-ticket`, looked up by the `kid` header matching this table's
  `id`; the guard checks the key hasn't been revoked but never an
  expiry — the key itself doesn't expire, only the short-TTL (≤60s,
  `exp - iat`) JWT the runner signs with it each time. Since
  [RN-543](business-rules/produto.md#rn-543) the `GET` returns TWO species and SAYS
  which is which (`especie`): a MACHINE key (`projectId: null`) serves every
  project of its owner, so it shows up in every project's listing — without
  that it would be invisible and permanent in every screen, the very defect
  RN-519 closed, reborn in the new species. The route that creates MACHINE
  keys is `POST /internal/machine-device-keys`, below
  ([RN-552](business-rules/api.md#rn-552)) — a different route, a different
  credential and a different caller. The KEY MATERIAL it registers is produced
  on the machine: `brabo-runner device-key create`
  ([RN-551](business-rules/runner.md#rn-551)) generates the Ed25519 pair locally and
  prints only the public JWK, so the private half never travels. Since
  [RN-547](business-rules/produto.md#rn-547) the `install.sh` **chains the two** at the
  end of an installation, and installs the machine unit with the resulting key
  ([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) — which is what
  makes this route's declared cost a live one rather than a hypothetical.
  Revoking a MACHINE key asks the engine to drop the live runner in EACH
  runner-mode project its owner reaches — one
  `{project, user}` call per project, the engine untouched.
- **The MACHINE key is also reachable per ACCOUNT, with no project in the
  path** ([RN-611](business-rules/api.md#rn-611)): `GET /users/me/machine-device-keys`
  and `DELETE /users/me/machine-device-keys/:deviceKeyId`, classified `jwt`
  because the scope is the caller themselves, like the rest of `/users/me/*`.
  They exist because the one-line install creates the account and the machine
  key BEFORE any project, and every other listing needs a `:projectId`: there,
  the key was live and unreachable. They are deliberately narrow — only
  MACHINE keys (a project key answers 404, the same as a key that doesn't
  exist or is someone else's, so nothing leaks) and only the CALLER's (the
  `userId` comes from the session JWT and goes into the `WHERE`; no parameter
  names another user, and the `maintainer` view stays out, as RN-519 decided).
  The `DELETE` is the same revocation as the per-project route, delegated to
  the same use case: it drops the live connections opened WITH that key, in
  every project (since [RN-685](business-rules/api.md#rn-685) the target is the
  key, not `{project, user}`); with no project yet it
  only records the revocation, which is all there is to stop — the waiting
  machine agent (RN-550) has no connection, and its next ticket is refused.
- **Revoking a device key now reaches the LIVE connection, and the target
  is `{project, user}` — never `{key}`**
  ([RN-520](business-rules/api.md#rn-520), [ADR 0147](adr/0147-agente-local-com-capacidades.md)
  point 6). `DELETE` used to stop only the NEXT ticket: a `brabo-runner`
  already connected kept its `terminal:<projectId>` channel alive, running
  approved commands with the revoked key, until it fell on its own. The
  api now asks the engine (`POST /internal/projects/:projectId/runner/disconnect`)
  to drop it, and the engine reaches the channel pid — the api never talks
  to the channel, and the engine never reads the key table.
  The precision that does NOT exist is per-credential, and that's a
  property of the ticket path rather than a preference:
  `runner_socket_tickets` stores `project_id`/`user_id`/`kind` and nothing
  else, so which PAT or which `kid` opened that socket dies in
  `PatAuthGuard` and never reaches the engine. **Declared cost:** a runner
  of the SAME user connected with a PAT, or with another key of the same
  project, also falls — and reconnects by itself, because the next round
  asks for a fresh ticket and a credential that still holds gets one. A
  runner of another user in the same project is left alone. Dropping the
  connection is a SIDE EFFECT: engine down, no runner connected or a
  timeout can never make the `DELETE` (204, idempotent) fail or turn 5xx —
  the same rule as `rag_searches` ([RN-479](business-rules/api.md#rn-479)) and
  `mirror_sync_result` ([RN-517](business-rules/api.md#rn-517)).
  **Revised by [RN-685](business-rules/api.md#rn-685)
  ([ADR 0201](adr/0201-revogacao-por-chave.md)): the target is now the KEY.**
  The ticket records which credential asked for it (the `kid`, or the PAT's
  id), and the revocation asks the engine
  (`POST /internal/runner/disconnect-credential`) to void the credential's
  pending tickets and drop only the runners born from it — the declared cost
  above is gone: a runner of the same user on a PAT or another key stays up.
  PAT revocation (own, or as `maintainer`) now drops its connections too. A
  connection opened with a pre-deploy ticket (no credential) still falls by
  the pair, and an engine that does not know the route makes the api fall back
  to `runner/disconnect`; the pair route also stays as member removal's target.
  The `maintainer` view the PAT has (RN-427, list/revoke of ANY user)
  stays OUT for device keys — now by decision, not omission: that pair was
  born of incident response to a SHARED secret circulating, and a device
  key's private half never leaves the machine that made it. That sentence used
  to say "the browser that made it", and [RN-551](business-rules/runner.md#rn-551)
  widened the maker without weakening the claim: the terminal is now a second
  generator, and the private half still never travels — what leaves is the
  public JWK. What DID change is where it rests: a key made in the browser
  lands in a project folder the user picked, one made by the CLI lands in
  `$XDG_CONFIG_HOME/brabo/` at mode 600. Neither is reachable by the api, which
  is what the decision above depends on.
- **The `engine-service` routes aren't "internal" by naming convention.**
  What protects them is `EngineServiceGuard` comparing
  `X-Brabo-Service-Token` against the shared secret in constant time, plus
  the NetworkPolicy. The `/internal` prefix is signaling for humans. They
  sit **outside the JWT** via `@ServiceRoute()`: the user token doesn't
  work here and the service token doesn't work on any other route — the
  two mechanisms never overlap ([RN-035](business-rules/api.md#rn-035)).
- **`POST /internal/first-account` is a second path that creates a USER, and
  it works in production** ([RN-546](business-rules/produto.md#rn-546),
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)). Declared here
  rather than left to be discovered. Normal registration is the first path and
  it is untouched; this one exists because a fresh one-line installation lets
  nobody in — the generated `.env` has no mail variable, `MAIL_TRANSPORT`
  falls to `log`, and registration waits on an e-mail nobody sends.

  It is narrow by construction, on three independent counts. **It is
  `engine-service`**, so what opens it is `BRABO_SERVICE_TOKEN` — which
  `install.sh` itself generated and wrote at mode `600`, making it a proof of
  control over the MACHINE, not over a mailbox. **It refuses with `409` when
  the installation has ANY user**, a condition about the installation and not
  about the e-mail asked for, so it cannot be called repeatedly with different
  addresses, and it goes quiet forever once anyone exists (including after a
  migration restore, [RN-530](business-rules/infra.md#rn-530)). **And no public route
  was born**: a public "create the first owner" is a race between whoever
  installed and whoever scanned the port, and `owner` of the first workspace is
  not a role anyone recovers over HTTP.

  The account is born with its e-mail already verified, and that is the one
  thing this route relaxes — for a named case, never for the other path. What
  verification proves is *"this person controls this mailbox"*; whoever runs
  the installer has already proved the machine, the `.env` and the Docker
  daemon. The password is typed at the TTY, read without echo, hashed with
  argon2id and discarded: never in the `.env`, never in the marker, never in a
  log, and never generated by any code.

  One window is declared rather than closed: the "is there any user?" check
  runs inside the transaction, but `READ COMMITTED` does not stop two
  concurrent calls with different e-mails from both passing. Closing it would
  need an advisory lock over the absence of rows, and that is not where the
  containment lives — whoever reaches this route already holds the service
  token, i.e. already controls the installation.
- **`POST /internal/machine-device-keys` MINTS A DURABLE USER CREDENTIAL from
  a machine secret** ([RN-552](business-rules/api.md#rn-552),
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) point 4). This is
  the sharpest edge the service token has, and it is declared here for the same
  reason its sibling above is: the installer's next step after creating the
  first account is pairing the local agent, and pairing needs a credential —
  the only one that existed was bound to a PROJECT, in an installation that has
  none yet.

  **What it costs, said plainly:** a leaked `BRABO_SERVICE_TOKEN` can now
  FABRICATE a device key that acts as a user against role-checked routes
  (`POST .../runner-ticket`, and through it the runner channel), instead of
  only talking to the internal routes. The alternative credential — the
  freshly created user's own — was considered and refused because it
  contradicts [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)
  itself: the password is read at the TTY, *used and discarded*, and point 5
  states the installer *"does not log in for anybody"*, which is why the
  first-account response deliberately carries no session token. Requiring it
  here would force the installer to create, on the machine, the very live
  session that ADR refused to create.

  Three containments live in the ROUTE, not in this paragraph. **There is no
  `userId` in the body**: the owner is the installation's SOLE user, resolved
  by the api, so the token never buys the choice of whose credential to mint —
  with zero users or more than one it refuses with `409` and writes nothing,
  the same shape of condition as first-account (about the installation, never
  about the argument), and it goes quiet for good once the installation has a
  team. **Registering REPLACES**: the owner's active machine keys are revoked
  in the same transaction, so a reinstalled machine is a legitimate case and a
  thousand machine keys are impossible — bounded by a clause, not by a number
  that ages. **A private JWK is refused by name**: `d` present answers `400`
  saying what arrived, by the same domain rule the browser registration uses,
  because storing a private half is the worst outcome this route has.

  What the key grants is not widened: it gives the local agent exactly the
  projects its owner already reaches at `developer`, resolved against the
  project asked for ([RN-543](business-rules/produto.md#rn-543)). Two gaps are declared
  rather than hidden: there is no `GET` and no `DELETE` here (listing would
  publish a person's credential inventory to whoever holds only the machine
  secret; revoking already exists where it has a human owner), and on an
  installation that has no project yet no screen reaches a machine key at all —
  which is exactly why registering replaces instead of leaving orphans behind.
- **`/docs` and `/docs-json` are NOT in the table, and that's a known
  gap.** The Swagger UI is mounted by `SwaggerModule.setup()` at the
  Express level, not as a controller, and the test enumerates via
  `DiscoveryService` — it structurally can't see them. Both only exist
  with `NODE_ENV !== 'production'` (`main.ts`), are public, and serve
  the same document the
  [generated reference](reference/api.html) publishes. Recorded
  here instead of left out: what the test can't reach needs to be in
  the prose.
- **`GET /projects/:projectId/agent-areas` started returning real data,
  and the classification didn't change** — it's still `role:developer`,
  while the ceiling's `PATCH` remains `role:maintainer`. Until PHASE 18
  the `agent_areas` table was never written and the route answered `[]`
  to everyone, which made the classification look lenient by accident,
  not by decision. With the area now born together with the project
  ([RN-094](business-rules/api.md#rn-094)), the split goes back to what
  PHASE 14d intended: **reading** the ceiling is work for whoever
  executes; **changing it** is deciding how much the product spends
  without asking, and that's why it requires the same role that
  activates execution.
- **The five `/projects/:projectId/rag/*` routes split the role by the
  same criterion as the area parallelism ceiling (RN-083)** (PROGRAM 28,
  Wave 4 — RN-231..234, ADR 0080): `search` and `coverage` are
  `role:viewer` (pure reading over what's already indexed), and
  `reindex` is `role:maintainer` — it triggers N calls to the project's
  repository and to the embedding provider, the same "changes what the
  product spends without asking" that already justifies the higher role
  on other expensive-trigger routes. `local` (RN-455, ADR 0113) is
  `role:maintainer` too, same reasoning: it calls the embedding provider
  and replaces what the project has indexed for that scope. Its body is
  browser-read TEXT, never a host path.
  `feedback` (RN-480) is `role:viewer`, the **same** role as `search`,
  and the criterion above is why: voting spends nothing and configures
  nothing — it is observation, and it is the only signal of truth the
  RAG measurement has (`medir:rag`). Raising it to `maintainer` would
  empty that signal to protect nothing. The vote is still bounded on the
  server: a `searchId` from another project, or a `chunkId` that was not
  among that search's hits, is a 400 — a vote without a rank measures
  nothing.
- **The four `/projects/:projectId/code/*` routes are `role:viewer` and
  READ-ONLY** (PHASE 26b). Seeing a project's code is the same
  permission as seeing the project — the same cut as
  `GET /projects/:id/git/repository`. Three things make this apparent
  looseness a decision rather than an oversight:
  - **there's no write verb on the controller**, and there can't be: the
    Code tab is for reading, and writing is an external effect, which
    is born a `proposed_action` and belongs to a later phase. A `@Post`
    in this file is a phase change, not a route change;
  - **the path is contained in ONE place** ([RN-095](business-rules/api.md#rn-095)),
    via the same central check as [RN-092](business-rules/api.md#rn-092) —
    and containment matters here more than the role, because on remote
    providers the path becomes a URL segment of the provider's API and a
    `../` swaps the **endpoint**, not the file;
  - **the credential spent is the workspace owner's**
    ([RN-058](business-rules/api.md#rn-058)/[RN-082](business-rules/api.md#rn-082)),
    same as with writing. Reading costs the provider's rate limit, which
    is why search has a budget: without a ceiling, a `viewer` could run
    up the owner's bill at will.
- **`GET /workspaces/:workspaceId/spend-report` started returning the
  breakdown by provider, which is a breakdown by CREDENTIAL**
  ([ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md),
  [RN-186](business-rules/api.md#rn-186)/[RN-187](business-rules/api.md#rn-187)).
  No new route and no role change — still `role:owner`, as it already
  was — but what it GRANTS changed, which is why this note exists. ADR
  [0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) had refused
  that axis for exactly this reason; 0076 revises it by the product
  owner's decision. What now holds the boundary is TWO independent
  barriers: `GET /projects/:projectId/spend/me` (`role:viewer`) has no
  dimension parameter at all, and the TYPE refuses the combination — a
  scope with `actor` only accepts
  `Exclude<SpendDimension, 'provider'>`, so asking for provider in the
  member's view doesn't compile. The second is weaker than the previous
  guarantee ("the dimension didn't exist"), which is why there are two.
- **`POST /projects/:projectId/sessions/:sessionId/socket-ticket` is
  `role:viewer` in the table, but that's the FLOOR, not the ceiling**
  (RN-108). The `@RequireRole('viewer')` covers `scope: "heartbeat"` —
  the existing heartbeat/live-events socket; `scope: "terminal"`
  requires `developer`, checked INSIDE `CreateSocketTicketUseCase`
  against `request.effectiveRole` (the same one `RolesGuard` already
  resolved), because the minimum role depends on the request's BODY, not
  just the route — the same pattern as
  `MIN_ROLE_FOR_ACTION_TYPE.terminal` in `domain/actions/decide.ts`.
  Today no real path asks for `scope: "terminal"` (the interactive
  terminal socket is PHASE 25); the value is already born correct for
  when it exists.
- **`POST /projects/:projectId/members` is `role:maintainer` in the table,
  and that role is NECESSARY but not SUFFICIENT**
  ([ADR 0127](adr/0127-tetos-de-rebaixamento-em-project-members.md),
  [RN-472](business-rules/api.md#rn-472)). The mirror image of the
  `socket-ticket` note above: there the table's role is the floor and the
  body can raise it; here the table's role is the whole gate the
  `RolesGuard` applies, and the use case then refuses **two movements with
  403 even for a caller who has it** — downgrading someone who is `owner` of
  the WORKSPACE, and downgrading YOURSELF. No new route and no role change
  (`RequireRole('maintainer')`, as it already was); what changed is that the
  classification stopped being the complete answer to "who can do what
  here". The reason it can't live in `RolesGuard` is the same one the
  `socket-ticket` note gives — the decision depends on the request's BODY
  (`dto.role`) and on its TARGET (`dto.userId`), which the guard doesn't
  see — so the rule is a pure function in
  `domain/iam/tetos-de-rebaixamento.ts` applied by
  `AddProjectMemberUseCase`, in the FORM of the absolute caps in
  `domain/actions/decide.ts` ([RN-418](business-rules/api.md#rn-418)): no
  configuration key, nothing that can enable them. The `owner` being
  protected is `workspace_members.role`, never `workspaces.created_by`.
  What the caps do NOT cover is written down in the ADR and in the RN.
- **`DELETE /projects/:projectId/members/:userId` is also `role:maintainer`
  and also not sufficient** — the second door of the self-downgrade cap
  ([ADR 0156](adr/0156-teto-de-auto-rebaixamento-na-remocao.md),
  [RN-556](business-rules/api.md#rn-556)). ADR 0127 left this route capless on a
  premise that turned out to be false — *"removal is benign"*. Deleting the
  `project_members` row does not erase a role: it **swaps** the effective
  one, because `forProject` is `projectRole ?? workspaceRole`
  ([RN-471](business-rules/web.md#rn-471)). A `maintainer` by project row who is
  `viewer` in the workspace downgraded themselves, irreversibly through the
  UI — putting the row back is `POST :projectId/members`, which demands the
  `maintainer` just given up; with **no** workspace role at all, the fall is
  to no access. The cap is now applied by `RemoveProjectMemberUseCase`,
  which had to start receiving the ACTOR (the route did not pass it, so no
  cap could have been applied), and the rule REUSES
  `ehAutoRebaixamento` — `remocaoEhAutoRebaixamento` delegates to it with
  the workspace role in place of the requested one, never a second ruler.
  Cap 1 has **no** counterpart here, by decision fixed in a test: `owner` is
  the top of `ROLE_ORDER`, so removing a project row can only RAISE that
  user's effective role — and it is precisely how the restriction cap 1
  forbids creating gets undone. Declared price, since cap 2 has no
  threshold: self-removal from project `owner` to workspace `maintainer` is
  reversible and is refused too — the only benign movement that changes
  outcome, still reachable through another `maintainer`.
- **`POST /workspaces/:workspaceId/members` is `role:owner` in the table, and
  that is no longer the whole answer either** — the third route of this family
  ([ADR 0157](adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md),
  [RN-557](business-rules/produto.md#rn-557)). ADR 0127 named this route as the same
  class of defect *one scope up*, and ADR 0156 left it as a separate decision;
  it was a twelve-line passthrough that **never received the actor**, so no cap
  could have been applied. It is worse here than in the project for two reasons
  that do not exist there: no level above catches the fall (in a project,
  demoting yourself drops the effective role to the workspace one, which often
  holds), and **there is no member `@Delete` at all** on this controller
  (measured) — undoing is this same route, demanding the `owner` just
  abandoned. So `AddWorkspaceMemberUseCase` now takes the actor and refuses
  **changing YOUR OWN role with 403, in both directions**. The cap does **not
  count owners**, on purpose: the clause has no number to age (ADR 0127's
  criterion), and it already produces the invariant a count would exist to
  guarantee — a workspace never reaches zero owners, since removing the last
  one would require that owner to do it. Cap 1 has **no counterpart in this
  scope**, considered rather than mirrored: it is a rule about *hierarchy
  inversion*, and `@RequireRole('owner')` already makes inversion impossible —
  whoever can call is never below whoever they touch. Adding it, on top of the
  missing removal route, would make `owner` an absorbing state nobody leaves
  over HTTP, which is the class of state ADR 0127 was born to eliminate.
  Demoting **another** owner therefore stays allowed — the only way ownership
  gets revoked, and reversible through the same route by any remaining owner.
- **`DELETE /workspaces/:workspaceId/members/:userId` is `role:owner`, and it
  is the fifth door of the same family**
  ([ADR 0173](adr/0173-remocao-de-membro-de-workspace.md),
  [RN-615](business-rules/api.md#rn-615)). It did not exist when ADR 0157 was
  written — the sentence above about "no member `@Delete`" describes that
  moment. It carries the same cap with no new rule: `remocaoEhAutoRebaixamento`
  with the workspace role as today's effective role and *none* as the role
  after, since no level above catches the fall — so **removing YOURSELF is
  always 403**. That same clause is what protects the **last owner**, without
  counting: only an `owner` calls the route, nobody removes themselves, so
  every successful call leaves at least the caller as `owner`. Removing
  **another** owner is allowed (it is how ownership is revoked entirely), and
  cap 1 still has no counterpart here — `@RequireRole('owner')` keeps
  preventing hierarchy inversion. The removal also **cascades**, in one
  transaction: the target's `project_members` rows in this workspace (without
  it the project-overrides-workspace rule would keep them inside every project
  where they had their own row), their PROJECT device keys and their PATs
  here (every PAT belongs to one project); after commit their live runner
  connection in each project is dropped, best effort, through the RN-520
  path. Declared and not done: machine keys (account-wide; they stop reaching
  this workspace because the role resolves to none), already-connected
  session sockets. The **owner of record** (`workspaces.created_by`, whose
  LLM and git credentials agents spend, RN-058) cannot be removed: 409
  `criador_do_workspace` until `PUT /workspaces/:workspaceId/owner-of-record`
  (`role:owner`, target must already be `owner`, else 409
  `titular_precisa_ser_owner`) moves it — [RN-616](business-rules/api.md#rn-616).
  Any owner may transfer it, including to another owner who did not ask.
- **`GET /workspaces/:workspaceId/members` is `role:viewer`, not the `owner`
  of the three write routes next to it** ([RN-652](business-rules/web.md#rn-652),
  AT-335). The minimum is the endpoint's (RN-102): reading the roster is not
  maintaining it. `viewer` is what the neighbouring reads use
  (`GET /workspaces/:workspaceId`, `/projects`) and what
  `GET /projects/:projectId/members` uses — the read this one completes, since
  whoever enters a project through the workspace role alone has no project
  row. Anyone who can open a session can see who spoke in it, and a
  workspace `viewer` already sees every project of the workspace. The body is
  the same shape as the project read — `userId`, `name`, `email`, `role` —
  and nothing else (no `createdAt`, no account state).
- **Self-PROMOTION is now refused on both association routes**, which changes
  `POST /projects/:projectId/members` too. ADR 0127 had recorded it as a
  capability that stayed (*"the caps are about going down"*); ADR 0157 revises
  that. Both halves are one movement — a person deciding alone what authority
  they hold — and the upward half is the only one that **escalates privilege**,
  the very thing ADR 0127 could claim its caps never did. Rewriting the SAME
  role still passes: an idempotent upsert is not a movement. The comparison
  stayed in one place: `autoMovimentoDoProprioPapel` returns the SENSE instead
  of a boolean (the caller needs it to pick the message), and
  `ehAutoRebaixamento` survives as a reading of it so that the REMOVAL door
  keeps seeing only the downward half, as ADR 0156 decided.
- **`jwt` with no role doesn't mean without authorization.** On
  `/users/me/*` the scope is the user themselves; on `GET /workspaces`
  the listing is already filtered by the caller's membership.
- **`X-Brabo-Service-Token` started getting redacted in the log**
  ([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).
  It's the bearer for all api↔engine traffic and was **not** on pino's
  `redact` list: if it landed in a logged error body, it would go to
  Loki in plain text and with retention. `serviceToken`, `privateKey`,
  `encryptedDek`, and `dek` were added at the same time. The full list is
  in `apps/api/src/infrastructure/observability/logger.config.ts`, and
  there's a test asserting each path — the list is a contract, not a
  convenience.
- **CORS's `allowedHeaders` is explicit**, and the list needs to contain
  every header the web sends: `Content-Type`, `Authorization`,
  `X-CSRF-Token`, and `traceparent`. Missing one breaks no test at all
  (no test does a preflight) and breaks the browser.
- **The engine has CORS only on its health routes**
  ([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)).
  `/health`, `/live`, and `/ready` return
  `Access-Control-Allow-Origin` for `WEB_ORIGIN`'s origins;
  **`/internal/*` and `/metrics` don't**, and the exclusion is the
  point. The 13 internal routes are server-to-server with a shared
  secret ([RN-035](business-rules/api.md#rn-035)); CORS there wouldn't
  enable anything — the api's HTTP client ignores those headers — but it
  **would announce to a browser that it's an expected client of that
  channel**. There's a test asserting the absence, and one asserting the
  path list has exactly three entries, so moving the boundary shows up
  in the diff.
- **An unknown origin gets a response, not a `403`.** On both services,
  the request is served and goes out without the header; what blocks the
  read is the browser, which is whose decision it is. Answering `403`
  would break every client that doesn't send `Origin` — kubelet's probe,
  `curl`, `docker/smoke.sh`.
- **`POST .../delegations` is engine-service like the other internal
  routes** (Phase 8b QA, Phase 8c Infra — ADR 0038) — each area's lead
  records each delegate's outcome (`completed`/`failed`/`dispensed`)
  SEPARATELY from the call the area uses to report its consolidated
  result to the outside (`gates/verdict` for QA, `open_infra_pr` for
  Infra). Session-scoped, not task-scoped — `taskId` is optional in the
  body. Delegation is never visible as a handoff.
- **`POST /projects/:projectId/execution/activate` gained an optional
  `originSessionId` in the body, and the classification didn't change**
  — still `role:maintainer` (RN-135). The field lets whoever already has
  that role close the CHAT session that originated the request, but with
  two containments that prevent using it to close someone else's
  session: `findInProject(projectId, originSessionId)` silently refuses
  an id that doesn't belong to the path's OWN project, and the closing
  only happens if `GetSessionPendingWorkUseCase` (the same guard as the
  inactivity heartbeat, [RN-073](business-rules/engine.md#rn-073)) confirms
  there's no handoff, action, or turn hanging there. It never closes the
  execution session the call itself just activated.
- **`GET /internal/sessions/:sessionId/pending-work` gained
  `aguardandoUsuarioDesde`, and no route changed classification**
  ([RN-581](business-rules/api.md#rn-581)). Still `engine-service`: the field
  is the instant a conversational agent's turn ended, read from the same
  event log the engine already writes, and it only decides how long the
  engine keeps a session open. The same RN made the session routes that
  append conversation (`POST .../agents/:agent/message`, the chat,
  handoffs, `POST .../agents/:agent/start`,
  `POST /internal/sessions/:sessionId/events`) answer **409**
  `sessao_encerrada` on a terminal session — a refusal by STATE, after
  the role check, never a new role. `terminationReason` on the session
  responses gained one documented value, `conversation_idle_timeout`.
- **`POST /projects/:projectId/execution/activate` refuses with `409` when
  the project has no repository, and the classification didn't change**
  — still `role:maintainer` ([RN-582](business-rules/api.md#rn-582),
  [ADR 0165](adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)). The
  refusal comes before any side effect. Its message is chosen from the
  project's handoffs, read across ALL its sessions — so it can say "accept
  the handoff to the Architect/Dev Lead". What it reveals is only that such a
  handoff exists and its status, which any `viewer` of the project already reads
  through `GET .../sessions/:sessionId/handoffs`; it never names a session or
  a user.
- **Offering a handoff to an agent already active in the project is `409`
  `agente_ja_ativo`, and the classification didn't change** — the human route
  `POST .../sessions/:sessionId/handoffs` stays `role:developer` and the
  internal one stays `engine-service` ([RN-635](business-rules/api.md#rn-635),
  [ADR 0182](adr/0182-ciclo-de-vida-do-handoff.md)). Unlike the refusal above,
  this one DOES name a session: the message says in which session of the same
  project the target is active, because it is the text the agent reads as its
  tool result and the pointer a person needs to go talk to it. Any `viewer` of
  the project already lists its sessions and reads `agent.activated` in each,
  so nothing crosses a project boundary. The same routes now answer with the
  CURRENT offer instead of always a new row (`desfecho`), and the internal one
  accepts `seAusente` — a switch that can only make the call write LESS.
- **The internal `POST /internal/sessions/:sessionId/handoffs` may now ACCEPT
  the Creative→PO offer it creates, and the classification didn't change** —
  still `engine-service` ([RN-658](business-rules/api.md#rn-658),
  [ADR 0185](adr/0185-estou-pronto-fecha-os-dois-gates.md)). The engine gains no
  power to activate an agent: the api decides, from the `readiness.confirmed`
  that a PERSON recorded through `POST .../readiness` (`role:developer`, the same
  minimum as accepting by the card), and records that person as the actor. The
  engine cannot forge the mark — it never writes `readiness.confirmed` — and
  the offer must carry the `product_brief` born after that click, in the same
  session. `POST .../agents/criativo/validate-necessity` keeps its route and
  role, with no web caller left ([RN-657](business-rules/api.md#rn-657)).
- **`GET /projects/:projectId/execution/session` is `role:viewer`, the
  same role as `GET /sessions/:sessionId`**
  ([RN-139](business-rules/api.md#rn-139)). Returns the project's CURRENT
  execution session — `active` with `execution.activated` recorded — or
  `null`; never the project's most recent session, which is what the
  Executors tab used to read and which silently switched sessions the
  moment another session was born after it.
- **`GET /workspaces/:workspaceId/projects-summary` gained
  `roster.activatedAgents`, and the classification didn't change** — still
  `role:viewer`. The field is the list of agent ids with an `agent.activated`
  in the project's most recent session ([RN-630](business-rules/api.md#rn-630)),
  computed in the same per-session sweep that already produces
  `executionActivated` and `gatesEverOpened` ([RN-568](business-rules/web.md#rn-568)).
  It names no user, no session and no credential, and adds no query.
- **`POST .../llm-turn` and `POST .../llm-turn-stream` gained
  `modelName` in the response body/final frame, and the classification
  didn't change** — still `engine-service` as always
  ([RN-146](business-rules/api.md#rn-146)). The model's name was already
  being resolved to call the provider; it just started traveling back to
  the engine, which includes it in the `agent.response` payload. No new
  data is read, no new credential is exposed — it's the same name that
  already shows up in `token_usage`.
- **`PUT /projects/:projectId/agent-autonomy` started accepting
  `actionType: "*"` — "auto mode" ([RN-153](business-rules/api.md#rn-153))
  — and the classification didn't change:** still `role:maintainer`,
  the same as the `GET` next to it. The difference is what the body now
  AUTHORIZES, not who can call it: the wildcard grants autonomy for ANY
  agent action type at once, instead of one type at a time like before.
  The resolution (a SPECIFIC rule always beats the wildcard) lives
  entirely in the repository
  (`DrizzleAgentAutonomyRepository.findMode`), never in `decide()` —
  which keeps receiving only the already-resolved `PermissionPolicy`,
  exactly as before the wildcard existed. That's why the three absolute
  ceilings — merging into a protected branch, `instruction_patch`,
  `parallelize`/`raise_max_parallel` — keep blocking even with the
  wildcard set to `auto_approve` ([RN-154](business-rules/api.md#rn-154)):
  they react to `current.policy === 'auto_approve'`, never to where it
  came from, and no exception had to enter `decide()` for that to keep
  holding. `ApprovalCard.tsx` only offers the button that writes the
  wildcard to a client that already knows it has `maintainer`/`owner` —
  but what actually guarantees the role is this same
  `@RequireRole('maintainer')`, unchanged.
- **The Jev tool router is a new OUTBOUND call carrying agent context**
  ([ADR 0179](adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md),
  [RN-625](business-rules/engine.md#rn-625)). Before a chat call to an OpenRouter
  model, the api POSTs to `https://openrouter.ai/api/alpha/decisions` (the
  Decisions API, alpha) with the workspace owner's OpenRouter key — the SAME
  key the chat already spends, decrypted in the same use case, never logged
  and never returned. What travels is the `state`: the agent id, the last user
  message (cut at 6,000 characters), the start of the system message (1,500),
  and up to six recent tool calls with arguments and results cut at 500
  characters each — plus the tool NAMES and DESCRIPTIONS, never their
  `parameters`. That is content the chat call already sends to the same
  OpenRouter account, in a smaller slice, but it now reaches a second model
  (`typesafe/jev-1.13`) behind it. The switch is per workspace
  (`PUT /workspaces/:workspaceId/tool-router`, `role:owner`, on by default) and
  it only fires with an OpenRouter chat model. The router narrows the tool
  menu and nothing else: it cannot approve, deny, or widen anything, and a
  call the model makes outside the menu still becomes a Proposed Action under
  the same policy. Any failure of the call falls to the whole catalog.
- **`POST .../actions/:actionId/approve_always` gained `desfecho` and
  `padraoGravado` in the response, and the classification didn't change** —
  still `role:developer` ([RN-642](business-rules/api.md#rn-642)). The approval
  and the recorded pattern now share one transaction; clicking an action that
  was already APPROVED answers `201` with `desfecho: "ja_aprovada"` instead of
  `409`, and a DENIED action keeps answering `409` (`acao_ja_recusada`) with
  nothing written. The RN-418 caps and `container_remove` are still refused
  with `400` before any state is read, so the idempotent path can never write
  a pattern the ceiling forbids.
- **A git error got a new named answer: `409 merge_conflict`** — no route,
  role or guard changed ([RN-704](business-rules/api.md#rn-704)).
  `GitProviderErrorFilter` maps `GitMergeConflictError` (the local
  repository's merge found a conflict) to `409` with the conflicting files in
  the message; the target ref is untouched and the pull request stays open.
  Through the approval pipeline the `git_merge` action ends `failed` with
  that message, the same path as `GitPullRequestAlreadyMergedError`.
- **`GET /projects/:projectId/actions` accepts `status=failed`** — same route,
  same `developer` role ([RN-705](business-rules/api.md#rn-705)). Until now only
  `pending` was accepted; `failed` lists the actions of the project whose
  execution failed, and it REQUIRES `actionType` (`400` without it), so the
  read is one type and never the whole history. It returns the same
  `ProposedAction` shape the pending read returns; the failed git action now
  carries its own `kind`, the error message and, on a merge conflict, the
  conflicting file names — repository paths the same role already reads in
  the diff.

## Table

<!-- START OF TABLE — the test parses from here to the end of the document. -->

| method | path | classification |
|---|---|---|
| GET | `/.well-known/jwks.json` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| GET | `/auth/oauth/:provider/callback` | public |
| GET | `/auth/oauth/:provider/start` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/register` | public |
| POST | `/auth/request-password-reset` | public |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |
| GET | `/gates` | jwt |
| GET | `/git/oauth/:provider/callback` | public |
| GET | `/health` | public |
| GET | `/live` | public |
| GET | `/metrics` | public |
| GET | `/runner-releases/binary` | public |
| POST | `/internal/sessions/:sessionId/actions` | engine-service |
| GET | `/internal/sessions/:sessionId/anamnese-context` | engine-service |
| POST | `/internal/sessions/:sessionId/anamnese-window` | engine-service |
| POST | `/internal/sessions/:sessionId/delegations` | engine-service |
| GET | `/internal/sessions/:sessionId/dev-context` | engine-service |
| POST | `/internal/sessions/:sessionId/epics` | engine-service |
| GET | `/internal/sessions/:sessionId/events` | engine-service |
| GET | `/internal/sessions/:sessionId/pending-work` | engine-service |
| POST | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/handoffs` | engine-service |
| POST | `/internal/sessions/:sessionId/hypotheses` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-artifacts/:prActionId/files` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-context` | engine-service |
| POST | `/internal/sessions/:sessionId/infra-gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/instruction-patches` | engine-service |
| POST | `/internal/sessions/:sessionId/max-parallel-proposals` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn-stream` | engine-service |
| POST | `/internal/sessions/:sessionId/c4-diagram` | engine-service |
| POST | `/internal/sessions/:sessionId/module-map` | engine-service |
| POST | `/internal/sessions/:sessionId/module-routing` | engine-service |
| POST | `/internal/sessions/:sessionId/module-contracts` | engine-service |
| POST | `/internal/sessions/:sessionId/project-image` | engine-service |
| POST | `/internal/sessions/:sessionId/proficiency` | engine-service |
| POST | `/internal/models/sync` | engine-service |
| GET | `/internal/graph/prompt-templates/:name` | engine-service |
| POST | `/internal/graph/prompt-templates` | engine-service |
| POST | `/internal/rag/search` | engine-service |
| POST | `/internal/rag/feedback` | engine-service |
| GET | `/internal/gates` | engine-service |
| GET | `/internal/projects/:projectId/git-remote` | engine-service |
| GET | `/internal/projects/:projectId/business-rules` | engine-service |
| GET | `/internal/projects/:projectId/backlog` | engine-service |
| GET | `/internal/projects/:projectId/product-metrics` | engine-service |
| GET | `/internal/projects/:projectId/module-contracts` | engine-service |
| POST | `/internal/projects/:projectId/workspace-verification` | engine-service |
| POST | `/internal/projects/:projectId/container-exec` | engine-service |
| POST | `/internal/projects/:projectId/mirror-sync-result` | engine-service |
| GET | `/internal/projects/:projectId/container-spec` | engine-service |
| POST | `/internal/first-account` | engine-service |
| POST | `/internal/machine-device-keys` | engine-service |
| GET | `/internal/sessions/:sessionId/psychologist-context` | engine-service |
| POST | `/internal/sessions/:sessionId/stories` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/complete` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/update` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/archive` | engine-service |
| POST | `/internal/sessions/:sessionId/semantic-duplicate-check` | engine-service |
| POST | `/internal/sessions/:sessionId/story-modules` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/block` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/unblock` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/gate/open` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/status` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/claim` | engine-service |
| GET | `/internal/sessions/:sessionId/tasks/in-progress-by-dev` | engine-service |
| POST | `/internal/sessions/:sessionId/termination` | engine-service |
| GET | `/` | jwt |
| GET | `/runner/projects` | jwt |
| GET | `/llm/provider-capabilities` | jwt |
| GET | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials/:provider/test` | jwt |
| DELETE | `/users/me/credentials/:provider` | jwt |
| POST | `/users/me/git-credentials` | jwt |
| GET | `/users/me/machine-device-keys` | jwt |
| DELETE | `/users/me/machine-device-keys/:deviceKeyId` | jwt |
| GET | `/users/me/preferences` | jwt |
| PATCH | `/users/me/preferences` | jwt |
| POST | `/users/me/preferences/detected-language` | jwt |
| GET | `/workspaces` | jwt |
| POST | `/workspaces` | jwt |
| DELETE | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId` | role:viewer |
| PATCH | `/projects/:projectId` | role:maintainer |
| PUT | `/projects/:projectId/execution-mode` | role:maintainer |
| PUT | `/projects/:projectId/mirror-path` | role:maintainer |
| GET | `/projects/:projectId/mirror-state` | role:viewer |
| GET | `/projects/:projectId/models` | role:viewer |
| GET | `/projects/:projectId/actions` | role:developer |
| GET | `/projects/:projectId/agent-autonomy` | role:maintainer |
| PUT | `/projects/:projectId/agent-autonomy` | role:maintainer |
| DELETE | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| GET | `/projects/:projectId/agent-bindings/:agentSlug` | role:viewer |
| PUT | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| DELETE | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/area-bindings/:areaKey` | role:viewer |
| PUT | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/agent-costs` | role:developer |
| GET | `/projects/:projectId/agents/:agent/instruction-versions` | role:viewer |
| POST | `/projects/:projectId/agents/:agent/instruction-versions/:version/rollback` | role:maintainer |
| POST | `/projects/:projectId/anamnese/run` | role:maintainer |
| GET | `/projects/:projectId/architecture` | role:viewer |
| GET | `/projects/:projectId/backlog` | role:viewer |
| GET | `/projects/:projectId/budget` | role:maintainer |
| PUT | `/projects/:projectId/budget` | role:maintainer |
| GET | `/projects/:projectId/agent-areas` | role:developer |
| PATCH | `/projects/:projectId/agent-areas/:key/max-parallel` | role:maintainer |
| PUT | `/projects/:projectId/agent-areas/:key/budget` | role:maintainer |
| GET | `/projects/:projectId/code/blame` | role:viewer |
| GET | `/projects/:projectId/code/branches` | role:viewer |
| GET | `/projects/:projectId/code/file` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests/:pullRequestId/diff` | role:viewer |
| GET | `/projects/:projectId/code/search` | role:viewer |
| GET | `/projects/:projectId/code/tree` | role:viewer |
| POST | `/projects/:projectId/rag/search` | role:viewer |
| POST | `/projects/:projectId/rag/reindex` | role:maintainer |
| POST | `/projects/:projectId/rag/local` | role:maintainer |
| POST | `/projects/:projectId/rag/feedback` | role:viewer |
| GET | `/projects/:projectId/rag/coverage` | role:viewer |
| GET | `/projects/:projectId/container` | role:viewer |
| GET | `/projects/:projectId/container/lifecycle` | role:viewer |
| GET | `/projects/:projectId/coverage` | role:viewer |
| GET | `/projects/:projectId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/execution/activate` | role:maintainer |
| GET | `/projects/:projectId/execution/session` | role:viewer |
| GET | `/projects/:projectId/git/:provider/connect` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository/adopt` | role:maintainer |
| GET | `/projects/:projectId/git/bootstrap` | role:viewer |
| GET | `/projects/:projectId/git/bootstrap/plan` | role:viewer |
| POST | `/projects/:projectId/git/bootstrap/plan/approve` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/plan/skip` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/acknowledge-protection-failure` | role:maintainer |
| GET | `/projects/:projectId/git/repository` | role:viewer |
| GET | `/projects/:projectId/hypotheses` | role:viewer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/accept` | role:developer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/dismiss` | role:developer |
| GET | `/projects/:projectId/infra-artifacts` | role:viewer |
| GET | `/projects/:projectId/instruction-versions` | role:viewer |
| GET | `/projects/:projectId/members` | role:viewer |
| POST | `/projects/:projectId/members` | role:maintainer |
| DELETE | `/projects/:projectId/members/:userId` | role:maintainer |
| GET | `/projects/:projectId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/model-binding` | role:maintainer |
| GET | `/projects/:projectId/model-bindings/resolved` | role:viewer |
| GET | `/projects/:projectId/permissions` | role:maintainer |
| PUT | `/projects/:projectId/permissions` | role:maintainer |
| POST | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens/all` | role:maintainer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId` | role:developer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId/admin` | role:maintainer |
| GET | `/projects/:projectId/open-questions` | role:viewer |
| POST | `/projects/:projectId/open-questions/:questionId/answer` | role:viewer |
| GET | `/projects/:projectId/run-instructions` | role:viewer |
| GET | `/projects/:projectId/runner-device-keys` | role:developer |
| DELETE | `/projects/:projectId/runner-device-keys/:deviceKeyId` | role:developer |
| GET | `/projects/:projectId/proficiency` | role:viewer |
| DELETE | `/projects/:projectId/proficiency/me` | role:viewer |
| POST | `/projects/:projectId/proficiency/me/opt-in` | role:viewer |
| GET | `/projects/:projectId/psychologist/analyses` | role:viewer |
| GET | `/projects/:projectId/psychologist/status` | role:viewer |
| POST | `/projects/:projectId/runner-ticket` | role:developer |
| POST | `/projects/:projectId/terminal-ticket` | role:viewer |
| GET | `/projects/:projectId/sessions` | role:viewer |
| POST | `/projects/:projectId/sessions` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId` | role:viewer |
| PATCH | `/projects/:projectId/sessions/:sessionId` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve_always` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/deny` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/message` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/messages/:messageId/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/start` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/structured-question/:questionSetId/answer` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agentId/rearm` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/criativo/validate-necessity` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| PUT | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/chat` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/events` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events/:eventId` | role:viewer |
| GET | `/projects/:projectId/sessions/:sessionId/context-summary` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/execution/parallelize` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/handoffs` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs/:handoffId/accept` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/model-binding` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/psychologist/reanalyze` | role:maintainer |
| POST | `/projects/:projectId/sessions/:sessionId/readiness` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/response-language` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/response-language` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/socket-ticket` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/token-usage` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/transition` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/reopen` | role:developer |
| POST | `/projects/:projectId/tasks/:taskId/gates/:gate/resume` | role:developer |
| GET | `/projects/:projectId/spend/me` | role:viewer |
| POST | `/projects/:projectId/stories/:storyId/return` | role:developer |
| PATCH | `/projects/:projectId/stories/:storyId/title` | role:developer |
| POST | `/projects/:projectId/stories/:storyId/archive` | role:developer |
| POST | `/projects/:projectId/stories/promote` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| GET | `/workspaces/:workspaceId/members` | role:viewer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| DELETE | `/workspaces/:workspaceId/members/:userId` | role:owner |
| PUT | `/workspaces/:workspaceId/owner-of-record` | role:owner |
| PUT | `/workspaces/:workspaceId/tool-router` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/credential-spend` | role:owner |
| GET | `/workspaces/:workspaceId/spend-report` | role:owner |
| GET | `/workspaces/:workspaceId/huggingface/models` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests/:id/confirm` | role:maintainer |
| GET | `/workspaces/:workspaceId/huggingface/pull-requests/:id` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/activate` | role:owner |
| GET | `/workspaces/:workspaceId/models/catalog` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/sync` | role:owner |
| POST | `/workspaces/:workspaceId/models/uses` | role:owner |
| GET | `/workspaces/:workspaceId/models/:modelId/price-changes` | role:maintainer |
| PATCH | `/workspaces/:workspaceId/models/:modelId/pricing` | role:owner |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-base` | role:maintainer |
| GET | `/workspaces/:workspaceId/project-folders` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-status` | role:viewer |
| GET | `/workspaces/:workspaceId/projects-summary` | role:viewer |
| GET | `/workspaces/:workspaceId/summary` | role:viewer |
| POST | `/workspaces/:workspaceId/unread-events` | role:viewer |
| GET | `/workspaces/:workspaceId/containers` | role:viewer |
