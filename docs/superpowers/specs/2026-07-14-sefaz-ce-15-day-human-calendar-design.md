# SEFAZ CE — Calendário Humano e Horizonte Adaptativo de 15 Dias

## Resultado pretendido

Transformar o Diário de Questões em um sistema de execução para a reta final da SEFAZ CE: a IA absorve projeção, capacidade, prioridade, ciclos LS e reorganização; o estudante recebe uma decisão clara, um calendário confiável e prova honesta do que já conquistou.

O produto deixa de apresentar a taxonomia interna do sistema como navegação. A experiência principal passa a ser:

1. **IA Hoje** — próxima ação e fila curta do dia;
2. **Calendário** — visão central de mês/semana e capacidade;
3. **Tarefas** — busca, filtros e detalhe unificados;
4. **Mais** — ferramentas e superfícies secundárias.

O motor planeja uma janela rolante contínua de 1 a 15 dias, sem gerar quinze dias isolados e sem inventar tarefas de metas LS ainda não liberadas. Toda reorganização usa o fluxo **prévia → comparação → aplicação**. Passado, tarefas concluídas, tarefas ativas, itens manuais e pins humanos não se movem silenciosamente.

## Contexto e urgência

- Alvo: `sefaz_ce`.
- Prova objetiva P1: 1º de agosto de 2026.
- Encerramento do concurso/P2: 2 de agosto de 2026.
- O horizonte operacional desta versão termina no D-1 da P1; planejamento pós-P1 fica fora deste marco.
- A configuração oficial continua sendo a fonte das datas. Nenhuma data deste documento será codificada no algoritmo.
- A fotografia de 14 de julho de 2026 indica P1 `60,6068`, P2 `66,514`, equivalente bruto ponderado `193,6348/240`, distância `10,3652` para o alvo `204` e confiança `7450 bp`. Esses números são contexto, não constantes de produto, e não representam a nota padronizada oficial da FCC.
- A Meta 47 termina em 17 de julho. Metas 48 e 49 não podem ser fabricadas antes da importação de dados reais.
- O estudante já executou seu estudo de hoje na LS. A entrega operacional termina com a reconciliação dessa execução no app, mantendo as tarefas concluídas visíveis.

## Problemas confirmados no estado atual

### Motor e persistência

- `SprintEngine.generate()` planeja um dia por vez. A geração de dias futuros não reserva tarefas globalmente, portanto a mesma tarefa pode reaparecer em datas sucessivas.
- `energy_level` é validado e persistido, mas não muda composição ou ordem das ações.
- O refresh diário exclui resoluções apenas do mesmo dia. Concluir uma `sprint_action` não encerra de forma global a `source_plan_task` correspondente.
- `WeeklyPlannerService` já possui forecast e materialização, mas usa candidatos genéricos, janela fixa de sete dias e estado de seleção reiniciado. Ele não consome a projeção Sprint V2, ciclos LS ou placeholders honestos de metas futuras.
- `sprint_actions` exige uma ação executável; não serve para representar capacidade futura sem tarefa conhecida.
- Não há identidade estável para o trabalho através de refreshes. O ID atual pertence à ação de um run, então não é uma base segura para pin, conclusão ou movimento manual.
- Refreshes existentes não garantem uma cadeia linear baseada no head atual. Um calendário durável precisa de compare-and-swap.

### Experiência humana

- O app inicia em Caderno (`src/App.tsx:217`), possui cinco itens na navegação móvel (`src/components/BottomNav.tsx:37-93`) e treze subabas no Planner (`src/components/PlannerArea.tsx:107-120`). A estrutura expõe o sistema, não a jornada do estudante.
- `Auto-organizar` grava imediatamente (`src/components/PlannerArea.tsx:775-787`), agenda apenas itens sem data (`src/utils/planner.ts:648-695`) e não apresenta diff ou cancelamento.
- O calendário oculta concluídas por padrão, eliminando o feedback positivo pedido pelo estudante.
- `failed` hoje é convertido em `completed` por `applyPlannerTaskResult` (`src/utils/planner.ts:134-164`), o que falseia a recompensa e a evidência.
- `PlannerTask` não possui `completedAt`, resultado terminal explícito ou origem/pin de agenda (`src/types/index.ts:122-153`).
- A reimportação da meta pode preservar agenda e vínculo, mas regredir status, desempenho ou minutos já executados.
- Busca e filtros ficam fragmentados; o filtro central conhece apenas disciplina e ocultar concluídas (`src/components/PlannerArea.tsx:204-208`). Linhas de Lista, Por disciplina, Pendentes, Ignoradas e Arquivadas não compartilham o mesmo detalhe.
- Cores de status e risco são usadas com baixa opacidade e, em alguns pontos, sem pista equivalente suficiente.

## Abordagens avaliadas

### 1. Repetir a geração diária quinze vezes

Foi rejeitada. Cada dia enxerga o mesmo pool, não conhece reservas futuras e pode repetir trabalho, exceder ciclos ou sugerir evidência futura inexistente.

### 2. Concatenar dois planejamentos semanais genéricos

Foi rejeitada. O planner semanal não usa a projeção calibrada Sprint V2, não preserva unicidade entre semanas e não representa as regras D-2/D-1 ou as metas LS futuras.

### 3. Planejador puro de horizonte com calendário durável

É a abordagem escolhida. Um `SprintHorizonEngine` puro recebe um snapshot congelado e devolve todos os dias e reservas em uma chamada. Um serviço separado persiste a prévia, aplica a versão aprovada com compare-and-swap e materializa apenas o dia executável.

Essa separação mantém o algoritmo determinístico e testável, sem acoplar SQLite, relógio, idempotência ou React ao motor.

## Princípios obrigatórios

1. **Complexidade no sistema:** o usuário não administra pesos, fórmulas ou filas técnicas.
2. **Autoridade humana:** arraste manual, pin, indisponibilidade e override de capacidade sempre vencem.
3. **Sem mutação invisível:** recalcular não altera o calendário aplicado; somente uma prévia aprovada pode fazê-lo.
4. **Evidência honesta:** placeholder não vira tarefa, não ganha `expectedGain` e não alimenta projeção.
5. **Progresso permanente:** conclusão continua visível e nunca reaparece como pendência.
6. **Uma identidade por trabalho:** refresh muda assignments, não a identidade da tarefa.
7. **Falha não é vitória:** tentativa falha, adiamento do dia e conclusão são estados distintos.
8. **Cores complementam:** prioridade, status e seleção sempre têm texto, ícone ou padrão além da cor.
9. **Local primeiro:** o calendário não depende da internet para abrir ou executar.
10. **Auditabilidade:** versões antigas, snapshot de entrada, diff e origem da capacidade permanecem consultáveis.

## Validação de UI/UX usada no desenho

- Quatro destinos principais estão dentro da recomendação oficial de três a cinco destinos consistentes de importância semelhante para uma navigation bar: [Android Developers — Navigation bar](https://developer.android.com/develop/ui/compose/components/navigation-bar).
- Busca deve responder durante a digitação, priorizar resultados relevantes e oferecer escopos/tokens para refinamento: [Apple Human Interface Guidelines — Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields) e [Android Developers — Search bar](https://developer.android.com/develop/ui/compose/components/search-bar).
- Progressive disclosure, redução de escolhas, controles agrupados e espaço suficiente validam a migração das treze subabas para quatro destinos e um drawer contextual: [Apple Human Interface Guidelines — Layout](https://developer.apple.com/design/human-interface-guidelines/layout).
- Cor não pode ser o único meio de transmitir informação: [WCAG 2.2 — Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color).
- O mínimo WCAG AA é 24 × 24 CSS px ou espaçamento equivalente. Esta experiência usa no mínimo 36 px no desktop e 44 px em ações principais no touch: [WCAG 2.2 — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- A pesquisa interna de UX reforça Tesler, Hick, progressive disclosure, meta visível, final claro, input tolerante, resposta perceptível em até 400 ms, números tabulares e ausência de animação em busca de alta frequência.

## Arquitetura de domínio

### `SprintHorizonEngine`

Novo módulo puro em `study_os_service/services/sprint_horizon_engine.py`:

```python
class SprintHorizonEngine:
    algorithm_version = "sefaz-ce-horizon-v1"

    def plan(
        self,
        request: SprintHorizonRequest,
        snapshot: SprintHorizonSnapshot,
    ) -> SprintHorizonDraft:
        ...
```

O engine não recebe conexão, repositório, `date.today()`, chave de idempotência ou callback. A única operação pública calcula o horizonte completo.

Novos value objects imutáveis em `study_os_service/domain/sprint_calendar.py`:

- `SprintHorizonRequest`: target, início, fim e capacidades normalizadas;
- `HorizonDayCapacity`: data, minutos LS, minutos extras, energia, disponibilidade, origem e confiança;
- `SprintHorizonSnapshot`: cutoff, config, matérias, projeção, tarefas, ciclos, itens estáveis, assignments travados e histórico de capacidade;
- `HorizonItemDraft`: item real, manual ou placeholder;
- `HorizonAssignmentDraft`: data, posição, duração, precisão, prioridade, ação opcional e motivos;
- `HorizonDayDraft`: capacidade, carga, shortfall e assignments;
- `SprintHorizonDraft`: dias, itens, warnings, shortfalls e snapshot hash.

### Livro global de reservas

O engine mantém um conjunto global de identidades durante todo o intervalo:

- tarefa LS real: `source-task:{source_plan_task_id}`;
- intervenção: `intervention:{date}:{kind}:{subject}:{ordinal}`;
- trabalho manual: `manual:{calendar_item_id}`;
- capacidade de meta futura: `future-cycle:{expected_meta_number}:{date}`.

Uma identidade real só pode ser alocada uma vez no run. Um placeholder consome capacidade, mas não possui `sourcePlanTaskId`, matéria, material, botão Executar, ganho ou evidência.

### Precisão temporal

- **Exato:** tarefa conhecida de ciclo vigente, intervenção derivada de evidência atual ou item manual.
- **Provisório:** envelope de capacidade para meta ainda não importada.
- **Protegido:** D-2, D-1, passado ou assignment humano que não pode ser movido automaticamente.

O snapshot usa um único `planning_cutoff`. Projeções para datas futuras não são recalculadas como se novas evidências já existissem.

### Regras D-2 e D-1

- A primeira versão encerra o horizonte no dia anterior à P1.
- D-2 mantém no máximo 120 minutos de erros, exceções, lei seca e revisão de alta fragilidade.
- D-1 mantém no máximo 120 minutos LS e 30 minutos extras, sem conteúdo novo, simulado completo ou reorganização agressiva.
- Um override humano pode exceder essas proteções, mas a prévia deve rotulá-lo como exceção manual.

### Energia

Energia altera composição, não disponibilidade:

- nível 1: blocos de até 25 minutos; revisão, erro, lei seca e compressão;
- nível 2: blocos de até 35 minutos; sem simulado completo ou discursiva;
- nível 3: política normal;
- nível 4: permite teoria densa, discursiva e simulado quando o restante das regras permitir;
- nível 5: prioriza blocos cognitivamente pesados, mas não adiciona minutos por si só.

Em todos os níveis, a soma nunca excede `ls_minutes + extra_minutes`. Testes devem provar que energia 1 e 5 geram composições diferentes no mesmo snapshot.

## Capacidade adaptativa

Novo serviço puro em `study_os_service/services/sprint_capacity.py` produz uma sugestão por data.

### Ordem de precedência

1. override manual da data;
2. override manual do dia da semana;
3. override manual global;
4. sugestão aprendida com pelo menos três dias representativos;
5. configuração padrão.

`Indisponível` é um estado explícito com zero minutos. Ausência de registro nunca significa indisponibilidade ou capacidade zero.

### Janela e amostras

- Lookback: 14 dias corridos anteriores ao início do horizonte.
- Um dia é representativo para aprendizado quando possui ao menos uma ação com resultado e minutos reais.
- Dias sem registro são ignorados. Indisponibilidade explícita vale somente para a data/escopo informado e não entra na amostra de aprendizado como zero.
- Para cada dia, calcula-se:

```text
completion_ratio = completed_actions / scheduled_actions
effective_minutes = actual_minutes
                  + max(0, planned_minutes - actual_minutes) * completion_ratio
```

- A mediana ponderada começa com peso 1, multiplica por 2 para o mesmo dia da semana e por 2 para energia com diferença máxima de um nível; o peso máximo é 4.
- A nova sugestão mistura 70% da sugestão anterior e 30% da mediana ponderada.
- Quando não há sugestão anterior, o padrão configurado ocupa os 70% iniciais.
- O valor final fica entre 75% e 125% do padrão e muda no máximo 15% por refresh.
- Confiança inicia em `5500 bp` com três amostras, ganha `1000 bp` por amostra adicional e para em `9000 bp`.
- Energia não aplica um segundo multiplicador sobre minutos; ela só governa composição.

O calendário explica a origem em linguagem humana, por exemplo: `2h40 sugeridas · baseadas em 6 dias parecidos`. O usuário pode editar uma data, a semana ou o padrão e usar **Voltar ao automático**.

## Persistência — schema v12

A migração é aditiva e separa calendário Sprint do planner genérico.

### `sprint_calendar_runs`

- identidade e idempotency key;
- target, `window_start`, `window_end`, `planning_cutoff` e `exact_through`;
- `algorithm_version`, `request_hash` e `input_hash`;
- `base_applied_run_id` e `supersedes_run_id`;
- decisão `draft | applied | rejected`;
- resultado `generated | shortfall`;
- warnings/shortfalls e snapshots de projeção/capacidade;
- version, `generated_at` e `applied_at`.

O head é o run `applied` que não foi supersedido por outro run aplicado. Runs aplicados antigos permanecem imutáveis como auditoria; draft e rejected nunca aparecem como calendário ativo. Um índice único sobre `supersedes_run_id` não nulo, somado ao compare-and-swap, impede forks.

### `sprint_calendar_days`

- run, target e data;
- precisão `exact | provisional | protected`;
- origem/confiança de capacidade;
- minutos disponíveis, LS, extras, reservados e excedentes;
- energia, disponibilidade e warnings;
- unique `(run_id, plan_date)`.

### `sprint_calendar_items`

Identidade estável do trabalho através de runs:

- origem `source | manual | system`;
- `source_plan_task_id` opcional e único por target;
- subject opcional, tipo, título e meta esperada;
- estado `pending | active | completed | failed | ignored | archived`;
- resultado, `completed_at`, version e timestamps.

Um placeholder usa `origin=system` e `kind=future_cycle_capacity`; não pode ter source, matéria, material, StudyTask, resultado, botão Executar ou estado concluído.

### `sprint_calendar_assignments`

- run, item, data, posição e duração;
- precisão, priority tier, motivo e snapshot de pin;
- ação sugerida opcional;
- `replaces_placeholder_item_id` quando uma meta real substitui capacidade provisória;
- unique `(run_id, item_id)` e `(run_id, plan_date, position)`.

### `sprint_calendar_materializations`

Vínculo append-only entre assignment aplicado e `sprint_day_run`/`sprint_action`. Uma prévia nunca cria materialização.

### `sprint_calendar_day_overrides`

- target e escopo `date | weekday | global`;
- disponibilidade `default | available | unavailable`;
- minutos LS, extras, energia opcional, version e timestamps.

Zero minutos é aceito somente quando `unavailable` for explícito.

### `sprint_calendar_item_overrides`

- item, data/posição/hora/duração manual;
- `pinned`, `active`, version e timestamps.

Mover ou agendar manualmente cria/atualiza esse override. Desafixar é uma mutação versionada, não a perda silenciosa do registro.

### Integridade

- Todas as relações importantes incluem target e composite foreign keys para impedir vínculo cruzado.
- `sprint_mutation_receipts` é reutilizada com namespaces `calendar-preview`, `calendar-apply`, `calendar-day-override`, `calendar-item-override` e `calendar-result`.
- A migração v12 só ocorre depois de backup fresco, SHA-256, `integrity_check=ok` e zero violações de foreign key.

## Serviço e API

Arquivos novos:

- `study_os_service/repositories/sprint_calendar.py`;
- `study_os_service/services/sprint_calendar.py`;
- `study_os_service/services/sprint_horizon_engine.py`;
- `study_os_service/services/sprint_capacity.py`;
- `study_os_service/api/sprint_calendar.py`.

Endpoints:

- `GET /api/v1/sprints/calendar?targetSlug=...&startDate=...` — head aplicado;
- `GET /api/v1/sprints/calendar/runs/{runId}` — preview, diff ou auditoria;
- `POST /api/v1/sprints/calendar/preview` — persiste draft idempotente com `expectedRunId`;
- `POST /api/v1/sprints/calendar/runs/{runId}/apply` — aplica draft com compare-and-swap;
- `PUT /api/v1/sprints/calendar/days/{date}` — disponibilidade/capacidade com `expectedVersion`;
- `PUT /api/v1/sprints/calendar/items/{itemId}/override` — pin, unpin, mover ou redimensionar;
- `POST /api/v1/sprints/calendar/items` — item manual durável.

### Fluxo transacional de preview

1. `BEGIN IMMEDIATE`;
2. validar janela contígua de 1 a 15 dias e limite D-1;
3. validar `expectedRunId` contra o head aplicado;
4. normalizar capacidades e calcular `request_hash`;
5. replay idempotente retorna o mesmo draft; chave igual com payload diferente retorna 409;
6. carregar um snapshot congelado de projeção, matérias, tarefas, ciclos, itens, pins e resultados;
7. executar o engine puro;
8. persistir run draft, dias, itens novos e assignments atomicamente;
9. commit.

### Fluxo transacional de apply

1. exigir que o draft ainda tenha como base o head atual;
2. exigir as mesmas versões dos overrides usadas na prévia;
3. preservar passado, completed, active, manual e pinned;
4. marcar o draft como applied em uma transação; o head anterior continua imutável e passa a ser reconhecido como supersedido pela referência do novo run;
5. não alterar tarefas-fonte nem criar ações futuras;
6. retornar o diff aplicado e um token de desfazer baseado no run anterior.

Conflito de head ou override retorna 409 e pede uma nova prévia. Nunca é resolvido movendo itens por conta própria.

### Erros estáveis

- 404: `calendar_not_found`, `calendar_run_not_found`, `calendar_item_not_found`;
- 409: `calendar_idempotency_conflict`, `stale_calendar_run`, `calendar_supersession_conflict`, `stale_calendar_override`;
- 422: `invalid_calendar_window`, `invalid_calendar_capacity`, `invalid_calendar_placeholder`, `invalid_calendar_assignment`.

Pin acima da capacidade gera warning/shortfall visível. Não é erro e não autoriza movimento silencioso.

## Integração com execução diária

- O head aplicado é o forecast; `sprint_day_runs` e `sprint_actions` continuam sendo snapshots de execução.
- Ao abrir o dia, assignments exatos são materializados no run diário e vinculados por `sprint_calendar_materializations`.
- O dia recalcula apenas evidência/ranking compatível sem trocar identidades ou violar assignments protegidos.
- Ao concluir uma ação, a mesma transação:
  1. atualiza a `sprint_action`;
  2. atualiza `sprint_calendar_items.state=completed` e `completed_at`;
  3. atualiza a `source_plan_task.status=completed` quando houver fonte;
  4. persiste evidência agregada;
  5. salva receipt idempotente.
- Se qualquer etapa falhar, tudo é revertido.
- `skipped` do dia mantém o item elegível no futuro. `ignored` é uma ação separada e explícita sobre o item.
- Concluir não reorganiza automaticamente o restante. A UI oferece **Recalcular restante**, que abre uma nova prévia.

## Regras de auto-organização

O comando principal usa `reflow_open`:

- janela imediata: hoje até `min(current_cycle.ends_on, window_end)`; sem ciclo vigente, hoje até `min(próxima sexta-feira, window_end)`;
- janela completa: até 15 dias ou D-1;
- preserva datas passadas, concluídas, ativas/iniciadas, itens manuais, assignments aceitos e pins;
- reorganiza apenas pendências não fixadas;
- carrega excesso como shortfall/backlog com motivo, nunca como desaparecimento;
- usa envelopes provisórios depois de `exact_through`;
- repetição com o mesmo input produz o mesmo preview.

Uma opção secundária em disclosure, **Só preencher espaços**, agenda apenas itens sem data. Ela não é o comportamento principal.

### Conteúdo do preview

- contagens: adicionadas, movidas, preservadas, concluídas, sem espaço e placeholders substituídos;
- cada movimento mostra data/hora anterior e proposta;
- pins e concluídas aparecem na lista `Preservadas`;
- overload mostra capacidade e excesso por dia;
- ações `Cancelar` e `Aplicar organização`;
- cancelar não muda React state, localStorage, SQLite ou head;
- aplicar é uma única mutação idempotente e oferece **Desfazer** para o head anterior.

## Arquitetura da interface

### App shell

Novos componentes:

- `src/components/AppShell.tsx`;
- `src/components/PrimaryNavigation.tsx`;
- `src/components/TodayAiPage.tsx`;
- `src/components/CalendarPage.tsx`;
- `src/components/UnifiedTasksPage.tsx`;
- `src/components/MorePage.tsx`.

Desktop e mobile mostram exatamente `IA Hoje | Calendário | Tarefas | Mais`, na mesma ordem. IA Hoje é a entrada padrão.

As rotas usam hash local para sobreviver a hosting estático:

- `#/today`;
- `#/calendar`;
- `#/tasks`;
- `#/more`.

Query params preservam estado contextual, por exemplo `#/tasks?q=icms&status=pending&task=source-123`. Voltar e reload restauram tela, filtros e drawer.

O Caderno deixa de ser destino primário. Ele abre como modo de execução por `Executar/Continuar` e retorna à origem.

### IA Hoje

Ordem visual:

1. uma recomendação principal com duração, material e botão Executar;
2. fila curta do dia, no máximo quatro blocos visíveis;
3. progresso diário real;
4. trajetória de 15 dias compacta;
5. `Por que agora?` recolhido;
6. detalhes de projeção e auditoria apenas em disclosure ou Mais.

Não há carrossel de indicadores concorrentes. Uma ação domina a tela.

### Calendário

- continua sendo uma tela principal, com mês e semana;
- calendário ocupa a maior região; backlog e capacidade são auxiliares;
- concluídas permanecem no dia original com check e métricas reais;
- dia mostra `tarefas · minutos` além do heat;
- drag de tarefa para data/hora cria pin manual visível `📌`;
- placeholder futuro tem padrão tracejado e texto `Capacidade reservada · aguardando Meta`, sem ação Executar;
- `Auto-organizar` sempre abre preview;
- a legenda de prioridade permanece visível.

### Prioridade quente/fria

Status e prioridade são canais separados:

- **Crítica** — vermelho + chama + texto: prazo/deficit exige ação agora;
- **Alta** — laranja + seta + texto: alto retorno relativo;
- **Manutenção** — azul + ciclo + texto: consolidação/revisão;
- **Protegida** — ciano + escudo + texto: fragilidade a preservar;
- **Concluída** — verde + check + texto, exclusivamente como status.

O tier é determinístico: uma ação de retenção por fragilidade ou proteção D-2/D-1 é `Protegida`; uma tarefa real que expira em até dois dias é `Crítica`; o primeiro terço das demais ações pelo ranking relativo congelado é `Alta`; o restante é `Manutenção`. Empates usam score, `source_order` e identidade estável, nessa ordem.

Nenhum tier promete ganho exato de pontos. `expected_gain_milli` continua sendo prioridade relativa auditável até existir validação que permita outra interpretação.

## Tarefas unificadas

Não se fundem prematuramente os modelos persistidos. Cria-se uma projeção de leitura em `src/utils/unifiedTasks.ts`:

```ts
type UnifiedTaskItem = {
  key: string;
  plannerTaskId?: string;
  studyTaskId?: string;
  sourcePlanTaskId?: number;
  calendarItemId?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'ignored' | 'archived';
  title: string;
  discipline: string;
  scheduledAt?: string;
  schedulePinned: boolean;
  source: string;
  relevance?: number;
  performance?: number;
  questionCount: number;
};
```

Uma `PlannerTask` com `linkedStudyTaskId` aparece uma vez. PlannerTasks, StudyTasks e itens de calendário órfãos continuam encontráveis.

### Busca e filtros

- busca imediata, sem animação, tolerante a acentos;
- pesquisa número da tarefa, meta, disciplina, assunto, descrição, fonte e material;
- quick views: Hoje, Em andamento, Pendentes e Concluídas;
- filtros: status, disciplina, origem, target, formato, relevância, duração, data, agendada/solta e com/sem questões;
- semântica AND entre grupos e OR dentro do mesmo grupo;
- chips ativos, contagem, `Limpar tudo` e estado vazio explicativo;
- ordenação por prioridade, agenda, relevância e atualização;
- desktop mantém busca e filtros principais visíveis; mobile usa sheet;
- acima de 50 resultados usa paginação ou virtualização;
- filtros ficam na URL.

## Drawer único de tarefa

`src/components/TaskDetailDrawer.tsx` substitui os detalhes fragmentados. Toda linha, card do calendário, resultado de busca, item Sprint ou ação de IA Hoje abre a mesma superfície.

- desktop: drawer lateral;
- mobile: sheet em tela inteira;
- click na linha, Enter ou Espaço abre detalhes;
- `Executar/Continuar` permanece uma ação rápida separada;
- conteúdo: status, disciplina, título, origem, agenda, duração, relevância, meta, desempenho, resultado e progresso;
- `Por que entrou`, instruções e auditoria ficam recolhidos;
- ações fixas: Executar/Continuar, Importar PDF, Agendar, Registrar resultado;
- concluída mostra resultado imutável e opção Reabrir;
- falha mostra motivo e Replanejar, sem selo de conclusão;
- URL usa `task=...`;
- `role=dialog`, `aria-modal`, foco preso, Escape, retorno de foco e confirmação quando houver rascunho;
- erros ficam inline junto ao campo; números aceitam digitação incompleta e validam no blur/submit;
- input é normalizado sem exigir formato rígido do usuário.

O PDF continua sendo um modal especializado descrito na spec existente. O drawer unifica o detalhe, não concentra todos os fluxos em um mega-modal.

## Semântica de resultado e recompensa

`PlannerTaskStatus` recebe `failed`. `PlannerTask` recebe:

- `completedAt?: string`;
- `lastOutcome?: 'completed' | 'failed' | 'skipped'`;
- `scheduleOrigin?: 'source' | 'automatic' | 'manual'`;
- `schedulePinned?: boolean`.

Regras:

- `completed` define `completedAt` uma vez;
- replay idempotente não muda `completedAt` nem repete recompensa;
- `failed` permanece distinguível e pode ser replanejada;
- `skipped` registra resultado do dia sem encerrar globalmente a tarefa;
- reimportação preserva conclusão, falha, minutos, desempenho, vínculo e pin quando a versão local é mais recente;
- reload, sync, nova Meta e auto-organização preservam conclusão;
- concluída continua no calendário e em `Concluídas hoje`;
- filtro manual pode ocultar concluídas na lista, mas o calendário não as oculta por padrão.

### Feedback de conquista comprovada

Na primeira transição para conclusão:

- check curto de 180–260 ms;
- texto factual, por exemplo `45 min concluídos · 18/20 · evidência incorporada`;
- progresso do dia, por exemplo `3 de 5 concluídas`;
- impacto na trajetória apenas quando o backend recalcular evidência real;
- `Desfazer` temporário;
- anúncio `aria-live="polite"`;
- `prefers-reduced-motion` elimina movimento espacial.

Não há XP, streak artificial, confete recorrente ou estimativa falsa de pontos.

## Acessibilidade e acabamento

- texto normal com contraste mínimo 4,5:1; componentes/estados 3:1;
- ações principais com 44 × 44 px no touch; demais controles nunca abaixo de 36 px sem espaçamento adequado;
- foco visível com borda, contraste e offset; não apenas cor;
- suporte a teclado, `forced-colors`, `prefers-contrast` e `prefers-reduced-motion`;
- heat compreensível em escala de cinza e simulação de daltonismo;
- ícones têm rótulo visível ou nome acessível;
- números de agenda, minutos, acurácia e projeção usam `font-variant-numeric: tabular-nums`;
- busca não anima em cada tecla;
- hover/press usa 120–180 ms; mudanças pequenas 180–260 ms; nenhuma interação iniciada pelo usuário excede 300 ms sem feedback imediato;
- sem overflow horizontal em 390 × 844, desktop ou zoom de 200%.

## Falhas e recuperação

- Falha de preview mantém o head atual e todos os controles editados.
- Cancelar preview não produz nenhuma escrita.
- Falha de apply reverte a transação e mantém o calendário anterior.
- 409 carrega o novo head e oferece recalcular; não reaplica silenciosamente.
- Falha ao concluir uma ação reverte item, source task, evidência e materialização juntos.
- Serviço local indisponível mostra o último snapshot aplicado em cache, marca-o como desatualizado e desabilita Auto-organizar; não limpa agenda.
- Internet bloqueada não impede abertura do calendário, busca, detalhe ou execução local.
- Meta nova importada não altera o calendário aplicado; aparece como aviso `Nova Meta disponível` e exige preview.
- Placeholder sem Meta nunca vira tarefa executável.

## Testes de aceitação

### Motor puro

- mesma entrada produz bytes equivalentes e mesma ordem;
- janela de 1 e 15 dias funciona; zero, gap, 16 dias ou data após D-1 é rejeitada;
- mesma source task nunca aparece duas vezes;
- tarefa reservada no primeiro dia não reaparece no segundo;
- energia 1 e 5 geram composição diferente sem mudar capacidade;
- D-2 e D-1 respeitam proteções;
- Meta 48/49 ausente gera somente envelopes provisórios;
- placeholder não possui ação, ganho, material ou evidência;
- importar Meta real gera diff placeholder → itens reais, sem tocar no head.

### Capacidade

- menos de três dias usa default e baixa confiança;
- dia ausente é ignorado;
- indisponibilidade explícita produz zero;
- ordem date → weekday → global → learned → default é respeitada;
- aprendizado não varia mais de 15% por refresh nem sai de 75–125% do default;
- pin acima da capacidade permanece e cria shortfall;
- Voltar ao automático remove apenas o override escolhido.

### Persistência, API e concorrência

- v11 → v12 preserva contagens, runs, ações, receipts, evidências e ciclos;
- erro de migração reverte tudo;
- composite FKs rejeitam relações cross-target;
- preview replay retorna o mesmo draft;
- mesma idempotency key com payload diferente retorna 409;
- draft/rejected não aparece como current;
- apply com head stale ou override alterado retorna 409;
- cadeia aplicada não bifurca;
- passado, completed, active, manual e pinned nunca se movem;
- concluída não reaparece no dia seguinte;
- skipped do dia pode retornar; ignored não retorna;
- resultado atualiza item, source task, ação e evidência atomicamente.

### Interface

- desktop e mobile mostram exatamente quatro destinos e IA Hoje é padrão;
- nenhuma barra com treze subabas permanece;
- rotas, filtros e drawer sobrevivem a reload/voltar;
- item Planner + StudyTask vinculado aparece uma vez;
- busca `constituicao` encontra `Constituição`;
- filtros combinados e contagens são corretos;
- todas as origens abrem o mesmo drawer;
- fechar drawer restaura foco;
- Executar reutiliza StudyTask vinculada e não duplica caderno;
- preview mostra moved/added/preserved/overflow e não escreve antes de apply;
- cancelar preserva o estado byte a byte;
- concluídas e pins permanecem visíveis;
- failed nunca recebe recompensa;
- recompensa dispara uma vez;
- heat é compreensível sem cor;
- 390 × 844, desktop e zoom 200% não têm overflow horizontal.

### Durabilidade e produção

- restart preserva head, drafts, pins, capacidade, itens manuais e concluídas;
- backup/restore preserva cadeia e diffs com hash, integridade e FKs válidos;
- app funciona com internet bloqueada e sem request externo para o calendário;
- testes completos: `pytest`, `compileall`, `npm test`, `npm run lint`, `npm run build`;
- validação real em desktop e 390 px, teclado, console limpo e serviço local.

## Sequência de entrega

### Fatia 1 — correção P0 e motor durável

- domínio, `SprintHorizonEngine`, capacity learning e testes puros;
- schema v12, repositório, preview/apply CAS e APIs;
- identidade estável, conclusão global e materialização diária;
- restart, backup, restore e offline.

Esta fatia precisa ficar verde antes da reorganização visual.

### Fatia 2 — calendário dinâmico e confiança

- projeção frontend do head;
- auto-organizar com preview/diff/apply/desfazer;
- pins, overrides, heat e placeholders;
- concluídas persistentes e recompensa factual.

### Fatia 3 — simplificação humana

- AppShell e quatro destinos;
- IA Hoje, Calendário, Tarefas unificadas e Mais;
- busca/filtros, drawer único e responsividade;
- remoção da navegação redundante somente depois de equivalência funcional.

### Fatia 4 — fechamento operacional

- abrir o histórico da LS autorizado pelo usuário;
- usar somente a sessão já autenticada no Chrome; se ela tiver expirado, o usuário faz o login diretamente e a reconciliação continua sem o agente ler ou armazenar credenciais;
- identificar as tarefas realmente executadas hoje sem copiar conteúdo proprietário;
- reconciliar por meta/task ID, disciplina, minutos e resultado agregado;
- aplicar no app de forma idempotente;
- confirmar que ficam concluídas, visíveis e incorporadas à capacidade/evidência;
- registrar relatório local de itens atualizados, não encontrados ou conflitantes.

## Fora de escopo

- download ou ingestão do pacote Estratégia `249654`;
- scraper permanente da LS ou armazenamento de credenciais/cookies;
- conteúdo de questões proprietário;
- OCR de PDF;
- implementação do importador PDF dentro da tarefa, já especificado separadamente;
- reformulação completa do banco de questões;
- planejamento pós-P1/P2;
- promessa de nota oficial ou ganho exato de pontos;
- gamificação artificial.

## Definição de vitória

O marco termina somente quando:

1. o horizonte não duplica tarefas nem inventa Metas futuras;
2. capacidade e energia mudam o plano de forma explicável e limitada;
3. Auto-organizar sempre mostra preview e respeita passado, conclusão e pins;
4. conclusão permanece visível, factual e durável;
5. o estudante navega por quatro destinos e encontra qualquer tarefa por busca/drawer;
6. calendário abre sem internet e sobrevive a restart/backup/restore;
7. a execução real de hoje na LS está reconciliada no app;
8. os gates automatizados e a validação visual real estão verdes.
