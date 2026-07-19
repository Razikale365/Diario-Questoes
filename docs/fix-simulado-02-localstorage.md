# Limpeza de localStorage para Simulado 02

Se você já importou o PDF `simulado-02-conhecimentos-especificos-1vmmJky9.pdf` antes da correção definitiva do parser de questões, o seu banco local de questões (`ls_question_bank_v1`) provavelmente contém questões fragmentadas e duplicadas.

Após a aplicação da nova versão do importador, a identidade secundária permite atualizar questões já existentes. No entanto, para remover questões incorretas ou tarefas já criadas contendo questões fragmentadas, você pode rodar o script abaixo no Console do seu navegador.

> [!WARNING]
> **Importante:** Atualizar o banco de questões através da reimportação do PDF **não altera automaticamente uma tarefa que já foi criada**.
> As tarefas antigas construídas com base na versão fragmentada das questões continuarão contendo as questões erradas.
> Para corrigir isso, você deve excluir/recriar a tarefa antiga ou reimportar o PDF criando uma nova tarefa.

## Alternativa Recomendada (Sem script)

Se você apenas quer atualizar as questões no banco local sem rodar scripts:
1. Vá até a área de importação.
2. Selecione o PDF corrigido.
3. Configure a disciplina e a fonte.
4. Clique em **Salvar no Banco**. O novo sistema de merge detectará as questões de mesma origem e número e atualizará o conteúdo preservando seu histórico de estudo (favoritos, dúvidas, tentativas).

---

## Script de Limpeza no Console do Navegador

Para limpar completamente as questões fragmentadas e a tarefa correspondente do localStorage, abra o Console do desenvolvedor (F12) no site `localhost:3000` (ou sua URL local) e execute o seguinte script conservador:

```javascript
(() => {
  const SOURCE_FILE = 'simulado-02-conhecimentos-especificos-1vmmJky9.pdf';
  
  // 1. Carregar dados atuais
  const bankRaw = localStorage.getItem('ls_question_bank_v1');
  const tasksRaw = localStorage.getItem('ls_tasks_v2');
  
  let bankItems = bankRaw ? JSON.parse(bankRaw) : [];
  let tasks = tasksRaw ? JSON.parse(tasksRaw) : [];
  
  // 2. Contar questões a serem removidas
  const initialBankCount = bankItems.length;
  const questionsToRemove = bankItems.filter(item => item.sourceFileName === SOURCE_FILE);
  const questionsToKeep = bankItems.filter(item => item.sourceFileName !== SOURCE_FILE);
  
  console.log(`Questões encontradas para o simulado: ${questionsToRemove.length} de ${initialBankCount} no total.`);
  
  // 3. Contar tarefas a serem removidas
  // Procura por tarefas que possuam blocos com questões contendo o sourceFileName do simulado
  const initialTasksCount = tasks.length;
  const tasksToRemove = tasks.filter(task => 
    task.blocks && task.blocks.some(block => 
      block.questions && block.questions.some(q => q.sourceName.includes('simulado-02-conhecimentos-especificos') || q.sourceName.includes('Simulado 02'))
    )
  );
  const tasksToKeep = tasks.filter(task => !tasksToRemove.includes(task));
  
  console.log(`Tarefas encontradas relacionadas ao simulado: ${tasksToRemove.length} de ${initialTasksCount} no total.`);
  
  if (questionsToRemove.length === 0 && tasksToRemove.length === 0) {
    console.log('Nenhum registro para remover do localStorage.');
    return;
  }
  
  const confirmClean = confirm(
    `Deseja prosseguir com a remoção de:\n- ${questionsToRemove.length} questões\n- ${tasksToRemove.length} tarefas?\n\nIsso fará um backup no console antes de prosseguir.`
  );
  
  if (!confirmClean) {
    console.log('Operação cancelada pelo usuário.');
    return;
  }
  
  // Fazer backups claros no console em caso de necessidade de restauração
  console.log('BACKUP DO BANCO (Copie se necessário):', bankRaw);
  console.log('BACKUP DE TAREFAS (Copie se necessário):', tasksRaw);
  
  // Salvar no localStorage
  localStorage.setItem('ls_question_bank_v1', JSON.stringify(questionsToKeep));
  localStorage.setItem('ls_tasks_v2', JSON.stringify(tasksToKeep));
  
  console.log('Limpeza realizada com sucesso!');
  console.log('Recarregando a página...');
  
  setTimeout(() => {
    location.reload();
  }, 1000);
})();
```
