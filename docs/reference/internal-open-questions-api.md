# API interna (engine para api)

As rotas sob `/internal/*` são chamadas só pelo engine, com o token de serviço compartilhado (`X-Brabo-Service-Token`). O inventário completo das rotas está em [security-surface.md](../security-surface.md).

## Perguntas em aberto

### `POST /internal/projects/:projectId/open-questions/:questionId/answer`

Um agente fecha uma pergunta em aberto que o usuário respondeu no chat ([RN-1002](../business-rules/api.md#rn-1002)).

Corpo: `{ sessionId: string, agentId: string, resposta?: string, messageEventId?: string }`.

| Status | Corpo | Quando |
|---|---|---|
| 200 | `{ status: "answered", questionId }` | fechada agora |
| 200 | `{ status: "already_answered", questionId }` | já estava fechada (idempotente, nunca 409) |
| 400 | | corpo inválido, ou sem `resposta` e a pergunta não tem sugestão |
| 404 | | pergunta fora deste projeto, ou `sessionId` fora deste projeto |

Grava o mesmo par `decision_record` + `open_question.answered` da resposta humana e retoma o gate de QA estacionado das tarefas afetadas. Sem `resposta`, a sugestão da pergunta é a resposta.
