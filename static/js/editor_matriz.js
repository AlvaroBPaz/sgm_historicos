/**
 * SGM-Históricos — editor_matriz.js
 * Módulo da Planilha Matricial de Arquivo Passivo e Modo Digitação Turbo
 * 
 * Recursos:
 * - Seletor de Regime em 1 clique (8 Anos [1ª a 8ª], 9 Anos [1º ao 9º], EJA);
 * - Inserção rápida de Disciplinas Históricas clássicas (Estudos Sociais, EMC, OSPB, etc.);
 * - Modo Digitação Turbo ("Salvar e Criar Próximo da Mesma Época");
 * - Mapeamento Físico de Arquivo Morto (Estante, Caixa, Pasta) e Certidões Antigas.
 */

class EditorMatrizHistorico {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.regimeAtual = "8_ANOS";
    this.seriesColunas = [];
    this.disciplinas = [];
    this.alunoAtualUuid = null;
    this.ultimoCadastroTurbo = null; // Guarda regime, escola e grade para o modo turbo

    // Disciplinas históricas clássicas para adição em 1 clique
    this.catalogoDisciplinasClassicas = [
      { nome: "Estudos Sociais", cat: "BASE_COMUM" },
      { nome: "Educacao Moral e Civica (EMC)", cat: "BASE_COMUM" },
      { nome: "OSPB", cat: "BASE_COMUM" },
      { nome: "Programas de Saude", cat: "BASE_COMUM" },
      { nome: "Ciencias Fisicas e Biologicas", cat: "BASE_COMUM" },
      { nome: "Educacao Artistica", cat: "BASE_COMUM" },
      { nome: "Educacao Fisica", cat: "BASE_COMUM" },
      { nome: "Lingua Portuguesa", cat: "BASE_COMUM" },
      { nome: "Matematica", cat: "BASE_COMUM" },
      { nome: "Historia", cat: "BASE_COMUM" },
      { nome: "Geografia", cat: "BASE_COMUM" },
      { nome: "Ciencias", cat: "BASE_COMUM" },
      { nome: "Lingua Estrangeira (Ingles)", cat: "DIVERSIFICADA" },
      { nome: "Praticas Agricolas", cat: "DIVERSIFICADA" },
      { nome: "Praticas Comerciais", cat: "DIVERSIFICADA" },
      { nome: "Ensino Religioso", cat: "DIVERSIFICADA" }
    ];

    this.definirColunasPorRegime("8_ANOS");
  }

  definirColunasPorRegime(regime) {
    this.regimeAtual = regime;
    if (regime === "8_ANOS") {
      this.seriesColunas = [
        { col: 1, label: "1ª Série" },
        { col: 2, label: "2ª Série" },
        { col: 3, label: "3ª Série" },
        { col: 4, label: "4ª Série" },
        { col: 5, label: "5ª Série" },
        { col: 6, label: "6ª Série" },
        { col: 7, label: "7ª Série" },
        { col: 8, label: "8ª Série" }
      ];
    } else if (regime === "9_ANOS") {
      this.seriesColunas = [
        { col: 1, label: "1º Ano" },
        { col: 2, label: "2º Ano" },
        { col: 3, label: "3º Ano" },
        { col: 4, label: "4º Ano" },
        { col: 5, label: "5º Ano" },
        { col: 6, label: "6º Ano" },
        { col: 7, label: "7º Ano" },
        { col: 8, label: "8º Ano" },
        { col: 9, label: "9º Ano" }
      ];
    } else { // EJA_ETAPAS
      this.seriesColunas = [
        { col: 1, label: "1ª Etapa (I)" },
        { col: 2, label: "2ª Etapa (II)" },
        { col: 3, label: "3ª Etapa (III)" },
        { col: 4, label: "4ª Etapa (IV)" }
      ];
    }
  }

  carregarGradePadraoInicial() {
    if (this.regimeAtual === "8_ANOS") {
      this.disciplinas = [
        { id: "disc_1", nome: "Língua Portuguesa", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_2", nome: "Matemática", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_3", nome: "Estudos Sociais", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_4", nome: "Ciências Físicas e Biológicas", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_5", nome: "Educação Moral e Cívica (EMC)", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_6", nome: "Educação Artística", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_7", nome: "Educação Física", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_8", nome: "Programas de Saúde", categoria: "DIVERSIFICADA", notas: {} },
        { id: "disc_9", nome: "Práticas Agrícolas", categoria: "DIVERSIFICADA", notas: {} }
      ];
    } else if (this.regimeAtual === "9_ANOS") {
      this.disciplinas = [
        { id: "disc_1", nome: "Língua Portuguesa", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_2", nome: "Matemática", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_3", nome: "História", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_4", nome: "Geografia", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_5", nome: "Ciências Naturais", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_6", nome: "Arte", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_7", nome: "Educação Física", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_8", nome: "Língua Inglesa", categoria: "DIVERSIFICADA", notas: {} }
      ];
    } else {
      this.disciplinas = [
        { id: "disc_1", nome: "Língua Portuguesa", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_2", nome: "Matemática", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_3", nome: "Ciências Naturais", categoria: "BASE_COMUM", notas: {} },
        { id: "disc_4", nome: "História e Geografia", categoria: "BASE_COMUM", notas: {} }
      ];
    }
  }

  adicionarDisciplinaRapida(nome, categoria = "BASE_COMUM") {
    const jaExiste = this.disciplinas.some(d => d.nome.toLowerCase() === nome.toLowerCase());
    if (jaExiste) {
      alert(`A disciplina "${nome}" já consta na grade.`);
      return;
    }
    const novoId = "disc_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    this.disciplinas.push({
      id: novoId,
      nome: nome,
      categoria: categoria,
      notas: {}
    });
    this.renderizarTabelaMatriz();
  }

  removerDisciplina(id) {
    this.disciplinas = this.disciplinas.filter(d => d.id !== id);
    this.renderizarTabelaMatriz();
  }

  alterarRegime(novoRegime) {
    if (this.regimeAtual === novoRegime) return;
    this.definirColunasPorRegime(novoRegime);
    this.renderizarInterfaceCompleta();
  }

  fechar() {
    const modal = document.getElementById("modalEdicaoMatriz");
    if (modal) modal.classList.add("hidden");
    if (this.container) this.container.innerHTML = "";
    this.alunoAtualUuid = null;
  }

  renderizarInterfaceCompleta() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
        <!-- CABEÇALHO DO FORMULÁRIO -->
        <div class="bg-slate-50 border-b border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span class="text-blue-700">📋</span> Ficha de Histórico Escolar (Arquivo Passivo)
            </h2>
            <p class="text-xs text-slate-500">Preenchimento livre. Nenhum documento civil é obrigatório para resgate de ex-alunos antigos.</p>
          </div>

          <div class="flex items-center gap-3">
            <!-- SELETOR DE REGIME EM 1 CLIQUE -->
            <div class="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-300 shadow-sm text-xs font-semibold">
              <button type="button" id="btnRegime8" class="px-3 py-1.5 rounded-md transition-all ${this.regimeAtual === '8_ANOS' ? 'bg-blue-700 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}">
                1ª a 8ª Série (8 Anos)
              </button>
              <button type="button" id="btnRegime9" class="px-3 py-1.5 rounded-md transition-all ${this.regimeAtual === '9_ANOS' ? 'bg-blue-700 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}">
                1º ao 9º Ano (9 Anos)
              </button>
              <button type="button" id="btnRegimeEJA" class="px-3 py-1.5 rounded-md transition-all ${this.regimeAtual === 'EJA_ETAPAS' ? 'bg-blue-700 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}">
                EJA (Etapas)
              </button>
            </div>

            <!-- BOTÃO FECHAR NO TOPO -->
            <button type="button" id="btnFecharTopoMatriz" title="Voltar / Fechar" class="text-slate-400 hover:text-slate-700 text-xl font-bold px-2.5 py-1 rounded-lg hover:bg-slate-200 transition-colors">
              ✕
            </button>
          </div>
        </div>

        <div class="p-5 sm:p-6 space-y-6">

          <!-- SEÇÃO 1: DADOS DO ESTUDANTE (MODELO LIMPO SMEJ-JANDAÍRA/RN) -->
          <div>
            <h3 class="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>👤</span> Dados do Estudante
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-sm">
              <div class="sm:col-span-3">
                <label class="block text-xs font-semibold text-slate-800 mb-1">Nome Civil do Estudante *</label>
                <input type="text" id="campo_nome_completo" required placeholder="Nome completo civil do estudante" class="w-full bg-white border border-slate-300 rounded px-3 py-2 text-base font-medium focus:ring-2 focus:ring-blue-500 text-slate-900">
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-700 mb-1">Data de Nascimento</label>
                <input type="text" id="campo_data_nascimento" placeholder="DD/MM/AAAA" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-700 mb-1">CPF</label>
                <input type="text" id="campo_cpf" placeholder="000.000.000-00" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-700 mb-1">Naturalidade (Município / UF)</label>
                <div class="flex gap-1.5">
                  <input type="text" id="campo_naturalidade_municipio" placeholder="Município" class="w-3/4 bg-white border border-slate-300 rounded px-2.5 py-1.5">
                  <input type="text" id="campo_naturalidade_uf" placeholder="UF" maxlength="2" class="w-1/4 bg-white border border-slate-300 rounded px-2 py-1.5 uppercase text-center">
                </div>
              </div>

              <div class="sm:col-span-3">
                <label class="block text-xs font-medium text-slate-700 mb-1">Nacionalidade</label>
                <input type="text" id="campo_nacionalidade" value="BRASILEIRA" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5">
              </div>

              <div class="sm:col-span-3">
                <label class="block text-xs font-medium text-slate-700 mb-1">Filiação 1 (Nome da Mãe)</label>
                <input type="text" id="campo_filiacao_1" placeholder="Nome completo da filiação 1" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5">
              </div>

              <div class="sm:col-span-3">
                <label class="block text-xs font-medium text-slate-700 mb-1">Filiação 2 (Nome do Pai)</label>
                <input type="text" id="campo_filiacao_2" placeholder="Nome completo da filiação 2" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5">
              </div>
            </div>
          </div>

          <!-- SEÇÃO 2: DOCUMENTAÇÃO CIVIL ANTIGA (OPCIONAL) -->
          <div class="border-t border-slate-200 pt-4">
            <details class="group">
              <summary class="cursor-pointer text-xs font-bold text-blue-700 uppercase tracking-wider flex items-center justify-between list-none">
                <span class="flex items-center gap-2">
                  <span>📜</span> Certidão de Nascimento e Documentos Antigos (Clique para expandir)
                </span>
                <span class="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div class="grid grid-cols-2 sm:grid-cols-6 gap-3 mt-3 text-sm bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-slate-600 mb-1">Tipo de Certidão</label>
                  <select id="campo_certidao_tipo" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                    <option value="Nascimento">Nascimento</option>
                    <option value="Casamento">Casamento</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-600 mb-1">Termo</label>
                  <input type="text" id="campo_certidao_termo" placeholder="Ex: 1420" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-600 mb-1">Livro</label>
                  <input type="text" id="campo_certidao_livro" placeholder="Ex: A-24" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-600 mb-1">Folha</label>
                  <input type="text" id="campo_certidao_folha" placeholder="Ex: 88" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-600 mb-1">RG Nº / UF</label>
                  <input type="text" id="campo_rg_numero" placeholder="RG antigo" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                </div>
                <div class="sm:col-span-4">
                  <label class="block text-xs font-medium text-slate-600 mb-1">Cartório do Registro Civil</label>
                  <input type="text" id="campo_certidao_cartorio" placeholder="Nome do cartório / comarca" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                </div>
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-slate-600 mb-1">CPF (se houver)</label>
                  <input type="text" id="campo_cpf" placeholder="000.000.000-00" class="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs">
                </div>
              </div>
            </details>
          </div>

          <!-- SEÇÃO 3: MATRIZ CURRICULAR DE SÉRIES E NOTAS -->
          <div class="border-t border-slate-200 pt-5">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span>📊</span> Matriz de Séries Cursadas e Notas Curriculares
                </h3>
                <p class="text-xs text-slate-500">Células de séries não cursadas recebem automaticamente traços '---' na impressão oficial.</p>
              </div>

              <!-- BOTÃO ADICIONAR DISCIPLINA MANUAL -->
              <button type="button" id="btnAdicionarDisciplinaManual" class="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-300 flex items-center gap-1.5">
                <span>➕</span> Inserir Nova Matéria
              </button>
            </div>

            <!-- CATÁLOGO RÁPIDO DE DISCIPLINAS HISTÓRICAS (1 CLIQUE) -->
            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
              <span class="text-xs font-semibold text-slate-600 block mb-2">Adicionar Disciplina Antiga em 1 Clique:</span>
              <div class="flex flex-wrap gap-1.5" id="containerBotoesRapidos"></div>
            </div>

            <!-- TABELA MATRICIAL SCROLLÁVEL -->
            <div class="overflow-x-auto border border-slate-300 rounded-lg shadow-inner bg-white">
              <table class="w-full text-xs border-collapse text-left" id="tabelaMatrizNotas">
                <!-- Renderizada via JavaScript -->
              </table>
            </div>
          </div>

          <!-- SEÇÃO 4: OBSERVAÇÕES E LEIS HISTÓRICAS -->
          <div class="border-t border-slate-200 pt-4">
            <label class="block text-xs font-bold text-slate-700 mb-1">
              Observações do Histórico (Leis da Época, Equivalências ou Ressalvas)
            </label>
            <textarea id="campo_observacoes" rows="2" placeholder="Ex: Concluiu o 1º Grau conforme Lei Federal nº 5.692/71. Escola autorizada pela Portaria CEE nº..." class="w-full bg-white border border-slate-300 rounded p-2.5 text-xs focus:ring-2 focus:ring-blue-500 text-slate-800"></textarea>
          </div>

          <!-- BOTÕES DE AÇÃO PRINCIPAIS E MODO DIGITAÇÃO TURBO -->
          <div class="border-t border-slate-200 pt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" id="btnCancelarEdicao" class="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors flex items-center gap-1.5">
              <span>←</span> Cancelar / Voltar
            </button>

            <div class="flex items-center gap-2">
              <!-- MODO DIGITAÇÃO TURBO: Mantém escola, regime e matérias -->
              <button type="button" id="btnSalvarTurbo" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow flex items-center gap-2 transition-all">
                <span>⚡</span> Salvar e Criar Próximo da Mesma Época
              </button>

              <!-- SALVAR HISTÓRICO NORMAL -->
              <button type="button" id="btnSalvarHistoricoNormal" class="bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow flex items-center gap-2 transition-all">
                <span>💾</span> Salvar Histórico Escolar
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    this.conectarEventosCabecalho();
    this.renderizarBotoesRapidosDisciplinas();
    this.renderizarTabelaMatriz();
  }

  conectarEventosCabecalho() {
    document.getElementById("btnRegime8")?.addEventListener("click", () => this.alterarRegime("8_ANOS"));
    document.getElementById("btnRegime9")?.addEventListener("click", () => this.alterarRegime("9_ANOS"));
    document.getElementById("btnRegimeEJA")?.addEventListener("click", () => this.alterarRegime("EJA_ETAPAS"));

    document.getElementById("btnAdicionarDisciplinaManual")?.addEventListener("click", () => {
      const nome = prompt("Digite o nome da nova disciplina:");
      if (nome && nome.trim()) {
        const cat = confirm("Esta disciplina pertence à BASE NACIONAL COMUM?\n(Clique 'OK' para Base Comum ou 'Cancelar' para Parte Diversificada)") ? "BASE_COMUM" : "DIVERSIFICADA";
        this.adicionarDisciplinaRapida(nome.trim(), cat);
      }
    });

    document.getElementById("btnSalvarHistoricoNormal")?.addEventListener("click", () => this.salvarDados(false));
    document.getElementById("btnSalvarTurbo")?.addEventListener("click", () => this.salvarDados(true));
    document.getElementById("btnCancelarEdicao")?.addEventListener("click", () => this.fechar());
    document.getElementById("btnFecharTopoMatriz")?.addEventListener("click", () => this.fechar());
  }

  renderizarBotoesRapidosDisciplinas() {
    const box = document.getElementById("containerBotoesRapidos");
    if (!box) return;

    box.innerHTML = this.catalogoDisciplinasClassicas.map(d => `
      <button type="button" class="bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-700 border border-slate-200 px-2 py-1 rounded text-[11px] font-medium transition-all" onclick="window.editorMatriz.adicionarDisciplinaRapida('${d.nome}', '${d.cat}')">
        + ${d.nome}
      </button>
    `).join("");
  }

  renderizarTabelaMatriz() {
    const tabela = document.getElementById("tabelaMatrizNotas");
    if (!tabela) return;

    let html = `
      <thead>
        <!-- LINHA 1: CABEÇALHO DAS SÉRIES -->
        <tr class="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
          <th class="p-2.5 w-64 border-r border-slate-300">DISCIPLINAS / SÉRIES</th>
          ${this.seriesColunas.map(s => `
            <th class="p-2 text-center border-r border-slate-300 min-w-[90px]">
              <span class="block text-blue-900">${s.label}</span>
            </th>
          `).join("")}
          <th class="p-2 w-12 text-center">AÇÃO</th>
        </tr>

        <!-- LINHA 2: ANO LETIVO DA SÉRIE -->
        <tr class="bg-slate-50 border-b border-slate-200 text-slate-600">
          <td class="p-2 font-semibold border-r border-slate-300 text-slate-700">Ano Letivo:</td>
          ${this.seriesColunas.map(s => `
            <td class="p-1 border-r border-slate-300">
              <input type="text" id="ano_letivo_col_${s.col}" placeholder="Ano" value="${s.ano_letivo || ''}" class="w-full text-center bg-white border border-slate-300 rounded py-1 text-xs font-semibold text-slate-800">
            </td>
          `).join("")}
          <td></td>
        </tr>

        <!-- LINHA 3: ESTABELECIMENTO / ESCOLA -->
        <tr class="bg-slate-50 border-b border-slate-200 text-slate-600">
          <td class="p-2 font-semibold border-r border-slate-300 text-slate-700">Escola / Estabelecimento:</td>
          ${this.seriesColunas.map(s => `
            <td class="p-1 border-r border-slate-300">
              <input type="text" id="escola_nome_col_${s.col}" placeholder="Escola" value="${s.escola_nome || ''}" class="w-full text-center bg-white border border-slate-300 rounded py-1 text-[11px] text-slate-800">
            </td>
          `).join("")}
          <td></td>
        </tr>

        <!-- LINHA 4: MUNICÍPIO / UF -->
        <tr class="bg-slate-50 border-b border-slate-200 text-slate-600">
          <td class="p-2 font-semibold border-r border-slate-300 text-slate-700">Município / UF:</td>
          ${this.seriesColunas.map(s => `
            <td class="p-1 border-r border-slate-300">
              <input type="text" id="escola_mun_col_${s.col}" placeholder="Mun/UF" value="${s.escola_municipio_uf || ''}" class="w-full text-center bg-white border border-slate-300 rounded py-1 text-[11px] text-slate-800">
            </td>
          `).join("")}
          <td></td>
        </tr>

        <!-- LINHA 5: RESULTADO FINAL -->
        <tr class="bg-blue-50/60 border-b-2 border-slate-300 text-slate-700 font-bold">
          <td class="p-2 border-r border-slate-300 text-blue-900">Resultado da Série:</td>
          ${this.seriesColunas.map(s => `
            <td class="p-1 border-r border-slate-300">
              <select id="resultado_col_${s.col}" class="w-full bg-white border border-blue-300 rounded py-1 text-xs font-bold text-slate-800">
                <option value="Aprovado" ${s.resultado_final === 'Aprovado' ? 'selected' : ''}>Aprovado</option>
                <option value="Promovido" ${s.resultado_final === 'Promovido' ? 'selected' : ''}>Promovido</option>
                <option value="Reprovado" ${s.resultado_final === 'Reprovado' ? 'selected' : ''}>Reprovado</option>
                <option value="Transferido" ${s.resultado_final === 'Transferido' ? 'selected' : ''}>Transferido</option>
                <option value="Desistente" ${s.resultado_final === 'Desistente' ? 'selected' : ''}>Desistente</option>
                <option value="Não Cursado" ${s.resultado_final === 'Não Cursado' ? 'selected' : ''}>Não Cursado</option>
              </select>
            </td>
          `).join("")}
          <td></td>
        </tr>
      </thead>
      <tbody>
    `;

    // CORPO: DISCIPLINAS DA BASE COMUM E DIVERSIFICADA
    const baseComum = this.disciplinas.filter(d => d.categoria === "BASE_COMUM");
    const diversificada = this.disciplinas.filter(d => d.categoria === "DIVERSIFICADA");
    let contadorZebra = 0;

    if (baseComum.length > 0) {
      html += `
        <tr class="secao-cat bg-slate-200/80 font-bold text-slate-700">
          <td colspan="${this.seriesColunas.length + 2}" class="p-2 tracking-wider uppercase text-[11px]">
            I - Base Nacional Comum
          </td>
        </tr>
      `;
      baseComum.forEach(d => {
        html += this.gerarLinhaDisciplinaHtml(d, contadorZebra++);
      });
    }

    if (diversificada.length > 0) {
      html += `
        <tr class="secao-cat bg-slate-200/80 font-bold text-slate-700">
          <td colspan="${this.seriesColunas.length + 2}" class="p-2 tracking-wider uppercase text-[11px]">
            II - Parte Diversificada
          </td>
        </tr>
      `;
      diversificada.forEach(d => {
        html += this.gerarLinhaDisciplinaHtml(d, contadorZebra++);
      });
    }

    html += "</tbody>";
    tabela.innerHTML = html;
  }

  gerarLinhaDisciplinaHtml(disc, index = 0) {
    const zebraClasse = (index % 2 === 0) ? "linha-impar" : "linha-par";
    return `
      <tr class="linha-disciplina ${zebraClasse} border-b border-slate-200 transition-colors">
        <td class="p-2 font-medium text-slate-800 border-r border-slate-300">
          <input type="text" value="${disc.nome}" onchange="window.editorMatriz.atualizarNomeDisciplina('${disc.id}', this.value)" class="input-disciplina-nome w-full bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus:border-blue-500 px-1 py-0.5 text-xs font-semibold">
        </td>
        ${this.seriesColunas.map(s => {
          const valNota = disc.notas[s.col] !== undefined ? disc.notas[s.col] : "";
          return `
            <td class="p-1 border-r border-slate-300 celula-nota">
              <input type="text" id="nota_${disc.id}_col_${s.col}" value="${valNota}" placeholder="---" onchange="window.editorMatriz.atualizarNota('${disc.id}', ${s.col}, this.value)" class="input-nota w-full text-center border border-slate-300 rounded py-1 text-xs font-bold text-slate-900 transition-all">
            </td>
          `;
        }).join("")}
        <td class="p-1 text-center">
          <button type="button" title="Excluir Matéria" onclick="window.editorMatriz.removerDisciplina('${disc.id}')" class="btn-excluir-materia text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1 rounded font-bold">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }

  atualizarNomeDisciplina(discId, novoNome) {
    const d = this.disciplinas.find(item => item.id === discId);
    if (d && novoNome.trim()) {
      d.nome = novoNome.trim();
    }
  }

  atualizarNota(discId, col, valor) {
    const d = this.disciplinas.find(item => item.id === discId);
    if (d) {
      d.notas[col] = valor.trim();
    }
  }

  // Preenche todo o formulário com os dados carregados de um aluno existente ou rascunho
  carregarDadosAlunoCompleto(aluno, vidaEscolar = [], notasCurriculares = []) {
    this.alunoAtualUuid = aluno.uuid || null;
    this.alterarRegime(aluno.regime_ensino || "8_ANOS");

    document.getElementById("campo_nome_completo").value = aluno.nome_completo || "";
    document.getElementById("campo_data_nascimento").value = aluno.data_nascimento || "";
    document.getElementById("campo_cpf").value = aluno.cpf || "";
    document.getElementById("campo_naturalidade_municipio").value = aluno.naturalidade_municipio || "";
    document.getElementById("campo_naturalidade_uf").value = aluno.naturalidade_uf || "";
    document.getElementById("campo_nacionalidade").value = aluno.nacionalidade || "BRASILEIRA";
    document.getElementById("campo_filiacao_1").value = aluno.filiacao_1 || "";
    document.getElementById("campo_filiacao_2").value = aluno.filiacao_2 || "";

    if (document.getElementById("campo_certidao_tipo")) document.getElementById("campo_certidao_tipo").value = aluno.certidao_tipo || "Nascimento";
    if (document.getElementById("campo_certidao_termo")) document.getElementById("campo_certidao_termo").value = aluno.certidao_termo || "";
    if (document.getElementById("campo_certidao_livro")) document.getElementById("campo_certidao_livro").value = aluno.certidao_livro || "";
    if (document.getElementById("campo_certidao_folha")) document.getElementById("campo_certidao_folha").value = aluno.certidao_folha || "";
    if (document.getElementById("campo_rg_numero")) document.getElementById("campo_rg_numero").value = aluno.rg_numero || "";
    if (document.getElementById("campo_certidao_cartorio")) document.getElementById("campo_certidao_cartorio").value = aluno.certidao_cartorio || "";

    document.getElementById("campo_observacoes").value = aluno.observacoes_historico || "";

    // Reconstrói Séries / Vida Escolar
    vidaEscolar.forEach(v => {
      const col = v.ordem_coluna;
      const elAno = document.getElementById(`ano_letivo_col_${col}`);
      const elEscola = document.getElementById(`escola_nome_col_${col}`);
      const elMun = document.getElementById(`escola_mun_col_${col}`);
      const elRes = document.getElementById(`resultado_col_${col}`);

      if (elAno) elAno.value = v.ano_letivo || "";
      if (elEscola) elEscola.value = v.escola_nome || "";
      if (elMun) elMun.value = v.escola_municipio_uf || "";
      if (elRes && v.resultado_final) elRes.value = v.resultado_final;
    });

    // Reconstrói Disciplinas e Notas
    if (notasCurriculares && notasCurriculares.length > 0) {
      // Agrupa notas por nome da disciplina
      const mapDisc = new Map();
      notasCurriculares.forEach(n => {
        const key = n.disciplina_nome.trim();
        if (!mapDisc.has(key)) {
          mapDisc.set(key, {
            id: "disc_" + Math.random().toString(36).substr(2, 9),
            nome: key,
            categoria: n.categoria || "BASE_COMUM",
            notas: {}
          });
        }
        mapDisc.get(key).notas[n.ordem_coluna] = n.nota_ou_conceito || "";
      });
      this.disciplinas = Array.from(mapDisc.values());
      this.renderizarTabelaMatriz();
    }
  }

  coletarPayloadDados() {
    const nomeCompleto = document.getElementById("campo_nome_completo")?.value?.trim();
    if (!nomeCompleto) {
      alert("Por favor, preencha o Nome Completo do estudante.");
      document.getElementById("campo_nome_completo")?.focus();
      return null;
    }

    const aluno = {
      uuid: this.alunoAtualUuid,
      escola_id: window.configManagerAtual?.escola_id || 1,
      nome_completo: nomeCompleto,
      data_nascimento: document.getElementById("campo_data_nascimento")?.value?.trim() || null,
      cpf: document.getElementById("campo_cpf")?.value?.trim() || null,
      naturalidade_municipio: document.getElementById("campo_naturalidade_municipio")?.value?.trim() || null,
      naturalidade_uf: document.getElementById("campo_naturalidade_uf")?.value?.trim()?.toUpperCase() || null,
      nacionalidade: document.getElementById("campo_nacionalidade")?.value?.trim() || "BRASILEIRA",
      filiacao_1: document.getElementById("campo_filiacao_1")?.value?.trim() || null,
      filiacao_2: document.getElementById("campo_filiacao_2")?.value?.trim() || null,
      rg_numero: document.getElementById("campo_rg_numero")?.value?.trim() || null,
      certidao_tipo: document.getElementById("campo_certidao_tipo")?.value || "Nascimento",
      certidao_termo: document.getElementById("campo_certidao_termo")?.value?.trim() || null,
      certidao_livro: document.getElementById("campo_certidao_livro")?.value?.trim() || null,
      certidao_folha: document.getElementById("campo_certidao_folha")?.value?.trim() || null,
      certidao_cartorio: document.getElementById("campo_certidao_cartorio")?.value?.trim() || null,
      regime_ensino: this.regimeAtual,
      observacoes_historico: document.getElementById("campo_observacoes")?.value?.trim() || null,
      status_ficha: "DIGITADO"
    };

    // Coleta Séries / Vida Escolar
    const vidaEscolar = this.seriesColunas.map(s => {
      const col = s.col;
      return {
        ordem_coluna: col,
        label_serie: s.label,
        ano_letivo: document.getElementById(`ano_letivo_col_${col}`)?.value?.trim() || null,
        escola_nome: document.getElementById(`escola_nome_col_${col}`)?.value?.trim() || null,
        escola_municipio_uf: document.getElementById(`escola_mun_col_${col}`)?.value?.trim() || null,
        resultado_final: document.getElementById(`resultado_col_${col}`)?.value || "Aprovado"
      };
    });

    // Coleta Notas Curriculares
    const notas = [];
    let ordemSeq = 1;
    this.disciplinas.forEach(d => {
      this.seriesColunas.forEach(s => {
        const inputVal = document.getElementById(`nota_${d.id}_col_${s.col}`)?.value?.trim();
        notas.push({
          ordem_coluna: s.col,
          categoria: d.categoria,
          ordem_disciplina: ordemSeq,
          disciplina_nome: d.nome,
          nota_ou_conceito: inputVal || "---"
        });
      });
      ordemSeq++;
    });

    return { aluno, vida_escolar: vidaEscolar, notas_curriculares: notas };
  }

  async salvarDados(modoTurbo = false) {
    const payload = this.coletarPayloadDados();
    if (!payload) return;

    try {
      const btn = modoTurbo ? document.getElementById("btnSalvarTurbo") : document.getElementById("btnSalvarHistoricoNormal");
      const textoOriginal = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span> Salvando com HMAC...`;

      const response = await fetch("/api/alunos/historico-completo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const res = await response.json();
      btn.disabled = false;
      btn.innerHTML = textoOriginal;

      if (!response.ok || !res.sucesso) {
        alert(res.detail || "Erro ao salvar histórico escolar.");
        return;
      }

      alert(`✓ Histórico salvo com sucesso!\nCódigo de Autenticidade: ${res.codigo_autenticidade}`);

      if (modoTurbo) {
        // MODO TURBO: Mantém estante, caixa, ano, escola e grade de matérias.
        // Limpa apenas dados civis e notas para o próximo ex-aluno da mesma pasta.
        this.alunoAtualUuid = null;
        document.getElementById("campo_nome_completo").value = "";
        document.getElementById("campo_data_nascimento").value = "";
        document.getElementById("campo_filiacao_1").value = "";
        document.getElementById("campo_filiacao_2").value = "";
        document.getElementById("campo_cpf").value = "";
        if (document.getElementById("campo_rg_numero")) document.getElementById("campo_rg_numero").value = "";
        if (document.getElementById("campo_certidao_termo")) document.getElementById("campo_certidao_termo").value = "";
        if (document.getElementById("campo_certidao_livro")) document.getElementById("campo_certidao_livro").value = "";
        if (document.getElementById("campo_certidao_folha")) document.getElementById("campo_certidao_folha").value = "";

        // Limpa inputs de notas
        this.disciplinas.forEach(d => {
          this.seriesColunas.forEach(s => {
            const inputNota = document.getElementById(`nota_${d.id}_col_${s.col}`);
            if (inputNota) inputNota.value = "";
          });
        });

        document.getElementById("campo_nome_completo").focus();
      } else {
        // Modo Normal: Recarrega a listagem geral
        if (window.appMain && window.appMain.recarregarListaAlunos) {
          window.appMain.recarregarListaAlunos();
          window.appMain.fecharModalEdicao();
        }
      }

    } catch (e) {
      alert(`Erro na comunicação: ${e.message}`);
    }
  }
}

// Inicializador global
window.EditorMatrizHistorico = EditorMatrizHistorico;
