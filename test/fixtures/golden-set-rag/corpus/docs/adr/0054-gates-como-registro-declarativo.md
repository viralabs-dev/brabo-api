# 0054 — Gates as a declarative registry

## Status

Proposed

## Context

The flow's gates (QA, SecOps, manual story promotion, adoption plan,
manual merge, the proposed_actions pipeline) exist and were validated by
real execution (ADR 0020, 0044–0046), but they're **implicit**: scattered
across agent prompts, engine code, the api's pure rules, and CLAUDE.md
conventions.

The lesson from Phase 10/13 — metrics extracted by script, never
hand-recorded — has no way to be applied to a gate that isn't
enumerable.

[ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) solved the bottom
half of this problem: it put the action decision in the event log, with
the real actor, and made `proposed_action.created` carry the `status` —
which is what distinguishes "the user clicked" from "policy decided on
its own." Without that, measuring gate passage would mean counting events
that didn't exist. This ADR is the top half: saying WHICH gates exist, so
that what 0048 made observable also becomes enumerable.

## Decision

A declarative registry in `docs/gates.yml`, versioned, with a schema:
`id`, flow, owner (agent/area/user), inputs, deliverable, `verificacao`
(script | human), `severidade` (block | warn), `aprovacao_humana`,
`status` (active | planned).

Rules:

- A gate with no verification script is born `warn`; promotion to `block`
  requires the script to exist and to have measured passages (the same
  philosophy as documentation's staged rollout).
- `aprovacao_humana: true` is immutable by product configuration on the
  gates the constitution declares manual (merge to protected, story
  promotion in manual mode, adoption plan, action decision) — guaranteed
  by test, the same way manual merge already is.
- `status: planned` declares a future role's gate without activating it.

### `evidencia`: where the proof lives

A field the original spec didn't foresee, and that the first read of the
code made mandatory: **not every gate can have proof in the event log**.

- `merge-protegida` doesn't emit its own event. It's a cap applied last
  on top of an already-computed verdict (`decide.ts`), which downgrades
  `auto_approve` to `require_approval`; the outcome shows up as a pending
  `proposed_action.created`, indistinguishable from any other pending
  item. What guarantees the lock is a **test**.
- `backmerge` lives entirely outside the application: it's a required PR
  check, with state versioned in `.release/gate.json` on `main`.

Without this field, the rule "gate `active` + `block` with no evidence in
the log fails" would turn both of these red forever — and they're the
product's hardest locks. Each gate then declares
`evidencia: event_log | teste | ci` with the locator alongside it (event
types and payload filter, spec path, or workflow). The script only cross
checks the event log for whoever declares it; for `teste` and `ci` it
just confirms the target exists.

The alternative — downgrading both to `warn` — was rejected for lying
about the real severity, which is exactly what the registry exists to put
an end to.

### The repository's gates come in too

`backmerge`, `pr-no-lugar-certo`, `aprovacoes-da-escada`, and
`promocao-conferida` (ADR 0030) are gates by the same criterion as the
rest: they have an owner, an input, a deliverable, mechanical
verification, and severity. And they're the ones that reject PRs most
often, day to day. Including only `backmerge` would be arbitrary — they're
the same family (pure script + workflow + spec).

`aprovacoes-da-escada` is the only CI gate with `aprovacao_humana: true`:
what it measures is people approving, by role. A gate registry that
omitted precisely the gate that counts human signatures would omit the
most obvious one.

The limit: the registry is an **index**, not policy. Who governs branches
remains `docs/explanation/branching-policy.md`; `entrada` and
`entregavel` are one sentence, and `onde` points to the script. The YAML
never reproduces the rule — if it did, it would become the second source
of truth it exists to avoid.

### The filter matters as much as the type

`qa-verificada` and `secops-segura` **are not two event types**: both
record `pr.gate_changed`, discriminated by `payload.gate`. And the same
type is recorded at the gate's OPENING, with no `veredito`. A registry
that kept only the type name would count opening as passage, and would
measure double what actually happened. That's why `evidencia` carries the
payload filter, not just the type.

For the same reason, the verdicts on infra PRs are **two** gates
(`infra-qa-verificada` and `infra-secops-segura`): `infra.gate_changed`
also discriminates by `payload.gate`, and merging them would report one's
passage as if it were the other's. The test asserts that no pair
(`event_types` + `filtro`) repeats in the registry — it's that uniqueness
that makes the measurement mean something.

## Alternatives considered

- **Keep it implicit in the prompts:** rejected — not measurable.
- **A database table instead of YAML:** rejected for now — gates change
  via reviewed PR, not at runtime; this follows the precedent of
  `.docmap.yml` and the versioned rulesets (ADR 0030). Migrating to a
  database becomes trivial with the loader as the boundary.

## Consequences

- The approval-ladder's community mode (backlog) becomes a change of
  values in `aprovacao_humana`, not a rewrite of agents.
- Dev Lead (ADR 0053) and Platform/SRE gain an entry contract: once
  they're implemented, their gate is already specified as `planned`.
- The registry is born knowing about gates the original list had
  forgotten — QA/SecOps's verdict on **infra** PRs, which has its own path
  (`infra.gate_changed`) because there's no backlog task behind it.
  Enumerating finds what was left out of the count: it's the registry's
  first dividend, before it even measures anything.
- And it finds a gap: `promocao-conferida` is a required check with
  **no spec of its own**, unlike `pr-police` and `approval-ladder`. Its
  evidence points to the script instead of the test, with the gap written
  right there. It goes to 13c's triage as an item, not fixed here — the
  phase declares and measures, it doesn't repair.

## References

- [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) — the decision in
  the event log, without which there would be nothing to measure
- [ADR 0020](0020-destravar-gates-qa-secops.md) — gates validated by real
  execution
- [ADR 0030](0030-politica-de-branches-mecanizada.md) — versioned
  rulesets, the precedent for configuration in a file
- `docs/gates.yml` — the registry
