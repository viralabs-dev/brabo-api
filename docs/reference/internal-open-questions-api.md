---
idioma_original: en
---

# Internal API (engine to api)

Routes under `/internal/*` are called only by the engine with the shared service token (`X-Brabo-Service-Token`). The full route inventory is in [security-surface.md](../security-surface.md).

## Open questions

### `POST /internal/projects/:projectId/open-questions/:questionId/answer`

An agent closes an open question the user answered in chat ([RN-1002](../business-rules/api.md#rn-1002)).

Body: `{ sessionId: string, agentId: string, resposta?: string, messageEventId?: string }`.

| Status | Body | When |
|---|---|---|
| 200 | `{ status: "answered", questionId }` | closed now |
| 200 | `{ status: "already_answered", questionId }` | already closed (idempotent, never 409) |
| 400 | | invalid body, or no `resposta` and the question has no suggestion |
| 404 | | question not in this project, or `sessionId` not in this project |

Writes the same `decision_record` + `open_question.answered` pair as the human answer and resumes the parked QA gate of the affected tasks. Without `resposta`, the question suggestion is the answer.
