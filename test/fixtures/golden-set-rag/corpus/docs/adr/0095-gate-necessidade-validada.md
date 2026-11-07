# ADR 0095 — The `necessidade-validada` gate closes with a separate human confirmation, not with the Creative self-validating

- **Status:** Accepted
- **Date:** 2026-08-17
- **Context:** fluxo.yml × code audit (Wave 6/last, item B2,
  `docs/explanation/auditoria-fluxo-vs-codigo.md`, section D)
- **Extends:** [ADR 0054](0054-gates-como-registro-declarativo.md) (owner
  of the `docs/gates.yml` design)
- **References:** `docs/explanation/modelo-de-time.md` — the anti-pattern
  motivating this decision was already recorded there as a pending item

## Context

`docs/fluxo.yml` (`criativo` role) declares `gate_saida: { id:
necessidade-validada, status: proposto }` since ADR 0085 (fluxo v3). The
gate never really existed: there's no entry in `docs/gates.yml`, nor any
mechanism in code. `docs/explanation/modelo-de-time.md` already recorded
why it stayed stalled, in the "Proposals pending decision" list:

> Anti-pattern of the Creative acting as the real validator of the
> `necessidade-validada` gate.

The anti-pattern is this: the Creative is the agent that PRODUCES the
business need (via `emit_artifact`/`confirm_readiness`, consolidated into
an `artifact.product_brief`). If the model itself decided when that need
is "validated" — for example, inferring readiness from the conversation —,
the gate would be the author grading himself, not a real checkpoint. A
gate with no independent verification measures nothing; it just pretends
to measure.

### What already exists and is NOT this

- **`confirm_readiness`/RN-142** — the structural floor: refuses when ZERO
  business rules have been captured in the session (`CriativoServer`,
  `handle_call(:confirm_readiness, ...)`). It's a check of FORM (does
  content exist?), not of MERIT (is the content right?). It keeps working
  exactly as it is — this ADR doesn't touch it.
- **`AcceptHandoffUseCase`** — the PO accepting the handoff is structural:
  it transitions the handoff to `accepted` and activates the destination
  agent. It doesn't judge the CONTENT of what it's accepting; it's the
  same generic mechanism every handoff uses (QA accepting from dev, Dev
  Lead accepting from the Architect, etc.). Treating that acceptance as
  "validating the need" would silently repurpose an event that means
  something else.

Neither one is a merit gate. What's missing is a third, deliberate
mechanism.

## Decision

**The gate closes with an explicit click, SEPARATE from the user** — the
same interaction pattern as "Confirm architecture ready"
([RN-160](../business-rules/autenticacao.md#rn-160)): a dedicated button in
`SessionPage.tsx`, a dedicated HTTP route
(`POST .../agents/criativo/validate-necessity`), a dedicated use case
(`ValidateNecessityUseCase`) that writes the domain event
`necessity.validated` ([RN-406](../business-rules.md#rn-406)).

### Sequencing: after `confirm_readiness`, not in parallel with it

Two orderings were reasonable: (a) the validation button only enables
AFTER `confirm_readiness` has already run (the `product_brief` exists); or
(b) the two buttons coexist, each with its own precondition, with no
ordering relationship between them.

Option (a) was chosen. The decisive argument: **it makes no sense to
"validate" a `product_brief` that hasn't been consolidated yet** —
`necessidade-validada` is an OUTPUT gate of the Creative in
`docs/fluxo.yml`, the moment his work has already produced a concrete
artifact for the user to judge. Option (b) would allow validating the need
BEFORE the executive summary representing it even exists, which would
invert the flow's own order (the need IS the consolidated
`product_brief` — not the free-form conversation that precedes it).
`hasProductBrief` (`events.some(e => e.type ===
'artifact.product_brief')`) is the new button's precondition, in the same
pattern as `hasBusinessRule`/`hasPromotedStory`, which already guard the
two neighboring buttons.

### Why it does NOT signal the engine

Unlike `OfferInfraHandoffUseCase` (RN-160/[ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md)),
which fires `engineClient.offerInfraHandoff`/`offerDevHandoff` because the
CONFIRMATION is what activates the next step, here the Creative→PO handoff
**already happened** inside `confirm_readiness` itself
(`CriativoServer.executar_confirm_readiness/1` calls
`EngineApiClient.create_handoff` even before this gate existed). No agent
is waiting on `necessity.validated` to act — the event is just the record
that a human confirmed the merit of what was already delivered.
`ValidateNecessityUseCase` has no engine port in its constructor, on
purpose: nothing beyond `SessionEventRepository` (read the most recent
`product_brief`) and `AppendSessionEventUseCase` (write).

### `docs/gates.yml`: `warn`, not `block`

`aprovacao_humana: true` (it's literally a human click) and `verificacao:
script` (the validation script can already extract `necessity.validated`
from the event log). But `severidade: warn`: no mechanism in the product
today CHECKS whether this gate has passed before letting the PO continue —
unlike `story-promovida`/`plano-de-adocao` (`block`, because a real code
lock prevents them from being skipped), this gate is a measurement, not a
gatekeeper. Same spirit as the comment already used for `implementavel`:
"born `warn` even once activated". If a blocking mechanism is born later
(e.g., the PO refusing to work without the validation), promoting to
`block` is a new product decision, with its own ADR — not implicit in
this delivery.

## Consequences

**For**

- Closes the LAST of the six waves of the fluxo.yml × code audit plan
  (`docs/explanation/auditoria-fluxo-vs-codigo.md`, section D) — all six
  are closed (waves 3, 4 and 5 had been brought forward out of order by
  ADRs 0089/0090; waves 1 and 2 closed in prior PRs; this is the 6th and
  last).
- `docs/gates.yml` no longer has an `active`-role gate with no
  registration — the last gap of that kind the audit pointed out.
- The mechanism is recognizable: whoever has already read "Confirm
  architecture ready" (RN-160) gets this one for free — the same pattern
  of dedicated button + precondition + dedicated event.

**Against**

- One more click in the Creative's flow, when `confirm_readiness` already
  produces the `product_brief` and the handoff by itself. Accepted: it's
  exactly this extra click that separates "the model decided" from "the
  human validated" — without it, there would be no gate at all, just the
  same old mechanism with a new name.
- The `warn` gate blocks NOTHING from proceeding without it — a project
  can live forever with `necessidade-validada` never triggered, and the
  PO keeps working normally. Accepted on purpose: inventing a hard block
  with no one in the product having asked for one would be the same class
  of error that ADRs 0041/0042/0077 already refuse for
  invented capability/rating — declaring the gate as an honest
  measurement is better than pretending it blocks something it doesn't.

## Alternatives considered

**Reuse `confirm_readiness` — a single button that already counts as
both.** Rejected explicitly by the request that originated this ADR:
`confirm_readiness`/RN-142 is a structural floor ("at least 1 rule was
captured"), not a merit judgment on the CONTENT of the need. Merging the
two would keep the shallow floor disguised as a new gate.

**The Creative (the model) decides on his own, via a new tool call
(`confirm_necessity_validated`).** Rejected: it's the anti-pattern this
ADR exists to avoid — the same agent that produced the `product_brief`
cannot be the one certifying it's correct.

**Treat `AcceptHandoffUseCase` (the PO accepting the handoff) as the
validation.** Rejected: the acceptance is structural and generic to EVERY
handoff in the product; changing what it means just for this origin would
break the "accept = I started working" reading that QA, Infra and Dev
Lead also depend on it having.

**`severidade: block` from the start, blocking the PO until the need is
validated.** Rejected: it would require inventing a blocking mechanism
(e.g., `ActivateAgentUseCase` refusing to activate the PO without
`necessity.validated`) that nobody asked for and that doesn't exist today
for any equivalent gate (`arquitetura-pronta`/RN-160 also doesn't block
anything on the backend beyond re-validating a promoted story). Recorded
as a future possibility, not part of this delivery.

## References

- `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`
- `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`validateNecessityHandoff`)
- `apps/web/src/routes/SessionPage.tsx` (`hasProductBrief`,
  `necessidadeJaValidada`, `handleValidateNecessity`)
- `docs/gates.yml` — gate `necessidade-validada`
- `docs/fluxo.yml` — `criativo` role, `gate_saida`
- [RN-406](../business-rules.md#rn-406)
- [RN-160](../business-rules/autenticacao.md#rn-160) — the interaction pattern copied
- `docs/explanation/modelo-de-time.md` — the anti-pattern that motivated
  the decision (removed from the pending list by this ADR)
- `docs/explanation/auditoria-fluxo-vs-codigo.md` — finding B2, section D
  (Wave 6, last of the plan)
