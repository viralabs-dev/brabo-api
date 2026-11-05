---
id: llm-providers
title: Providers LLM
sidebar_position: 9
description: Единый контракт, делающий Ollama, OpenAI и Anthropic взаимозаменяемыми, с capabilities по provider и по модели, синхронизацией каталога, жизненным циклом модели, нормализованными ошибками и потолком бездействия.
keywords: [LLM, provider, OpenAI, Anthropic, Ollama, capabilities, tool calling, streaming, каталог, цена]
traducao_de: c416f2b0423a85b6939818014c69cb25bb5f2fa6
---

# Providers LLM

Каждый агент и каждый чат Brabo говорит с моделью через единый контракт.
Вызывающий не знает, что на другой стороне: Ollama на диске, API OpenAI или
API Anthropic, — и не должен знать.

Решено в [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md),
с потолком бездействия, унаследованным от [ADR 0020](../adr/0020-destravar-gates-qa-secops.md).

## Контракт

`LLMProvider` (`apps/api/src/application/ports/llm-provider.port.ts`) имеет одну
ОБЯЗАТЕЛЬНУЮ операцию, и она всегда потоковая:

```ts
abstract class LLMProvider {
  abstract readonly name: LLMProviderName;
  abstract readonly capabilities: LLMProviderCapabilities;
  abstract chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk>;

  /** Only when `capabilities.listModels` (Phase 9c). */
  listModels?(apiKey?: string): Promise<ModeloDoCatalogo[]>;
  /** Only when `capabilities.embeddings` (ADR 0075). */
  embed?(
    inputs: readonly string[],
    options: EmbeddingOptions,
  ): Promise<EmbeddingResult>;
}
```

Обе необязательные операции следуют одному **двустороннему** контракту: кто
объявляет capability, реализует метод, а кто не объявляет — не выставляет его.
Потребитель деградирует, проверяя capability, а не обнаруживая её по сбою.

Отдельного метода для tool calling или подсчёта токенов нет: инструменты идут в
`options.tools`, и всё возвращается тем же потоком, как один из четырёх типов
`ChatStreamChunk`.

| chunk | когда |
| --- | --- |
| `text_delta` | фрагмент сгенерированного текста |
| `tool_calls` | модель запросила инструменты (один chunk, не инкрементальный) |
| `usage` | подсчёт токенов с пометкой `estimated`; и, когда ответ это сообщает, реальная стоимость (`costMicros`), модель, которая обслужила (`resolvedModel`), id ответа (`generationId`) и ЧАСТИ подсчёта токенов из кэша/рассуждения (`cachedInputTokens`, `reasoningTokens`, RN-666) — [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md) |
| `error` | сбой, классифицированный по `code` — **никогда не исключение** |

Сбой становится chunk, а не исключением, потому что ход уже потратил токены:
metering должен произойти, даже когда ответ не пришёл.

## Capabilities: два слоя

**Слой provider** — потолок того, что умеет этот backend. **Слой модели** — то,
что умеет эта строка таблицы `models`. Модель может быть беднее provider, но
никогда не богаче.

| capability | где хранится | для чего |
| --- | --- | --- |
| `streaming` | provider + `models.supports_streaming` | — |
| `toolCalling` | provider + `models.supports_tool_calling` | отклонять binding агента ([RN-040](../business-rules/api.md#rn-040)) |
| `listModels` | только provider | включать/пропускать синхронизацию каталога ([RN-043](../business-rules/api.md#rn-043)) |
| `embeddings` | provider + `supportsEmbeddings` в строке каталога | разрешать/отклонять вызов embedding ([RN-190](../business-rules/api.md#rn-190)) |
| `promptCaching` | provider + фильтр модели в hook конфигурации (`anthropic/*` в OpenRouter) | помечать `cache_control` на стабильном префиксе ([RN-892](../business-rules/api.md#rn-892)); `true` только в OpenRouter, доказано smoke 2026-10-15 |
| `context_length` | `models.context_window` | бюджет контекста |
| `vision` | `models.supports_vision` | фильтровать каталог ([RN-056](../business-rules/api.md#rn-056)) |
| `reasoning` | `models.supports_reasoning` | то же |
| `image output` | `models.generates_image` | то же |

### Три грани модальности

`supports_vision`, `supports_reasoning` и `generates_image` — **факт
provider**: они берутся из удалённого каталога при синхронизации, с тем же
fallback, что и tool calling, — удалённое, затем локальное, затем `false`.
Сегодня их публикует только OpenRouter:

| грань | откуда берётся в OpenRouter | в каталоге от 2026-08-04 |
| --- | --- | --- |
| `supports_vision` | `architecture.input_modalities` содержит `image` | 181 из 338 |
| `generates_image` | `architecture.output_modalities` содержит `image` | 11 из 338 |
| `supports_reasoning` | `supported_parameters` содержит `reasoning` | 213 из 338 |

Принимать изображение и **создавать** изображение — разные оси: прочитать
диаграмму и нарисовать её решают разные задачи.

Парсер **опускает** поле, когда provider не объявляет модальность, и
`undefined` сохраняет локальное значение при синхронизации — отсутствие
объявления не есть объявление отсутствия. Поэтому экран использует грани только
как положительный фильтр: `false` означает «provider не объявил», а не «модель
не умеет» ([ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)).

:::caution Это НЕ покрывает «лучше для кода»
Ни один каталог provider не публикует, для чего модель хороша. Это кураторство
того, кто эксплуатирует систему, и оно хранится в `workspace_models.uses`, по
workspace ([RN-057](../business-rules/api.md#rn-057)) — это не capability, и
выводить её из имени модели было бы догадкой, переодетой в данные.
:::

<!-- BEGIN:GENERATED:providers-capabilities -->

> ⚠️ Блок сгенерирован `pnpm docs:generate`. Не редактируйте вручную — следующая сборка его перезапишет.

Прочитано из литералов `capabilities` в `apps/api/src/infrastructure/llm/` — провайдеров: **11**.

| провайдер | streaming | tool calling | list_models | embeddings | предпочтение маршрутизации | учётные данные | происхождение моделей | особенности кратко | источник |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `9router` | да | да | да | нет | нет | API-ключ | sync | URL por instalação; Credencial obrigatória; Preço = curadoria manual; Capabilities `false`; Usage corrigido; Token Saver desligado; Raciocínio redigido no OAuth do Claude; Camuflagem das ferramentas no OAuth do Claude; Qual upstream serviu | `apps/api/src/infrastructure/llm/nine-router-provider.ts` |
| `anthropic` | да | да | да | нет | нет | API-ключ | sync + seed | — | `apps/api/src/infrastructure/llm/anthropic-provider.ts` |
| `bitdeer` | да | да | нет | нет | нет | API-ключ | seed | `Authorization: Bearer <chave>` CONFIRMADO; `GET /v1/models` existe e é autenticado; Três ids REAIS de modelo confirmados; Nenhuma peculiaridade de stream/erro confirmada | `apps/api/src/infrastructure/llm/bitdeer-provider.ts` |
| `deepinfra` | да | да | да | нет | нет | API-ключ | sync + seed | O catálogo é PÚBLICO — sem autenticação nenhuma; `stream_options.include_usage` confirmado como suportado; Erro no formato padrão | `apps/api/src/infrastructure/llm/deepinfra-provider.ts` |
| `nvidia-nim` | да | да | да | нет | нет | API-ключ | sync + seed | Sem cabeçalho dedicado; Tool calling é POR MODELO, não por API; `stream_options.include_usage` não confirmado | `apps/api/src/infrastructure/llm/nvidia-nim-provider.ts` |
| `ollama` | да | да | да | да | нет | нет (локально) | sync + seed | — | `apps/api/src/infrastructure/llm/ollama-provider.ts` |
| `openai` | да | да | да | нет | нет | API-ключ | sync + seed | — | `apps/api/src/infrastructure/llm/openai-provider.ts` |
| `opencode-zen` | да | нет | нет | нет | нет | API-ключ | seed | Sem teste de conexão da credencial; Capabilities `false` | `apps/api/src/infrastructure/llm/opencode-zen-provider.ts` |
| `openrouter` | да | да | да | нет | да | API-ключ | sync | Cabeçalhos próprios; Id de modelo prefixado pelo upstream; Catálogo com preço na própria linha; Erro NO MEIO do stream; Custo real em `usage.cost`; Alias de roteamento livre (`~…`) é sincronizado mas não pode ser curado | `apps/api/src/infrastructure/llm/openrouter-provider.ts` |
| `together` | да | да | да | нет | нет | API-ключ | sync + seed | Unidade de preço NÃO documentada explicitamente pela Together; Ids com namespace; `stream_options.include_usage` não confirmado; 429 leva `error_type: dynamic_request_limited \| dynamic_token_limited` | `apps/api/src/infrastructure/llm/together-provider.ts` |
| `vultr` | да | да | нет | нет | нет | API-ключ | seed | Tool calling CONFIRMADO com exemplo real; Sufixo `-normalize` | `apps/api/src/infrastructure/llm/vultr-provider.ts` |

Провайдер без `list_models` ПРОПУСКАЕТСЯ синхронизацией каталога, с причиной
в отчёте — это никогда не считается «каталог вернулся пустым».
«Происхождение моделей»: `sync` находит сам, `seed` приходит только через
`apps/api/src/db/seed.ts`, `sync + seed` — оба (seed лишь начальная загрузка
до первой синхронизации). «Особенности кратко» — это жирные МЕТКИ из
раздела провайдера ниже; объяснение каждой живёт там, а не здесь.
«embeddings» — возможность из ADR 0075, и она `да` только с ДОКАЗАТЕЛЬСТВОМ
выполнения: чтение документации не считается, а причина каждого `нет` — в
комментарии к литералу, в файле из последнего столбца.
«предпочтение маршрутизации» — возможность из ADR 0166 (хаб выбирает upstream
по `price`, `throughput` или `latency`), по тому же правилу: `да` только после
smoke-теста против реального API, вернувшего выбранный upstream.
<!-- END:GENERATED:providers-capabilities -->

Значение по умолчанию `supports_tool_calling` — `false`. Это намеренно: модель,
обнаруженная автоматической синхронизацией (Фаза 9c), входит без обещания,
которое никто не проверял. Модели seed объявляют capability явно, и migration
`0026` делает тот же backfill в уже существовавших базах — нацеливаясь на семь
строк seed, а не слепым `UPDATE` по таблице.

:::caution Модель, добавленная вручную
У `models` нет HTTP-endpoint для редактирования: модель добавляют через
`seed.ts` или прямым SQL. В обоих случаях **объявите
`supports_tool_calling`**, если собираетесь привязать эту модель к агенту —
значение по умолчанию `false` приводит к отклонению binding, в том числе когда
на модель указывает `DEMO_QA_MODEL` в демонстрационных скриптах gate.
:::

## Каталог моделей: обнаружение и жизненный цикл

Кто объявляет `listModels`, умеет перечислять собственный каталог. База
совместимости реализует `GET /models` того диалекта, на котором она уже
говорит, с парсингом, заменяемым через конфигурацию (`parseCatalogo`), — hub
возвращает цену и окно в той же строке, и это не может стать `if` внутри
стандартного парсинга.

**Ollama и Anthropic теперь объявляют `true`** — backlog, который
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
оставил открытым. Они объявляли `false` не из-за отсутствия endpoint, а потому
что формат не был сверен с официальной документацией, а правило — не
программировать против угаданного контракта. Оба формата были сверены до того,
как была написана хоть одна строка кода:

- **Anthropic** — `GET /v1/models` возвращает
  `{ data: [{ id, display_name, max_input_tokens, ... }], has_more, last_id }`,
  с пагинацией **по курсору** (не по offset): `last_id` становится `after_id`
  следующей страницы, с `limit` от 1 до 1000. Страницы обходит
  `client.models.list` официального SDK, который сам пагинирует, — переписывать
  цикл курсора вручную значило бы переписывать код, поддерживаемый поставщиком.
  Цена **не приходит** в ответе, поэтому модель входит без цены, а не с
  выдуманной.
- **Ollama** — `GET /api/tags` возвращает `{ models: [{ name, model, size, ... }] }`
  на локальном хосте (`OLLAMA_HOST`, по умолчанию `http://localhost:11434`).
  Без цены, как и подобает локальному runtime.

Оба БРОСАЮТ исключение при ошибке, как требует контракт: пустой список
реконсиляция прочитала бы как «всё пропало» и сделала бы весь каталог
недоступным ([RN-043](../business-rules/api.md#rn-043)).

### Две независимые оси доступности

У модели два НЕЗАВИСИМЫХ состояния, и их смешение было дырой, которую закрыла
Фаза 9c:

| где | кто пишет | что означает |
| --- | --- | --- |
| `workspace_models.is_active` | **owner этого workspace**, через экран кураторства | появляется в селекторе и может получить новый binding |
| `models.availability` | **синхронизация**, сама | `unavailable` = исчезла из каталога provider |

Модель может быть активной И недоступной одновременно — именно это наложение
порождает предупреждение на экране. Когда provider возвращает её, выбор owner
остаётся в силе: синхронизация никогда не включает обратно то, что кто-то
намеренно выключил.

Обе оси перестали жить в одной таблице в
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md). Кураторство —
**по workspace**: `models.is_active` была колонкой всей установки, и owner
workspace A, включая модель, включал её и для B
([RN-052](../business-rules/api.md#rn-052)). В `models` осталось то, что
является фактом provider: имя, цена, capabilities и доступность, одинаковые для
всех.

**Отсутствие строки в `workspace_models` ЕСТЬ «выключено».** Отдельного
состояния «никогда не решалось» нет, и именно так RN-043 продолжает действовать
без какой-либо колонки, которую синхронизация могла бы затереть.

### Третья ось: для чего workspace использует модель

`workspace_models.uses` хранит кураторство ПО ИСПОЛЬЗОВАНИЮ — `codigo`,
`documentacao`, `analise`, `imagem`, `conversa` — закрытый словарь в
`apps/api/src/domain/llm/model-uses.ts`. Этого не публикует ни один каталог:
provider объявляет capability, но какая модель хорошо работает с кодом **для
этой команды**, выясняется только использованием.

Она не смешивается с `is_active`:

- отметка использования **не включает** модель — новая строка рождается с явным
  `is_active = false`, вопреки DEFAULT `true` колонки;
- смена использования **не выключает** то, что было включено;
- список **заменяет** предыдущий (пустой список снимает все отметки).

Маршрут: `POST /workspaces/:workspaceId/models/uses`, `owner`
([RN-057](../business-rules/api.md#rn-057)).

### Три правила реконсиляции

1. **Новая модель входит НЕАКТИВНОЙ** — без строки кураторства ни в одном
   workspace. В каталоге сотни строк; вывалить их все активными сделало бы выбор
   невозможным и включило бы дорогую модель без чьего-либо решения.
2. **Исчезнувшая модель становится `unavailable`, никогда не удаляется.**
   `model_bindings` и `token_usage` ссылаются на строку; удаление унесло бы с
   собой историю затрат.
3. **Сбой provider ничего не делает недоступным.** 401 означает «не знаю, что
   там есть», а не «там ничего нет» — пометить всё исчезнувшим из-за отозванного
   ключа разом обрушило бы каждый binding этого provider. Provider ПРОПУСКАЕТСЯ,
   с источником сбоя (`infra` | `modelo`) в отчёте.

### И два правила реконсиляции цены

4. **`manual_pricing` побеждает удалённый каталог.** Строка с такой пометкой
   содержит число, которое кто-то ввёл по документации provider, и
   синхронизация его не трогает — даже когда каталог приносит собственную цену
   ([RN-051](../business-rules/api.md#rn-051)).
5. **Каждое изменение цены, сделанное синхронизацией, оставляет строку в
   `model_price_changes`**, с источником `sync` и пустым `changed_by`
   ([RN-044](../business-rules/api.md#rn-044)).

НОВАЯ модель, обнаруженная синхронизацией, рождается с `manual_pricing = false`,
когда каталог сообщил цену — источник синхронизация, и именно она поддерживает
строку в актуальном состоянии. Обнаруженная БЕЗ цены, рождается с `true`: строка
ждёт, что кто-то введёт цену, и пометка уже защищает это число от первого
каталога, который случайно сообщит цену.

### Каскад перепроверяет capability при спуске по уровням

`resolveBinding` пропускает недоступного кандидата и следует приоритету. Когда
ход несёт инструменты, он также пропускает того, кто не умеет tool calling, **на
каждом уровне** — без этого fallback агента приземлился бы на модель только для
чата и молча нарушил бы [RN-040](../business-rules/api.md#rn-040): сбой
проявился бы позже, в ToolLoop, как «агент остановился сам». Пропущенное
возвращается в `skipped`, и интерфейс это показывает.

Приоритет — `session > agent > area > project > workspace`
([RN-020](../business-rules/api.md#rn-020)). `area` появилась в ФАЗЕ 23: это
УМОЛЧАНИЕ, которое разделяют lead и субагенты его области, а собственный binding
агента — это расхождение, которое его перекрывает; он проходит ту же
перепроверку capability выше, включая требование tool calling
([RN-102](../business-rules/api.md#rn-102)). Области `agent` и `area` стали
ПО ПРОЕКТУ (составной `scope_id`, `<projectId>:<slug|chave>`) — раньше `agent`
был глобальным slug, и один binding действовал для всех проектов
([RN-103](../business-rules/api.md#rn-103), [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)).

Субагент без значения ни на одном уровне (или только с глобальным умолчанием
workspace) наследует РАЗРЕШЁННЫЙ binding lead своей области, и ответ несёт
`herdadoDoLead` с именем lead; `appsec` наследует от `secops`, а `qa-estrategia`
от `qa` ([RN-703](../business-rules/api.md#rn-703)).

### Кто планирует и кто выполняет

Engine планирует (worker Oban, который перепланирует себя,
`MODEL_SYNC_INTERVAL_SECONDS`, по умолчанию 6 ч), а api выполняет, потому что
именно она хранит учётные данные и реестр providers. Кнопка «Обновить каталог»
на экране кураторства вызывает **тот же** use case — двух реконсиляций, которые
могли бы разойтись, нет.

## Цена: действует отныне, никогда задним числом

`token_usage` хранит цену, давшую каждый `cost_micros`
(`input_price_per_million_micros` и `output_price_per_million_micros`).
Историческая стоимость была неизменной ещё до Фазы 9c; не хватало
**воспроизводимости** — без записанной цены `tokens × цена = стоимость`
перестало бы сходиться в тот момент, когда кто-то исправил бы таблицу.

Начиная с [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
([RN-665](../business-rules/api.md#rn-665)) цена каталога является числом
только тогда, когда ответ не несёт реальной стоимости. Когда несёт (`usage.cost`
OpenRouter), она и есть `cost_micros`, две колонки цены хранят НЕЯВНУЮ цену
(`стоимость ÷ tokens`, помеченную `price_implicit`), а то, что взял бы каталог,
идёт рядом в `catalog_cost_micros` — так что `tokens × цена = стоимость`
продолжает выполняться в каждой строке, реальной или оценочной.

Каждое изменение цены записывает строку в `model_price_changes`, append-only, с
парой до/после и источником (`manual` | `sync`). Пара записывается вместе
намеренно: восстановление «до» по предыдущей строке зависело бы от того, что ни
одна запись не ускользнула от аудируемого пути, — а это ровно то, что аудит
существует доказывать.

:::caution Две записи ускользали
Источник `sync` существовал в домене с Фазы 9c, и **ни одна запись его не
производила**: синхронизация меняла цену через `upsert`, вне аудируемого пути.
`seed.ts` делал то же — а он запускается против уже засеянной базы
(`BRABO_FORCE_SEED=1` в `bootstrap.sh` k8s), так что исправление цены в seed
молча меняло число. Оба теперь проходят аудит; seed переиспользует
`UpdateModelPricingUseCase` вместо повторения логики и вызывает его **до**
upsert — после него оба значения уже совпали бы, и аудит счёл бы, что делать
нечего.
:::

:::note Это не событие outbox
`model_price_changes` — собственная таблица, а не строка в `outbox_events`.
`Engine.Outbox.Drain.run_once/0` фильтрует по `aggregate_type == "session"` —
строка цены там навсегда осталась бы с пустым `processed_at` и загрязняла бы
метрику задержки outbox. Это неизменяемый доменный журнал, как `session_events`.
:::

## Embeddings

Вторая операция контракта (ADR 0075) и единственная, кроме `chat`, которая
тратит токены. Существует только там, где `capabilities.embeddings` равно
`true`.

```ts
const { vectors, dimensions, model, inputTokens, estimated } =
  await provider.embed(['primeiro trecho', 'segundo trecho'], {
    model: 'nomic-embed-text',
  });
```

**Это пакет, и порядок — часть контракта.** Индекс получает N фрагментов сразу,
и позиция — единственная связь между входом и вектором. Отсюда самая важная
гарантия: **один вектор на вход или ошибка** — никогда не более короткий список.
Частично отклонённый ответ потом невозможно обнаружить; дефект проявился бы
только в поиске, далеко от причины. По той же причине контракт отклоняет пустой
вектор, разные размерности внутри одного ответа и пустой список входов.

**Ошибка бросается, а не становится chunk.** В `chat` ошибка становится chunk,
потому что ход уже потратил токены и metering должен произойти; здесь нечего
сохранять — либо provider вернул векторы и взял плату, либо не вернул и не
взял. Таксономия `code` точно та же, что в таблице ниже.

| диалект | endpoint | тело ответа |
| --- | --- | --- |
| база, совместимая с OpenAI | `POST /embeddings` | `{ data: [{ index, embedding }], model, usage.prompt_tokens }` |
| Ollama | `POST /api/embed` | `{ model, embeddings: number[][], prompt_eval_count }` |

`index` OpenAI — это связь с входом, и документация **не обещает порядка** —
поэтому база сортирует по нему перед возвратом. Поле `dimensions` в
`EmbeddingOptions` (уменьшить вектор) существует только в OpenAI; Ollama его
игнорирует, а не падает, потому что там размерность определяется моделью, — и
результат всегда объявляет РЕАЛЬНУЮ размерность того, что вернулось.

### Кто векторизует сегодня

| provider | `embeddings` | почему |
| --- | --- | --- |
| `ollama` | **да** | доказано выполнением против daemon 0.32.1 (`nomic-embed-text`, 2 входа → 2 вектора по 768) |
| `anthropic` | нет | **нет** endpoint embedding — документация указывает на третью сторону, то есть другой provider |
| остальные семь | нет | ни один smoke с учётными данными не доказал их endpoint ([приёмка](../explanation/aceite-providers.md)) |

Объявлять по документации — то, что запрещает ADR 0043, и это стоило двух
откатов вживую. ДИАЛЕКТ базы, однако, доказан: контрактный набор запускается
второй раз поверх него с включённой capability — именно это делает дешёвым
перевод provider в `true`, когда ключ появится.

Ollama также единственный, кто публикует слой МОДЕЛИ: `/api/tags` приносит
`capabilities: ["embedding"]` и `details.embedding_length` в каждой строке, и
отсюда берутся `supportsEmbeddings` и `embeddingDimensions` в каталоге. Чат-модель,
у которой просят embedding, получает **`501`** от daemon — причина, по которой
проверка выполняется заранее ([RN-190](../business-rules/api.md#rn-190)).

:::note Затраты пока не измеряются
`embed` возвращает `inputTokens`/`estimated`, чтобы питать metering, и
`calculateCostMicros(input, 0, …)` уже работает (у embedding нет выхода в
токенах). Не хватает структурного: `token_usage.session_id` — **NOT NULL**, а
индексация репозитория не происходит внутри сессии. Объявленное ограничение в
ADR 0075 — относится к волне, которая реализует потребителя.
:::

## Нормализованные ошибки

Никто ничего не решает, сопоставляя подстроку сообщения поставщика: решение
принимается по `code` chunk. Классы находятся в
`apps/api/src/domain/llm/llm-provider-errors.ts`.

| статус provider | `code` | означает |
| --- | --- | --- |
| 401, 403 | `auth` | ключ отсутствует, недействителен или без доступа к модели |
| 402 | `insufficient_credit` | у аккаунта provider закончился кредит (RN-730) |
| 404 | `model_not_found` | модели нет у этого provider |
| 429 | `rate_limit` | превышена квота или пропускная способность |
| 413 или 400 с маркером контекста | `context_length` | prompt не помещается в окно |
| — | `timeout` | provider **молчал** дольше потолка бездействия |
| — | `connection` | до provider даже не дошло |
| любой другой | `upstream` | сбой на другой стороне по иной причине |

400 становится `context_length` только когда тело несёт известный маркер
(`context_length_exceeded` и варианты). Сопоставление по маркеру хрупко, поэтому
413 — однозначный — идёт первым, а 400 без маркера падает в `upstream`, вместо
того чтобы лгать о причине.

## Потолок бездействия {#inactivity-ceiling}

Потолок касается не общей длительности, а **молчания**. Легитимный ход может
длиться долго (модель обрабатывает тысячи токенов prompt до первого токена), но
никогда не молчит. Это урок ADR 0020, где `fetch` сдавался на фиксированных
300 с undici с непрозрачным «fetch failed», а агент записывал «модель
остановилась» для запроса, на который так и не ответили.

| provider | механизм | env |
| --- | --- | --- |
| Ollama | таймаут сокета `node:http` | `OLLAMA_REQUEST_TIMEOUT_MS` |
| база, совместимая с OpenAI | то же | `LLM_REQUEST_TIMEOUT_MS` |
| Anthropic | `withIdleTimeout` поверх потока SDK | `LLM_REQUEST_TIMEOUT_MS` |

У Ollama собственная env, потому что у локальной модели другой порядок
задержки до первого токена.

## База, совместимая с OpenAI

`OpenAICompatibleProvider` реализует диалект `/chat/completions` один раз. От
неё рождаются девять providers: OpenAI (первый экземпляр), OpenRouter (Фаза 11a,
hub) и пять из Фазы 11b — NVIDIA NIM, Together, DeepInfra, Bitdeer, Vultr. Все
меняют `baseUrl`, заголовок аутентификации и флаги — никогда парсинг
(единственное исключение, оказавшееся необходимым, — собственный `parseCatalogo`
каждого, когда capability равна `true`, — см. разделы по providers ниже).

```ts
interface OpenAICompatibleFlags {
  streamOptionsIncludeUsage: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}
```

Поле потолка вывода идёт в КАЖДОМ вызове (RN-734): `options.maxTokens`, когда
вызывающий его задаёт, иначе `MAX_TOKENS_PADRAO` (4096, то же умолчание, что у
provider Anthropic). Без поля OpenRouter резервирует кредит на МАКСИМАЛЬНЫЙ
вывод модели для каждого вызова в полёте и отвечает 402, даже когда реальный
вызов уложился бы в баланс. Ответ, обрезанный этим потолком, пока не
озвучивается: этот диалект не читает `finish_reason: "length"`.

Когда модель рассуждает (`models.supports_reasoning`) и конфигурация provider
имеет `campoDeRaciocinioDesligado` (сегодня только OpenRouter), потолок вывода
становится видимым выводом + `ORCAMENTO_DE_RACIOCINIO` (4096), потому что
рассуждение считается внутри `max_tokens` (RN-741). Никакое поле рассуждения не
отправляется только потому, что модель принимает параметр (RN-782): платное
измерение 2026-10-10 (AT-467) показало, что `reasoning: { max_tokens }` ВКЛЮЧАЕТ
рассуждение у `anthropic/claude-haiku-4.5` (74% вызовов, 2,8x стоимость) и
ИГНОРИРУЕТСЯ `anthropic/claude-haiku-5.5` (1024 запрошено, 8192 потрачено).
Исполнительные dev agents (`dev-<modulo>`, не `dev-lead`) получают
`reasoning: { enabled: false }` (RN-783, решение владельца): 0 из 8 ответов
обрезано, -42% стоимости на Haiku 5.5. Подсказка грани «мышление» каталога
моделей говорит об этом. Прямой provider Anthropic не отправляет `thinking`,
поэтому там модель не рассуждает.

Каждый флаг существует потому, что реальный provider расходится. Не добавляйте
флаг без provider, которому он нужен.

## Нормализованные расхождения {#normalized-divergences}

Три providers проходят один и тот же контракт, но диалекты не идентичны. То, что
расходится, нормализуется, а не скрывается:

| предмет | Ollama | база совместимости | Anthropic |
| --- | --- | --- | --- |
| формат | NDJSON | SSE `data:` | SSE с именованными событиями |
| транспорт | `node:http` | `node:http` | официальный SDK + `withIdleTimeout` |
| ids tool call | не присылает — генерируем мы | присылает; генерируем, если нет | присылает |
| аргументы tool call | уже десериализованы | строка по частям, собирается по индексу | `input_json_delta`, собирается SDK |
| ответ без `usage` | не выдаёт chunk | считает локально с `estimated: true` | **невозможно** — `usage` обязателен в `message_start` |
| роль `tool` | отдельное сообщение | `role: "tool"` + `tool_call_id` | блок `tool_result` внутри хода `user` |
| ответ, обрезанный потолком вывода | не читается | `finish_reason: "length"` → chunk `truncated` | `stop_reason: "max_tokens"` → chunk `truncated` |
| `system` ПОСЛЕ `user`/`tool` | остаётся на месте, последний элемент `messages` | остаётся на месте, последний элемент `messages` | **поднимается**: добавляется к параметру `system` верхнего уровня (соединяется через `\n\n` после уже имеющегося prompt) и удаляется из `messages` |

Строка Anthropic самая дорогая: результаты параллельных вызовов должны прийти в
**одном** ходе `user`, поэтому последовательные сообщения `tool` группируются.

### Сообщение `system` в конце разговора (AT-161) {#a-system-message-at-the-end-of-the-conversation-at-161}

Строка позднего `system` существует, потому что ориентация по языку из AT-081
предусматривает отправку **одного** эфемерного сообщения `role: "system"` в
КОНЕЦ списка в каждом вызове хода — после `user` в первом вызове, после `tool`
в последующих. Контрактный набор отвечает для каждого из девяти providers, куда
это сообщение попадает в **сериализованном теле**: каждый harness объявляет
`posicaoDoSistemaTardio`, и контракт проверяет его в обеих позициях, а также то,
что текст появляется ровно один раз и остальная часть разговора сохраняет
порядок (`apps/api/test/contract/llm-provider.contract.ts`).

| provider | адаптер | куда попадает поздний `system` |
| --- | --- | --- |
| OpenAI, OpenRouter, NVIDIA NIM, Together, DeepInfra, Bitdeer, Vultr | база совместимости (`toWireMessage`) | конец `messages`, `role: "system"` |
| Ollama | собственный (`messages` отправляется как есть) | конец `messages`, `role: "system"` |
| Anthropic | собственный (официальный SDK) | конец `system` верхнего уровня; позиция теряется |

Ни один адаптер его не отбрасывает и не дублирует. Чего фальшивый сервер не
может сказать — принимает ли РЕАЛЬНЫЙ provider такое тело: он принимает что
угодно. Это отдельный ручной smoke,
`apps/api/test/infrastructure/llm/sistema-tardio.smoke.spec.ts`, по одному
`describe` на provider, каждый обусловлен тем же ключом, что и smoke приёмки
(плюс `ANTHROPIC_TEST_KEY`; Ollama — через `OLLAMA_SISTEMA_TARDIO_SMOKE=1`).
Какие уже прогонялись, записано в
[приёмке providers](../explanation/aceite-providers.md). Без такого прогона
provider **не доказан** в отношении приёма позднего `system` — правило ADR
0041/0042.

**Наблюдение, не измерение (пробел 2 из AT-081):** у Anthropic подъём
заставляет ориентацию менять блок `system` верхнего уровня, который идёт ДО
разговора, — так что любое изменение её текста меняет префикс запроса, а с ним
и любой prompt caching, который у префикса был бы. Кэш сегодня в продукте не
наблюдаем (AT-082), поэтому это зафиксировано, но не количественно оценено.

## OpenRouter — первый hub (Фаза 11a)

`OpenRouterProvider` — это `OpenAICompatibleProvider` с `openrouterConfig()`
(`apps/api/src/infrastructure/llm/openrouter-provider.ts`). Он объявляет
`listModels: true` — единственный фрагмент кода, который меняется при включении
capability, это конфигурация; `SyncModelCatalogUseCase` уже заботится об
остальном.

Найденные и протестированные особенности
(`test/infrastructure/llm/openrouter-provider.contract.spec.ts`):

- **Собственные заголовки**: `HTTP-Referer` (из `API_PUBLIC_URL`) и `X-Title:
  "Brabo"` — необязательные по официальной документации (атрибуция/рейтинг на
  сайте OpenRouter), отправляются всегда, потому что ничего не стоят;
- **Id модели с префиксом upstream** (`openai/gpt-4o-mini`,
  `anthropic/claude-3-5-sonnet`): префикс — это ЗАПРОШЕННЫЙ поставщик, а не тот,
  кто ответил, — см. `extrairUpstreamProvider` ниже;
- **Каталог с ценой в той же строке**: `GET /v1/models` возвращает
  `pricing.prompt`/`pricing.completion` как десятичную СТРОКУ в USD **за
  токен**, в отличие от простого стандарта OpenAI только с id `{ data: [{ id }] }`.
  `parseCatalogoOpenRouter` переводит в микро-USD за миллион
  (`* 1e12`, с округлением — колонка `bigint`);
- **Ошибка ПОСРЕДИ потока**: OpenRouter принимает соединение и начинает слать
  текст, ещё не зная, упадёт ли реальный provider за ним, — режим сбоя, которого
  у OpenAI нет, потому что она не маршрутизирует на стороннюю инфраструктуру.
  Кадр приходит как
  `{"error":{"code":"...","message":"..."},"choices":[...]}`; истинное поле
  `error` — это сигнал. Числовой код использует тот же `normalizeHttpStatus`
  базы; строковый код сопоставляется по подстроке (`mapearCodigoDeFrame`) с
  `upstream` как безопасным умолчанием — никогда молчание, даже для кода вне
  карты;
- **Реальная стоимость в `usage.cost`** (ADR 0188, RN-665): последний кадр
  потока несёт то, что взял hub, в USD; `extrairCustoRealOpenRouter` переводит
  её в микро-USD, и metering записывает её как число. При `is_byok: true` поле —
  это комиссия hub, а не инференс, поэтому оно НЕ читается, и строка падает на
  каталог. `model` (датированная версия, в которую разрешился alias вроде
  `~deepseek/deepseek-flash-latest`) и `id` (`gen-…`) читаются базой для любого
  provider этого диалекта;
- **Alias свободной маршрутизации (`~…`) синхронизируется, но не может быть
  отобран кураторством** (AT-271, [RN-679](../business-rules/api.md#rn-679)):
  id вроде `~deepseek/deepseek-flash-latest` всегда перенаправляет на самую новую
  модель семейства, его цена в каталоге — витринная, а счёт приходит от любого
  upstream, обслужившего вызов. Синхронизация оставляет его в каталоге (удаление
  пометило бы `unavailable` уже отобранный); его активация — 422
  `alias_de_roteamento_livre`, а чтение кураторства помечает его
  `freeRoutingAlias`. Активированный до правила остаётся активным и может быть
  выключен — выключенный, не возвращается;
- **Проверка подключения**: `GET /key` (официальная документация) проверяет ключ,
  не тратя токены на настоящий вызов чата. Это первый
  `LLMCredentialConnectionTester` на стороне LLM. Начиная с
  [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) он
  **не запускается при регистрации**: учётные данные шифруются и хранятся без
  оценки, а проверка — явное действие
  `POST /users/me/credentials/{provider}/test` над уже сохранённым ключом.
  Provider без объявленной проверки (сегодня: `ollama`/`anthropic`/`openai`)
  возвращает `nao_suportado` — никогда ложный `ok` ([RN-055](../business-rules/api.md#rn-055)).

Приёмочный тест с реальными учётными данными, которого требует Фаза 11a, —
регистрация, синхронизация, наполняющая каталог, кураторская активация и сессия
чата от начала до конца со стоимостью, зафиксированной в `token_usage`, — это
`test/infrastructure/llm/openrouter-provider.smoke.spec.ts`. Он никогда не
запускается в CI: без `OPENROUTER_TEST_KEY` в окружении весь `describe`
пропускается с предупреждением. Та же схема, что и у smoke git против реального
API (`github-provider.smoke.spec.ts`, `gitlab-provider.smoke.spec.ts`).

## NVIDIA NIM (Фаза 11b)

`NvidiaNimProvider` — это `OpenAICompatibleProvider` с `nvidiaNimConfig()`
(`apps/api/src/infrastructure/llm/nvidia-nim-provider.ts`), направленный на
**хостируемый** endpoint (`integrate.api.nvidia.com`) — не на самостоятельно
размещаемый контейнер, который является другим продуктом с другим адресом.

- **`listModels: false`**: `GET /v1/models` существует (официальная документация
  сверена в этой сессии) и возвращает `id`/`object`/`created`/`owned_by`, но ни
  одна найденная документация не даёт цену за токен — настоящий каталог, но
  бесполезный для стоимости по модели, которую требует metering (capabilities в
  два слоя, ADR 0041). Provider живёт на **ручном seed**
  (`apps/api/src/db/seed.ts`), пока кто-нибудь не подтвердит endpoint цены, если
  он существует;
- **Без отдельного заголовка**: `Authorization: Bearer nvapi-...` — стандартный
  bearer, у ключа лишь префикс `nvapi-` по соглашению NVIDIA;
- **Tool calling — ПО МОДЕЛИ, а не по API**: лишь конкретные модели (Llama
  3.1 70B/405B, варианты Nemotron, ...) действительно его поддерживают — но это
  никогда не флаг конфигурации, это целиком `models.supports_tool_calling`
  (seed/кураторство), подтверждено чтением `buildBody()` в базе: флаг
  `capabilities.toolCalling` решает лишь, отправляется ли параметр `tools`, а не
  умеет ли им пользоваться конкретная модель;
- **`stream_options.include_usage` не подтверждено** для хостируемого endpoint
  (документировано только для самостоятельно размещаемого ПО NIM) —
  `streamOptionsIncludeUsage: false`; fallback `estimated` базы покрывает случай,
  когда поле так и не приходит;
- **Проверка подключения**: без отдельного endpoint проверки (endpoint
  «whoami»/баланса не найден) — `GET /v1/models` с ключом, важен только статус
  (200 против 401/403).

:::info NVIDIA не берёт плату за токен
Поиск официальной цены был повторён и пришёл к ответу лучше, чем «не нашёл»:
**цены за токен, которую можно найти, нет**. Официальная документация
([docs.api.nvidia.com/nim/docs/product](https://docs.api.nvidia.com/nim/docs/product))
говорит, что хостируемый endpoint — это бесплатный доступ для **прототипирования**
для участников Developer Program, а production требует лицензии NVIDIA AI
Enterprise — «These licenses start at $4500 per GPU per year or ~ $1 per GPU per
hour in the cloud.» Единица — GPU/час, а не токен.

Три модели NIM из seed поэтому имеют **оценочную** цену по сравнению с
эквивалентами у других providers и `manual_pricing = true`: этого достаточно,
чтобы у потолка бюджета было что вычитать, и это максимум возможной честности,
пока бизнес-модель поставщика не основана на токенах.
:::

Приёмочный тест с реальными учётными данными находится в
`test/infrastructure/llm/nvidia-nim-provider.smoke.spec.ts`, обусловлен
`NVIDIA_NIM_TEST_KEY`. В отличие от OpenRouter, шаг «синхронизации» ничего не
обнаруживает (capability намеренно `false`) — smoke подтверждает, что provider
выходит с `pulado: 'sem_capability'` в отчёте, и отбирает вручную добавленную
модель, ровно как сделал бы owner в production.

## Together AI (Фаза 11b)

`TogetherProvider` — это `OpenAICompatibleProvider` с `togetherConfig()`
(`apps/api/src/infrastructure/llm/together-provider.ts`).

- **`listModels: true`**: `GET /v1/models` документирован с `pricing:
  {input, output, cached_input, base, hourly, finetune}` — используются только
  `input`/`output`;
- **Единица цены НЕ документирована Together явно**: значения — ЧИСЛА (а не
  строки, как в OpenRouter), и по сравнению с опубликованной рыночной ценой
  (Llama 3.3 70B по US$1,04/1M на together.ai/models — тот же порядок величины,
  что пример `"input": 0.3` официальной схемы) вывод — **USD за МИЛЛИОН токенов
  напрямую**, а не за токен. Подтверждает это против реального ключа smoke (см.
  комментарий в начале `together-provider.smoke.spec.ts`) — если однажды это
  окажется неверным, это находка, которую нужно исправить здесь и в парсере, а
  не замалчивать;
- **Ids с namespace**: `meta-llama/Llama-3.3-70B-Instruct-Turbo` — «сплющенный»
  id в стиле OpenAI (`gpt-4o`) отвечает 404;
- **`stream_options.include_usage` не подтверждено** в документации — то же
  осторожное обращение, что и у NIM, fallback `estimated` покрывает;
- **429 несёт `error_type: dynamic_request_limited | dynamic_token_limited`**
  в теле — отдельно не тестируется, потому что тело остаётся
  `{error: {message}}`, совместимым со стандартным парсингом базы; важно лишь,
  если однажды понадобится различать два вида rate limit;
- **Проверка подключения**: без отдельного endpoint — `GET /v1/models`, только
  статус.

Приёмочный тест с реальными учётными данными находится в
`test/infrastructure/llm/together-provider.smoke.spec.ts`, обусловлен
`TOGETHER_TEST_KEY`.

## DeepInfra (Фаза 11b)

`DeepInfraProvider` — это `OpenAICompatibleProvider` с `deepinfraConfig()`
(`apps/api/src/infrastructure/llm/deepinfra-provider.ts`), `baseUrl`
`https://api.deepinfra.com/v1/openai` (поверхность, совместимая с OpenAI, — у
DeepInfra есть и нативные endpoints вне её, здесь не используемые).

- **`listModels: true`**, подтверждено ВЖИВУЮ в этой сессии против
  `GET {baseUrl}/models` (ТОТ ЖЕ endpoint, который база уже вызывает по
  умолчанию, без необходимого расширения): ответ несёт `metadata.pricing.
  {input_tokens,output_tokens}` (USD за миллион, число — то же соглашение,
  выведенное для Together) и `metadata.context_length` в каждой строке;
- **Каталог ПУБЛИЧНЫЙ — без всякой аутентификации**, подтверждено вживую (вызов
  сработал без заголовка `Authorization`). Это имеет реальное последствие:
  **проверки подключения для DeepInfra нет**
  (`llm-credential-connection-tester.ts` не имеет для неё записи) — недействительный
  ключ обнаружился бы только при первом реальном вызове ЧАТА, никогда при
  регистрации. Другого публично документированного аутентифицированного
  endpoint проверки не найдено;
- **Каталог смешивает чат с изображением/аудио/видео/embedding в ОДНОМ
  списке**, каждый тип со своим форматом `pricing`
  (`per_image_unit`, `input_characters`, `output_seconds`, ...) —
  `parseCatalogoDeepInfra` фильтрует по `metadata.tags.includes('chat')`, прежде
  чем пытаться читать `input_tokens`/`output_tokens`; без фильтра модель
  изображений вошла бы с ценой, сфабрикованной из поля, которое даже не «за
  токен»;
- **`stream_options.include_usage` подтверждено как поддерживаемое** в
  документации (в отличие от NIM/Together) — `streamOptionsIncludeUsage: true`;
- **Ошибка в стандартном формате** `{"error": {"message", "type", "param", "code"}}`
  — совместима со стандартным парсингом базы, без отдельного `parseErrorFrame`.

Приёмочный тест с реальными учётными данными находится в
`test/infrastructure/llm/deepinfra-provider.smoke.spec.ts`, обусловлен
`DEEPINFRA_TEST_KEY` — и это первый smoke, в котором шаг РЕГИСТРАЦИИ ничего не
проверяет; плохой ключ обнаружил бы только шаг ЧАТА.

## Bitdeer (Фаза 11b)

`BitdeerProvider` — это `OpenAICompatibleProvider` с `bitdeerConfig()`
(`apps/api/src/infrastructure/llm/bitdeer-provider.ts`) — самая поверхностная
публичная документация из пяти в этой фазе.

- **`listModels: false`**: никакого формата каталога/цены публично не найдено
  (страница цен рендерится через JS, без примера, доступного неинтерактивному
  поиску) — без сверенного формата нет честного `parseCatalogo`, который можно
  написать. Перепроверено: `bitdeer.ai/en/pricing/ai-models` по-прежнему строит
  таблицу на клиенте (отдаваемый HTML **не** содержит ни одного имени модели), и
  документации цен вне её нет. Цена seed остаётся ОЦЕНОЧНОЙ;
- **`Authorization: Bearer <chave>` ПОДТВЕРЖДЕНО** (реальный пример curl найден
  в документации API embeddings Bitdeer в этой сессии) — даже при том, что для
  остального диалекта примеров нет;
- **`GET /v1/models` существует и аутентифицирован** (401 вживую без ключа,
  подтверждено в этой сессии) — становится проверкой подключения (только
  статус, как у остальных без отдельного endpoint);
- **Три РЕАЛЬНЫХ id модели подтверждены** в примерах конфигурации из блога самой
  Bitdeer (не витринные имена): `moonshotai/Kimi-K2.5`,
  `zai-org/GLM-5`, `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` — засеяны в
  `apps/api/src/db/seed.ts` с ОЦЕНОЧНОЙ ценой (рынок модели/семейства у других
  providers, не подтверждено самой Bitdeer);
- **Ни одной особенности потока/ошибки не подтверждено** — заявление Bitdeer об
  «OpenAI REST API standards» не сопровождалось реальным примером
  `/chat/completions`, поэтому контрактный тест не закладывает никакой
  особенности, которую документация не доказала. Smoke — ПЕРВОЕ реальное
  подтверждение диалекта.

Приёмочный тест с реальными учётными данными находится в
`test/infrastructure/llm/bitdeer-provider.smoke.spec.ts`, обусловлен
`BITDEER_TEST_KEY`.

## Vultr Serverless Inference (Фаза 11b)

`VultrProvider` — это `OpenAICompatibleProvider` с `vultrConfig()`
(`apps/api/src/infrastructure/llm/vultr-provider.ts`) — единственный из пяти, у
которого решение по `listModels` **изменилось в ходе реализации** по сравнению с
исходным планом.

- **`listModels: false`** (исходный план указывал `true`): база ВСЕГДА вызывает
  `{baseUrl}/models` (`openai-compatible-provider.ts`, `listModels()`), а
  официальный справочник самой Vultr (`api.vultrinference.com`) описывает
  `GET /models` как возвращающий только `id`/`created`/`object`/`owned_by`/`features`
  — **без цены**. Endpoint, который документация связывает с ценой
  (`GET /provider`, с `cost`/`contextWindow`), вернул **404 вживую** по
  проверенному в этой сессии пути — данных недостаточно, чтобы написать
  `parseCatalogo`, не рискуя указать на неверный URL («хрупкий true»). Сам
  `GET /v1/models` подтверждён (401 вживую без ключа, дважды) — просто без цены;
- **Tool calling ПОДТВЕРЖДЁН реальным примером**: официальная документация
  (`docs.vultr.com/how-to-use-tool-calling-with-vultr-serverless-inference`)
  показывает `kimi-k2-instruct`, отвечающий с `finish_reason: "tool_calls"` —
  чистый стандартный диалект OpenAI, без странных полей в этом примере; две
  другие засеянные модели (`llama-3.3-70b-instruct-fp8`,
  `deepseek-r1-distill-llama-70b`) не имеют подтверждения tool calling —
  `supportsToolCalling: false` для них;
- **Суффикс `-normalize`**: первоначальное исследование указало на
  документированный нормализующий прокси — переподтвердить эту документацию в
  этой сессии НЕ удалось (направленный поиск не нашёл термин на проверенных
  страницах). По умолчанию он в любом случае не используется (мы сохраняем
  исходный id модели);
- **Проверка подключения**: `GET /v1/models`, только статус.

:::tip Цена Vultr ОФИЦИАЛЬНАЯ, и это единый тариф
В отличие от NIM и Bitdeer, Vultr **публикует** тариф —
[в документации по использованию и стоимости Serverless Inference](https://docs.vultr.com/support/products/serverless/how-do-i-monitor-the-usage-and-cost-of-my-vultr-serverless-inference-subscription):
«Requests are billed at $0.55 per 1,000,000 input tokens and $2.75 per
1,000,000 output tokens.» Это тариф **сервиса**, а не модели — документация не
различает по моделям, и поэтому три строки seed повторяют одну и ту же пару
(`550_000` / `2_750_000` micros).

Оценка, стоявшая там раньше, ошибалась в опасную сторону: `400_000` на
**вывод** у двух из трёх моделей против реальных `2_750_000`. Metering
недооценивал стоимость вывода почти в 7× — а вывод доминирует в счёте агента,
который пишет код.

`manual_pricing` остаётся `true`, и это не противоречие: флаг означает «цена
введена человеком по документации, а не пришла из синхронизации»
(`apps/api/src/db/schema.ts`). Изменилось то, что число теперь — от самого
provider, а не рыночное сравнение.
:::

Приёмочный тест с реальными учётными данными находится в
`test/infrastructure/llm/vultr-provider.smoke.spec.ts`, обусловлен
`VULTR_TEST_KEY`.

## Hubs и реальная стоимость

В **hub** (OpenRouter) в вызове фигурирует hub, но стоит provider, который
фактически обслужил. Metering записывает обоих:

- `ChatUsageChunk.upstreamProvider` — provider заполняет его, когда hub это
  сообщает;
- `token_usage.upstream_provider` — свободный текст, **допускающий null**. Это не
  enum: множество принадлежит hub, меняется без предупреждения, и версионировать
  его не наше дело. `null` означает «пришло не через hub, или hub не сообщил»;
- метрики `brabo_llm_tokens_total` и `brabo_llm_cost_micros_total` получили
  метку `upstream_provider`, а исполнительный dashboard — панель стоимости по
  нижележащему provider. Без hub метка повторяет сам provider — с пустой меткой
  `sum by (upstream_provider)` показал бы только прошедшее через hub, и казалось
  бы, что остальное ничего не стоило.

Чтение поля из кадра — это **hook конфигурации** в базе
(`extrairUpstreamProvider`), а не `if` внутри парсинга: каждый hub кладёт
информацию в разное место, а правило фазы — особенность provider становится
конфигурацией.

`models.manual_pricing` помечает цену, введённую по документации provider, а не
синхронизированную. Синхронизация каталога **не перезаписывает** цену помеченной
строки без явного решения — а когда удалённый каталог не сообщает цену,
сохранённое значение сохраняется, а не обнуляется: отсутствующее поле означает
«provider не сказал», а не «бесплатно».

### Пример: одна и та же модель, hub × напрямую

Обещание Фазы 11a («сопоставимую стоимость между „той же моделью через hub“ и
„напрямую“ можно запросить») становится реальным использованием только когда ОДНА
И ТА ЖЕ модель появляется с обеих сторон — сегодня это любая модель, которую
публикуют OpenAI/Anthropic и которая также есть в каталоге OpenRouter
(например, GPT-4o):

```promql
# Razão de custo: servido via OpenRouter vs. servido direto pela OpenAI,
# no mesmo período. > 1 quer dizer que o hub saiu mais caro que o direto.
sum(rate(brabo_llm_cost_micros_total{provider="openrouter", upstream_provider="openai"}[1h]))
  /
sum(rate(brabo_llm_cost_micros_total{provider="openai"}[1h]))
```

Это зацепка, которую открывает `upstream_provider`, — сегодня без
автоматического потребителя. Задуманное прочтение (записано как семя, не
реализовано) — однажды Психолог предложит «эта модель дешевле напрямую, чем
через hub» на основе этой же метрики.

## Контрактный набор

`apps/api/test/contract/llm-provider.contract.ts` прогоняет одну и ту же батарею
против любой реализации, как набор git делает с Фазы 2. Суть в разделении:
**контракт владеет утверждениями, harness владеет диалектом.**

Новому provider нужно написать только harness — переводя каждый сценарий в
собственный формат передачи — и он наследует тесты потока с разорванным кадром,
присутствующим и отсутствующим usage, tool calling, четырьмя ошибками и
молчащим сервером. Фальшивый сервер — настоящий `node:http` на эфемерном порту,
а не mock `fetch`: под тестом находится именно поведение сокета.

## Tool calling и спасение в engine

`ToolCallRecovery` в engine (ADR 0020) восстанавливает вызовы, которые
маленькая модель написала прозой вместо использования поля `tools`. Это
**спасение, а не разрешение**: оно зависит от того, что модель случайно угадает
формат, и молча не срабатывает, когда не угадывает. Поэтому привязка к агенту
модели без нативного tool calling отклоняется в домене, а не просто
не рекомендуется.
