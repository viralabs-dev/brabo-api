# ADR 0084 — Social login (GitHub/GitLab), revising the ADR 0031/0032 backlog

## Context

ADR 0031 (first-party auth) and ADR 0032 (Keycloak cutover) explicitly put
**social login** on the conscious backlog: "Keycloak offered them and they
weren't used; reimplementing them now would pay the cost without the
demand." `CLAUDE.md` turned that decision into a permanent prohibition —
"Do not implement (…) social login" — and `docs/explanation/backlog.md`
kept the item as an open pending issue since PHASE 13c.

The product owner explicitly requested this front, aware of the security
consequences involved, and so the prohibition was revoked FOR THIS FRONT
ONLY — not retroactively for MFA, an OIDC provider, or federation, which
remain out of scope (see Consequences).

The product already has TWO pieces of the mechanism, for two different
purposes:

1. **First-party auth** (ADR 0031/0032): `EmitirSessaoUseCase` packages the
   access (Ed25519, short-lived) + refresh (opaque, rotation with family)
   pair after identity has already been resolved — used today by
   `LoginUseCase` and `RegisterUseCase`.
2. **GitHub/GitLab OAuth** (Phase 2, ADR 0059): `GitOauthClient`
   (`buildAuthorizeUrl`/`exchangeCode`), `GitOauthClientRegistry`,
   `signOauthState`/`verifyOauthState` signed by `GIT_OAUTH_STATE_SECRET`
   — but for **connecting a git credential to a project for a user who is
   ALREADY AUTHENTICATED** (`StartGitOauthUseCase` requires `projectId`
   and `userId`).

This front's work is to link the two WITHOUT inventing a third session
format or mixing the two `state` purposes.

## Decision

### 1. The session-issuance mechanism is reused, no exception

`SocialLoginCallbackUseCase` ends up calling the SAME `EmitirSessaoUseCase`
that `LoginUseCase`/`RefreshUseCase` use. There is no second token, cookie,
or claim format for whoever enters via GitHub/GitLab — the session of
someone who logs in by password and someone who logs in by OAuth are
**indistinguishable** once issued.

### 2. The OAuth client is reused; the `state` purpose is NOT

`GitOauthClient` gained two new methods —
`buildLoginAuthorizeUrl`/`fetchIdentity` — implemented by the SAME
`GithubOauthClient`/`GitlabOauthClient` used by the git-connection flow.
`exchangeCode` is reused as-is.

What is NOT reused is the `state` signature. `domain/auth/social-oauth-state.ts`
is its OWN module, with a structurally different payload
(`{purpose: 'social_login', provider, nonce, expiresAt}`, without
`projectId` or `userId` — there is no "where" for social login, only
identity) and a PURPOSE discriminant checked BEFORE any other field
([RN-273](../business-rules.md#rn-273)). A `state` from the git CONNECTION
flow, even signed by the SAME key, is not accepted here — and the test
suite proves the direction that mattered (git-connect state →
social-login verifier): accepting that `state` in the LOGIN callback would
have meant logging in as someone else's `userId`, plain privilege
escalation.

The HMAC key remains `GIT_OAUTH_STATE_SECRET` (`resolveOauthStateSecret()`)
— **no new environment variable**. Reusing the key is safe because it's the
structural incompatibility of the payload, not the secret, that separates
the two purposes.

### 3. Minimal, login-specific scope

`buildLoginAuthorizeUrl` requests `read:user user:email` (GitHub) and
`read_user` (GitLab) — never the git-connection flow's `repo`/`api`.
Logging into the account shouldn't grant access to any repository
([RN-277](../business-rules.md#rn-277)).

### 4. New table: `social_identities`

Migration `0047`. A dedicated column on `users` was rejected for the reason
`keycloak_sub` already teaches: one column per legacy provider doesn't
scale to TWO simultaneous providers (a user may log in via GitHub and
GitLab at once). `(provider, provider_user_id)` is unique;
`provider_user_id` is the provider's NUMERIC id, never the login/email —
which can change owners ([RN-276](../business-rules.md#rn-276)). `user_id`
is `NOT NULL`: the link is born in the SAME step that resolves identity,
with no intermediate "identity without owner" state.

### 5. The callback's three decisions, in order

`SocialLoginCallbackUseCase` decides, in this order
([RN-272](../business-rules.md#rn-272)):

1. **Identity already known** (`(provider, providerUserId)` in
   `social_identities`) → direct login.
2. **New identity, email matches an existing account AND the provider
   marks the email as VERIFIED** → link and log in
   ([RN-274](../business-rules.md#rn-274)). Linking is account merging —
   the PROVIDER's verification plays the role the click on the
   verification link plays during password registration, and so, as a
   side effect, an account registered by password and never verified ends
   up with `emailVerifiedAt` filled in after linking
   ([RN-279](../business-rules.md#rn-279)): the provider just proved,
   through an independent path, exactly what that click would prove.
3. **New identity, email matches but is NOT verified** → refuse (`403`).
   An email typed in (unverified) at an OAuth provider is not proof of
   possession — accepting it here would open account takeover: someone who
   owns `someone@company.com` on Brabo didn't ask for a stranger's GitHub,
   with that address merely typed in, to inherit the account.
4. **New identity, no matching account** → provisions a NEW user, **with
   no password** — reusing the SAME "pending" state the Keycloak migration
   already leaves (`users` without a row in `auth_credentials`,
   [RN-278](../business-rules.md#rn-278)). Here the email does NOT need
   to be verified ([RN-275](../business-rules.md#rn-275)): there's no
   existing account to take over, only one to be born, and requiring
   verification would make the common case more expensive without
   protecting anything. `LoginUseCase` and `ResetPasswordUseCase` already
   know how to handle that state — the social account gets "forgot my
   password" for free, with no second mechanism.

### 6. The callback never exposes a token in the URL or body

`GET /auth/oauth/:provider/callback` writes the session cookies
(`definirCookiesDeSessao`, the SAME function used by password login) and
redirects to `WEB_ORIGIN/`. The `access token` doesn't travel in the URL:
the web boot (`restaurarSessao()`, called on EVERY page load,
`apps/web/src/main.tsx`) already exchanges the freshly written refresh
token for an access token — zero new client-side code beyond the two
buttons and the error route alias
([RN-282](../business-rules.md#rn-282)). Failure goes to
`WEB_ORIGIN/login?oauth_error=1`, without detailing the reason — the same
pattern as the git-connection callback ([RN-283](../business-rules.md#rn-283)).

### 7. Reuse of the SAME OAuth app — no new environment variable

`GITHUB_OAUTH_CLIENT_ID`/`_SECRET` and `GITLAB_OAUTH_CLIENT_ID`/`_SECRET`
remain those of the app already registered for git connection. What
changes per flow is the `redirect_uri` (`/auth/oauth/<provider>/callback`
instead of `/git/oauth/<provider>/callback`) and the requested `scope` —
both decided at request time, not configuration time
([RN-281](../business-rules.md#rn-281)). **Operator action is still
required**: the second callback URL needs to be registered in each
provider's OAuth app (documented in `.env.example`) — it's this
requirement, not a new env var, that justifies the branch being born
`breaking/`.

## Consequences

- **Two new public routes** (`GET /auth/oauth/:provider/start`,
  `GET /auth/oauth/:provider/callback`), justified in
  `docs/security-surface.md` and covered by `route-surface.spec.ts` — the
  public surface goes from twelve to fourteen routes.
- **`social_identities` is a NEW table**, with no soft delete and no
  history: unlinking an identity (revoking GitHub/GitLab access while
  keeping the account) has no UI or route in this front — backlog.
- **Only GitHub and GitLab.** No generic OIDC provider, no SAML
  federation — the ADR 0031/0032 backlog remains valid for **MFA**,
  **generic OIDC federation**, and **the api as an OIDC provider**. What
  this ADR revises is ONLY the "social login" item on that list, and only
  for the two providers that already have a registered `GitOauthClient`.
- **`emailVerified` depends on the provider telling the truth.** GitHub
  splits email from verification across two calls (`/user` and
  `/user/emails`); GitLab embeds verification in the ACCOUNT's
  `confirmed_at`. The two are treated as equivalent by product decision —
  neither is auditable on Brabo's side beyond trusting the provider's
  response.
- **A social-only account never goes through the password login's lockout
  bucket** (RN-030/031): there's no password attempt to contain. What
  contains it is the OAuth handshake itself, on the provider's side.
- **`CLAUDE.md` needs to lose the phrase "Do not implement (…) social
  login"** from the "What NOT to do" section — not edited by this ADR (left
  for the wave's closing PR, along with the other fronts).
