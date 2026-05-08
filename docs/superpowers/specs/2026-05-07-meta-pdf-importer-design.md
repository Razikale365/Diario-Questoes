# Importador de Meta LS - Design

## Objetivo

Adicionar um fluxo novo, sem remover o importador atual, para transformar uma meta LS inteira em uma fila de tarefas executáveis no app. O usuário deixa de colar tarefa por tarefa durante a semana: anexa o PDF da meta, o sistema ingere o conteúdo, revisa a detecção e confirma a criação em lote.

## Escopo Da V1

A V1 será um importador de meta por PDF anexado. O usuário seleciona o arquivo PDF da meta LS, o app extrai o texto automaticamente, ingere a meta e apresenta a revisão antes de criar a fila de tarefas.

O fluxo novo terá uma entrada separada chamada "Importar Meta LS". O fluxo atual "Importar Nova Tarefa" continua funcionando para tarefas avulsas, incluindo colar texto de tarefa individual, e não deve ser removido nem simplificado.

## Fluxo Do Usuário

1. O usuário abre "Importar Meta LS".
2. Anexa o PDF da meta LS.
3. O app extrai o texto do PDF automaticamente.
4. O app analisa a meta e mostra uma prévia revisável.
5. A prévia lista as tarefas detectadas com número, disciplina, formato, descrição, tempo estimado, status inicial e blocos internos quando existirem.
6. O usuário pode desmarcar tarefas detectadas incorretamente antes de importar.
7. Ao confirmar, o app cria várias `StudyTask` em lote, todas em `in_progress`, prontas para aparecerem na fila de execução.

## Dados Detectados

Cada item de meta deve ser representado antes da importação como `MetaTaskDraft`:

- `numero`: número da tarefa na meta.
- `discipline`: disciplina detectada.
- `formato`: revisão, exercícios, teórico, teórico e exercícios, lei seca e exercícios, outros.
- `descricao`: título curto ou assunto da tarefa.
- `tempoEstimadoMinutos`: tempo informado na LS, quando existir.
- `statusOrigem`: pendente, concluído, iniciado, ignorado, quando o texto permitir detectar.
- `rawText`: trecho bruto usado para auditoria.
- `blocks`: blocos compatíveis com `ActivityBlock`, reaproveitando `parseLSTask` quando houver atividades internas.

Ao confirmar, cada draft vira uma `StudyTask` com:

- `planejamento` preservado do formulário ou inferido do cabeçalho da meta quando possível.
- `meta` preenchida com o número da meta, se detectado.
- `tarefa` preenchida com o número da tarefa.
- `assunto` vindo de `descricao`.
- `discipline` e `bank` preenchidos pelo draft ou fallback do formulário.
- `idealMinutes` vindo de `tempoEstimadoMinutos`.
- `blocks` normalizados pelo layout atual.
- `status: "in_progress"`.

## Arquitetura

Criar um parser separado em `src/utils/metaParser.ts`, em vez de aumentar o parser de tarefa individual.

Responsabilidades:

- `parseMetaText(text: string): MetaParseResult`
- Identificar tabela/lista de tarefas da meta.
- Separar tarefas por cabeçalhos, numeração ou padrões de disciplina/formato/descrição.
- Delegar trechos internos para `parseLSTask` quando houver "Atividade 1", "Resolva as questões", "Estude a teoria" etc.
- Retornar avisos quando linhas importantes forem ignoradas.

Criar uma camada de extração em `src/utils/pdfTextExtractor.ts`.

Responsabilidades:

- `extractPdfText(file: File): Promise<PdfExtractionResult>`
- Ler o PDF anexado no navegador.
- Extrair texto página a página.
- Preservar quebras de página e número da página para auditoria.
- Retornar erro amigável quando o PDF estiver vazio, protegido, corrompido ou ilegível.

A implementação deve preferir uma biblioteca client-side consolidada, como `pdfjs-dist`, para evitar depender de backend nesta v1. O custo de bundle deve ser observado no build; se ficar alto demais, a extração pode ser carregada por import dinâmico apenas quando o usuário abrir o importador de meta.

Criar testes em `src/utils/metaParser.test.ts` com amostras reais dos PDFs da pasta `C:\Users\JP\Desktop\Metas LS`, usando trechos pequenos e anonimizados no repositório.

Criar componente `MetaImportArea.tsx` para a UI do fluxo novo. Ele deve ficar ao lado do importador atual, não substituí-lo.

## Interface

Na tela de caderno, antes ou junto da importação atual, haverá alternância clara:

- "Tarefa avulsa"
- "Meta LS"

O modo "Meta LS" mostra:

- seletor de arquivo PDF;
- estado de extração com progresso/feedback;
- campos de fallback para planejamento, meta, banca padrão;
- resumo da detecção: total de tarefas, tempo total estimado, disciplinas e formatos;
- tabela/cards revisáveis com checkbox por tarefa;
- detalhes expansíveis com trecho bruto e blocos detectados;
- botão "Criar fila da meta".

No mobile, a revisão deve usar cards, não tabela horizontal.

## Erros E Segurança De Dados

O importador nunca deve criar tarefas automaticamente sem confirmação.

Se nenhuma tarefa for detectada, a UI deve explicar que o PDF pode conter orientação/calendário sem lista de tarefas detectável, e permitir ver/copiar o texto extraído para diagnóstico.

Se uma tarefa tiver disciplina ou formato incerto, ela continua importável, mas marcada como "revisar".

Importação em lote deve criar todas as tarefas em uma única atualização de estado para reduzir risco de sync parcial.

## Testes

Cobertura mínima:

- Extrai texto de um PDF de fixture pequeno ou mocka a camada `pdfTextExtractor` em teste unitário.
- Detecta tarefas em texto de tabela da meta com número/disciplina/formato/descrição/tempo.
- Detecta tarefas com descrições truncadas ou quebradas em múltiplas linhas.
- Ignora orientações gerais da meta sem virar tarefa.
- Preserva tarefas teóricas sem questões.
- Converte drafts selecionados em `StudyTask`.
- Não remove nem altera o parser/importador de tarefa avulsa.

## Fora De Escopo Da V1

- Calendário mensal/semanal.
- Drag and drop de tarefas no calendário.
- Regras automáticas de distribuição por dia.
- IA para resumir conteúdo do PDF.

Esses itens ficam preparados pela modelagem, mas não entram no primeiro corte.
