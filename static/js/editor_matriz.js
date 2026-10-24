/**
 * SGM-Históricos — editor_matriz.js
 * Módulo da Planilha Matricial de Arquivo Passivo e Modo Digitação Turbo
 * Padrão UI/UX Pro Max (Data-Dense Dashboard - Densidade 8/10)
 * 
 * Recursos Avançados:
 * - Navegação Matricial 2D por Teclado (Padrão Planilha Excel: Setas/Enter);
 * - Automação inteligente de Coluna "Não Cursado" (Atenuação e traços '---');
 * - Adição rápida de Disciplinas Históricas sem prompt() nativo (Barra inline + Chips);
 * - Modo Digitação Turbo com contador de produtividade em sessão contínua;
 * - Validação em tempo real e persistência com integridade HMAC-SHA256.
 */

class EditorMatrizHistorico {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.regimeAtual = "8_ANOS";
    this.seriesColunas = [];
    this.disciplinas = [];
    this.alunoAtualUuid = null;
    this.contadorTurbo = 0;
    this.cardSerieIndex = 0;

    // Catálogos para adição rápida (Base Comum complementar e Parte Diversificada oficial)
    this.catalogoBaseComum = [
      "Língua Inglesa",
      "Educação Moral e Cívica",
      "Organização Social e Política do Brasil",
      "Ciências Físicas e Biológicas"
    ];

    this.catalogoDiversificada = [
      "Ensino da Língua Portuguesa",
      "Ensino da Matemática",
      "Esporte e Lazer",
      "Arte e Cultura",
      "Educação Ambiental",
      "Comunicação: Cultura Digital e Tecnológica",
      "Língua Estrangeira"
    ];

    this.definirColunasPorRegime("8_ANOS");
    this.carregarGradePadraoInicial();
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
    this.disciplinas = [
      { id: "disc_1", nome: "Língua Portuguesa", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_2", nome: "Matemática", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_3", nome: "Ciências", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_4", nome: "Geografia", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_5", nome: "História", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_6", nome: "Arte", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_7", nome: "Educação Física", categoria: "BASE_COMUM", notas: {} },
      { id: "disc_8", nome: "Ensino Religioso", categoria: "BASE_COMUM", notas: {} }
    ];
  }

  sincronizarDadosDigitados() {
    // 1. Salva notas digitadas
    this.disciplinas.forEach(d => {
      this.seriesColunas.forEach(s => {
        const input = document.getElementById(`nota_${d.id}_col_${s.col}`);
        if (input) {
          if (!d.notas) d.notas = {};
          d.notas[s.col] = input.value.trim();
        }
      });
    });

    // 2. Salva dados de cada série
    this.seriesColunas.forEach(s => {
      s.ano_letivo = document.getElementById(`ano_letivo_col_${s.col}`)?.value?.trim() || s.ano_letivo || "";
      s.escola_nome = document.getElementById(`escola_nome_col_${s.col}`)?.value?.trim() || s.escola_nome || "";
      s.escola_municipio_uf = document.getElementById(`escola_mun_col_${s.col}`)?.value?.trim() || s.escola_municipio_uf || "";
      s.turno = document.getElementById(`turno_col_${s.col}`)?.value?.trim() || s.turno || "DIURNO";
      s.resultado_final = document.getElementById(`resultado_col_${s.col}`)?.value || s.resultado_final || "Aprovado";
    });
  }

  adicionarDisciplinaRapida(nome, categoria = "BASE_COMUM") {
    const jaExiste = this.disciplinas.some(d => d.nome.toLowerCase() === nome.toLowerCase());
    if (jaExiste) {
      window.sgmToast.info(`A disciplina "${nome}" já consta na matriz.`, "Disciplina Existente");
      return;
    }
    this.sincronizarDadosDigitados();
    const novoId = "disc_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    this.disciplinas.push({
      id: novoId,
      nome: nome,
      categoria: categoria,
      notas: {}
    });
    this.renderizarTabelaMatriz();
    this.renderizarBotoesRapidosDisciplinas();
    window.sgmToast.success(`Disciplina "${nome}" adicionada à grade.`, "Matriz Atualizada");
  }

  removerDisciplina(id) {
    this.sincronizarDadosDigitados();
    this.disciplinas = this.disciplinas.filter(d => d.id !== id);
    this.renderizarTabelaMatriz();
    this.renderizarBotoesRapidosDisciplinas();
  }

  alterarRegime(novoRegime) {
    if (this.regimeAtual === novoRegime) return;
    this.sincronizarDadosDigitados();
    this.definirColunasPorRegime(novoRegime);
    this.cardSerieIndex = 0;
    this.renderizarInterfaceCompleta();
    window.sgmToast?.info(`Regime alterado para ${novoRegime === '9_ANOS' ? '9 Anos (1º–9º)' : (novoRegime === 'EJA_ETAPAS' ? 'EJA (Etapas)' : '8 Séries (1ª–8ª)')}.`, "Regime Atualizado");
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
      <div class="bg-white dark:bg-[#2D2D2D] rounded-xl shadow-2xl border border-slate-200 dark:border-[#454545] overflow-hidden">
        
        <!-- CABEÇALHO DO FORMULÁRIO MATRICIAL -->
        <div class="bg-slate-50 dark:bg-[#1E1E1E] border-b border-slate-200 dark:border-[#454545] p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-blue-100 dark:bg-[#84167A]/40 text-blue-700 dark:text-purple-300 flex items-center justify-center shrink-0">
              ${window.sgmIcons.get('fileText', { size: 18 })}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                  Ficha de Histórico Escolar (Arquivo Passivo)
                </h2>
                <span id="badgeTurboSessao" class="hidden text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-mono animate-pulse">
                  TURBO ATIVO
                </span>
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">Preenchimento livre. Nenhum documento civil é obrigatório para resgate de ex-alunos antigos.</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- SELETOR DE REGIME EM 1 CLIQUE -->
            <div class="flex items-center gap-1 bg-white dark:bg-[#141414] p-1 rounded-lg border border-slate-300 dark:border-[#454545] text-xs font-semibold">
              <button type="button" id="btnRegime8" class="px-2.5 py-1 rounded transition-all ${this.regimeAtual === '8_ANOS' ? 'bg-blue-700 dark:bg-[#84167A] text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#252525]'}">
                1ª a 8ª Série (8 Anos)
              </button>
              <button type="button" id="btnRegime9" class="px-2.5 py-1 rounded transition-all ${this.regimeAtual === '9_ANOS' ? 'bg-blue-700 dark:bg-[#84167A] text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#252525]'}">
                1º ao 9º Ano (9 Anos)
              </button>
              <button type="button" id="btnRegimeEJA" class="px-2.5 py-1 rounded transition-all ${this.regimeAtual === 'EJA_ETAPAS' ? 'bg-blue-700 dark:bg-[#84167A] text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#252525]'}">
                EJA (Etapas)
              </button>
            </div>

            <!-- BOTÃO FECHAR NO TOPO -->
            <button type="button" id="btnFecharTopoMatriz" title="Voltar / Fechar" class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#383838] transition">
              ${window.sgmIcons.get('x', { size: 18 })}
            </button>
          </div>
        </div>

        <div class="p-4 sm:p-5 space-y-4 max-h-[82vh] overflow-y-auto">

          <!-- SEÇÃO 1: DADOS CIVIS DO ESTUDANTE (MODELO LIMPO SMEJ) -->
          <div class="bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 rounded-xl border border-slate-200 dark:border-[#454545] space-y-3">
            <h3 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              ${window.sgmIcons.get('user', { size: 14, className: 'text-blue-600' })}
              <span>Identificação Civil do Estudante</span>
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div class="sm:col-span-2">
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Nome Civil Completo *</label>
                <input type="text" id="campo_nome_completo" required placeholder="Nome completo civil do estudante" class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-3 py-1.5 text-sm font-semibold focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100">
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Data de Nascimento</label>
                <input type="text" id="campo_data_nascimento" placeholder="DD/MM/AAAA" class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1.5 font-mono">
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">CPF (se houver)</label>
                <input type="text" id="campo_cpf" placeholder="000.000.000-00" class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1.5 font-mono">
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Naturalidade (Município / UF)</label>
                <div class="flex gap-1.5">
                  <input type="text" id="campo_naturalidade_municipio" placeholder="Município" class="w-3/4 bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1.5">
                  <input type="text" id="campo_naturalidade_uf" placeholder="UF" maxlength="2" class="w-1/4 bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2 py-1.5 uppercase text-center font-mono">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Nacionalidade</label>
                <input type="text" id="campo_nacionalidade" value="BRASILEIRA" class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1.5 uppercase font-medium">
              </div>

              <div class="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Filiação 1 (Nome da Mãe)</label>
                  <input type="text" id="campo_filiacao_1" placeholder="Nome completo da mãe" class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1.5">
                </div>
                <div>
                  <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Filiação 2 (Nome do Pai)</label>
                  <input type="text" id="campo_filiacao_2" placeholder="Nome completo do pai (se constar)" class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1.5">
                </div>
              </div>
            </div>
          </div>

          <!-- SEÇÃO 2: MATRIZ CURRICULAR DE SÉRIES E NOTAS (NAVEGAÇÃO 2D) -->
          <div class="space-y-3">
            <!-- TOPO DA SEÇÃO 2: TÍTULO E INSTRUÇÕES -->
            <div class="text-left">
              <h3 class="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                ${window.sgmIcons.get('sparkles', { size: 14, className: 'text-amber-500' })}
                <span>Matriz Curricular de Séries e Notas</span>
              </h3>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                Navegue com <b>setas do teclado</b> ou <b>Enter</b>. Células de séries não cursadas recebem traços '---'.
              </p>
            </div>

            <!-- SELETOR RÁPIDO DE ANOS (PÍLULAS SUPERIORES) -->
            <div class="flex items-center justify-center gap-1 overflow-x-auto py-1" id="editorTabsSeries"></div>

            <!-- CARROSSEL: SETA ESQUERDA (15%) + CARD 1 ANO (70%) + SETA DIREITA (15%) -->
            <div class="flex items-center justify-between gap-2 w-full my-1">
              
              <!-- SETA ESQUERDA (15%) -->
              <div class="w-[15%] flex justify-center">
                <button id="btnEditorSerieAnterior" type="button" title="Ano Anterior (Seta Esquerda)"
                  class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-slate-100 hover:bg-blue-50 dark:bg-[#1E1E1E] dark:hover:bg-[#383838] border border-slate-300 dark:border-[#454545] text-slate-700 dark:text-slate-200 shadow-sm transition active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer">
                  ${window.sgmIcons.get('chevronLeft', { size: 24 })}
                </button>
              </div>

              <!-- CARD CENTRAL (70% DE LARGURA) -->
              <div class="w-[70%] relative overflow-hidden" id="editorCardContainer">
                <!-- Cards de cada ano gerados com padrão carrossel -->
              </div>

              <!-- SETA DIREITA (15%) -->
              <div class="w-[15%] flex justify-center">
                <button id="btnEditorSerieProximo" type="button" title="Próximo Ano (Seta Direita)"
                  class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-slate-100 hover:bg-blue-50 dark:bg-[#1E1E1E] dark:hover:bg-[#383838] border border-slate-300 dark:border-[#454545] text-slate-700 dark:text-slate-200 shadow-sm transition active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer">
                  ${window.sgmIcons.get('chevronRight', { size: 24 })}
                </button>
              </div>

            </div>

            <!-- ÁREA DO BOTÃO E PAINEL EXPANSÍVEL (EXATAMENTE ALINHADOS COM O CARD CENTRAL DE 70%) -->
            <div class="flex items-start justify-between gap-2 w-full">
              <!-- ESPAÇADOR ESQUERDO (15% PARA ALINHAMENTO EXATO COM CARD CENTRAL) -->
              <div class="w-[15%] shrink-0"></div>

              <!-- CONTAINER CENTRAL DO BOTÃO E PAINEL (70% DE LARGURA) -->
              <div class="w-[70%] space-y-2">
                <!-- BOTÃO "+ ADICIONAR / GERENCIAR DISCIPLINAS" -->
                <button type="button" id="btnToggleGerenciarDisciplinas"
                  class="w-full px-3.5 py-2 rounded-xl bg-blue-50/80 hover:bg-blue-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 text-blue-700 dark:text-purple-300 font-bold border border-blue-200 dark:border-purple-800 text-xs flex items-center justify-between shadow-2xs transition active:scale-[0.99] cursor-pointer">
                  <span class="flex items-center gap-2">
                    ${window.sgmIcons.get('plus', { size: 14 })}
                    <span>Adicionar / Gerenciar Disciplinas</span>
                  </span>
                  <span id="iconeSetaGavetaDisciplinas" class="text-slate-400 dark:text-slate-500 transition-transform duration-200">
                    ${window.sgmIcons.get('chevronDown', { size: 14 })}
                  </span>
                </button>

                <!-- PAINEL EXPANSÍVEL (GAVETA ACCORDION) — OCULTO POR PADRÃO -->
                <div id="painelExpansivelDisciplinas" class="hidden w-full bg-slate-50/90 dark:bg-[#1E1E1E] p-3.5 rounded-xl border border-slate-300 dark:border-[#454545] space-y-3 shadow-sm transition-all duration-300">
                  <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#383838]">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-bold text-slate-800 dark:text-slate-200">Gerenciador de Disciplinas da Matriz</span>
                      <span class="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">• Digite o nome de outra disciplina ou clique nos atalhos oficiais</span>
                    </div>

                    <!-- FORMULÁRIO DE NOVA DISCIPLINA PERSONALIZADA -->
                    <div class="flex items-center gap-1.5">
                      <input type="text" id="inputNovaDiscNome" placeholder="Nova disciplina..." class="bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2.5 py-1 text-xs w-44 text-slate-900 dark:text-slate-100">
                      <select id="selectNovaDiscCat" class="bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-2 py-1 text-xs text-slate-800 dark:text-slate-200 font-medium">
                        <option value="BASE_COMUM">Base Comum</option>
                        <option value="DIVERSIFICADA">Parte Diversificada</option>
                      </select>
                      <button type="button" id="btnAdicionarDiscInline" class="bg-blue-700 hover:bg-blue-800 dark:bg-[#84167A] dark:hover:bg-[#9B1D90] text-white text-xs font-bold px-3 py-1 rounded-lg flex items-center gap-1 shadow-xs transition active:scale-95">
                        ${window.sgmIcons.get('plus', { size: 13 })}
                        <span>Incluir</span>
                      </button>
                    </div>
                  </div>

                  <!-- ÁREAS DE ADIÇÃO RÁPIDA: BASE COMUM E PARTE DIVERSIFICADA -->
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    
                    <!-- ÁREA 1: BASE NACIONAL COMUM (ADICIONAR) -->
                    <div class="bg-white dark:bg-[#141414] p-2.5 rounded-lg border border-slate-200 dark:border-[#383838]">
                      <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                          <span>Base Nacional Comum (Adicionar)</span>
                        </span>
                        <span class="text-[10px] text-slate-400 dark:text-slate-500">1 clique para incluir</span>
                      </div>
                      <div id="containerBotoesBaseComum" class="flex flex-wrap gap-1.5"></div>
                    </div>

                    <!-- ÁREA 2: PARTE DIVERSIFICADA (ADICIONAR) -->
                    <div class="bg-white dark:bg-[#141414] p-2.5 rounded-lg border border-slate-200 dark:border-[#383838]">
                      <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[11px] font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full bg-purple-600 dark:bg-purple-400"></span>
                          <span>Parte Diversificada (Adicionar)</span>
                        </span>
                        <span class="text-[10px] text-slate-400 dark:text-slate-500">1 clique para incluir</span>
                      </div>
                      <div id="containerBotoesDiversificada" class="flex flex-wrap gap-1.5"></div>
                    </div>

                  </div>

                  <!-- BOTÃO FECHAR PAINEL -->
                  <div class="flex justify-end pt-1">
                    <button type="button" id="btnFecharPainelDisciplinas" class="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 font-semibold px-2.5 py-1 rounded-lg hover:bg-slate-200 dark:hover:bg-[#333] transition flex items-center gap-1 cursor-pointer">
                      ${window.sgmIcons.get('check', { size: 12, className: 'text-emerald-500' })}
                      <span>Concluir e Recolher Painel</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- ESPAÇADOR DIREITO (15% PARA ALINHAMENTO EXATO COM CARD CENTRAL) -->
              <div class="w-[15%] shrink-0"></div>
            </div>
          </div>

          <!-- SEÇÃO 4: OBSERVAÇÕES E LEIS HISTÓRICAS -->
          <div class="border-t border-slate-200 dark:border-[#454545] pt-3">
            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Observações do Histórico (Leis da Época, Pareceres, Equivalências ou Ressalvas)
            </label>
            <textarea id="campo_observacoes" rows="2" placeholder="Ex: Concluiu o 1º Grau conforme Lei Federal nº 5.692/71. Escola autorizada pela Portaria CEE nº..." class="w-full bg-white dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500"></textarea>
          </div>

          <!-- BARRA DE AÇÕES PRINCIPAIS & MODO DIGITAÇÃO TURBO -->
          <div class="border-t border-slate-200 dark:border-[#454545] pt-3 flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-white dark:bg-[#2D2D2D] py-2">
            <button type="button" id="btnCancelarEdicao" class="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-[#383838] transition flex items-center gap-1.5">
              ${window.sgmIcons.get('arrowLeft', { size: 14 })}
              <span>Cancelar / Voltar</span>
            </button>

            <div class="flex items-center gap-2">
              <!-- MODO DIGITAÇÃO TURBO -->
              <button type="button" id="btnSalvarTurbo" title="Salva e preserva escola, regime, anos e disciplinas para o próximo aluno da mesma pasta" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 transition active:scale-95">
                ${window.sgmIcons.get('zap', { size: 14 })}
                <span>Salvar e Criar Próximo da Mesma Época (Turbo)</span>
              </button>

              <!-- SALVAR NORMAL -->
              <button type="button" id="btnSalvarHistoricoNormal" class="bg-blue-700 hover:bg-blue-800 dark:bg-[#84167A] dark:hover:bg-[#9B1D90] text-white px-5 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 transition active:scale-95">
                ${window.sgmIcons.get('check', { size: 14 })}
                <span>Salvar Histórico Escolar</span>
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

    // Toggle do Painel Expansível de Gerenciar Disciplinas
    document.getElementById("btnToggleGerenciarDisciplinas")?.addEventListener("click", () => {
      const painel = document.getElementById("painelExpansivelDisciplinas");
      const icone = document.getElementById("iconeSetaGavetaDisciplinas");
      if (painel) {
        const estaOculto = painel.classList.contains("hidden");
        if (estaOculto) {
          painel.classList.remove("hidden");
          if (icone) icone.classList.add("rotate-180");
          document.getElementById("inputNovaDiscNome")?.focus();
        } else {
          painel.classList.add("hidden");
          if (icone) icone.classList.remove("rotate-180");
        }
      }
    });

    document.getElementById("btnFecharPainelDisciplinas")?.addEventListener("click", () => {
      const painel = document.getElementById("painelExpansivelDisciplinas");
      const icone = document.getElementById("iconeSetaGavetaDisciplinas");
      if (painel) {
        painel.classList.add("hidden");
        if (icone) icone.classList.remove("rotate-180");
      }
    });

    // Adição rápida inline (sem prompt)
    document.getElementById("btnAdicionarDiscInline")?.addEventListener("click", () => {
      const nomeInput = document.getElementById("inputNovaDiscNome");
      const catSelect = document.getElementById("selectNovaDiscCat");
      const nome = nomeInput?.value?.trim();
      const cat = catSelect?.value || "BASE_COMUM";

      if (nome) {
        this.adicionarDisciplinaRapida(nome, cat);
        nomeInput.value = "";
      } else {
        window.sgmToast.warning("Digite o nome da disciplina para adicionar.", "Campo Obrigatório");
        nomeInput?.focus();
      }
    });

    document.getElementById("inputNovaDiscNome")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        document.getElementById("btnAdicionarDiscInline")?.click();
      }
    });

    document.getElementById("btnEditorSerieAnterior")?.addEventListener("click", () => this.mudarCardSerie(this.cardSerieIndex - 1, "prev"));
    document.getElementById("btnEditorSerieProximo")?.addEventListener("click", () => this.mudarCardSerie(this.cardSerieIndex + 1, "next"));

    // Atalhos globais do editor para navegação entre cards
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        this.mudarCardSerie(this.cardSerieIndex - 1, "prev");
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        this.mudarCardSerie(this.cardSerieIndex + 1, "next");
      }
    });

    document.getElementById("btnSalvarHistoricoNormal")?.addEventListener("click", () => this.salvarDados(false));
    document.getElementById("btnSalvarTurbo")?.addEventListener("click", () => this.salvarDados(true));
    document.getElementById("btnCancelarEdicao")?.addEventListener("click", () => this.fechar());
    document.getElementById("btnFecharTopoMatriz")?.addEventListener("click", () => this.fechar());
  }

  renderizarBotoesRapidosDisciplinas() {
    const boxBase = document.getElementById("containerBotoesBaseComum");
    const boxDiv = document.getElementById("containerBotoesDiversificada");

    const gerarChipsHtml = (catalogo, categoriaPadrao) => {
      return catalogo.map(nomeDisc => {
        const jaPresente = this.disciplinas.some(item => item.nome.toLowerCase() === nomeDisc.toLowerCase());
        const classeStatus = jaPresente
          ? "bg-slate-100 dark:bg-[#252525] text-slate-400 dark:text-slate-500 border-slate-200 dark:border-[#383838] cursor-default opacity-80"
          : "bg-white dark:bg-[#141414] hover:bg-blue-50 dark:hover:bg-[#84167A]/20 hover:text-blue-700 dark:hover:text-purple-300 hover:border-blue-300 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#454545] cursor-pointer shadow-2xs";

        const icone = jaPresente
          ? window.sgmIcons.get('check', { size: 11, className: 'text-emerald-500' })
          : window.sgmIcons.get('plus', { size: 11 });

        return `
          <button type="button" class="border px-2 py-0.5 rounded text-[11px] font-medium transition flex items-center gap-1 ${classeStatus}"
            onclick="${jaPresente ? '' : `window.editorMatriz.adicionarDisciplinaRapida('${nomeDisc.replace(/'/g, "\\'")}', '${categoriaPadrao}')`}">
            ${icone}
            <span>${nomeDisc}</span>
          </button>
        `;
      }).join("");
    };

    if (boxBase) {
      boxBase.innerHTML = gerarChipsHtml(this.catalogoBaseComum, "BASE_COMUM");
    }
    if (boxDiv) {
      boxDiv.innerHTML = gerarChipsHtml(this.catalogoDiversificada, "DIVERSIFICADA");
    }
  }

  renderizarTabelaMatriz() {
    const container = document.getElementById("editorCardContainer");
    const tabsContainer = document.getElementById("editorTabsSeries");
    if (!container) return;

    if (this.cardSerieIndex >= this.seriesColunas.length) {
      this.cardSerieIndex = 0;
    }

    // 1. Renderiza Pílulas / Tabs de Seleção Rápida
    if (tabsContainer) {
      tabsContainer.innerHTML = this.seriesColunas.map((s, idx) => `
        <button type="button" onclick="event.preventDefault(); window.editorMatriz.mudarCardSerie(${idx}, 'direct', event)"
          class="tab-serie-btn px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${idx === this.cardSerieIndex ? 'tab-ativa bg-blue-600 text-white border-blue-600' : 'bg-slate-100 dark:bg-[#1E1E1E] text-slate-600 dark:text-slate-300 border-slate-300 dark:border-[#454545] hover:bg-slate-200 dark:hover:bg-[#333]'}">
          ${s.label}
        </button>
      `).join('');
    }

    // Separa as disciplinas entre Base Comum e Parte Diversificada
    const baseComum = this.disciplinas.filter(d => (d.categoria || "BASE_COMUM") === "BASE_COMUM");
    const diversificada = this.disciplinas.filter(d => d.categoria === "DIVERSIFICADA");

    // 2. Renderiza os Cards de Cada Série dentro de editorCardContainer (70% largura no centro)
    let cardsHtml = "";
    this.seriesColunas.forEach((s, colIndex) => {
      const isAtivo = (colIndex === this.cardSerieIndex);

      let rowIdx = 0;
      const renderLinhaDisciplina = (d) => {
        const valNotaBruta = d.notas[s.col] !== undefined ? d.notas[s.col] : "";
        const valNota = this.formatarNota(valNotaBruta);
        if (valNota && valNota !== valNotaBruta) {
          d.notas[s.col] = valNota;
        }
        const rIndex = rowIdx++;
        return `
          <tr class="linha-disc-item hover:bg-slate-50 dark:hover:bg-[#252525] transition-colors" id="linha_editor_card_${s.col}_disc_${d.id}">
            <td class="py-1.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
              <input type="text" value="${d.nome}"
                class="w-full bg-transparent border-0 border-b border-transparent focus:border-blue-500 text-xs font-semibold focus:outline-none"
                onchange="window.editorMatriz.atualizarNomeDisciplina('${d.id}', this.value)">
            </td>
            <td class="py-1 px-3 w-36 text-center">
              <input type="text" id="nota_${d.id}_col_${s.col}" value="${valNota}" placeholder="---"
                data-row="${rIndex}" data-col="${colIndex}" data-serie="${s.col}"
                onfocus="if (this.value) this.select()"
                onclick="if (this.value) this.select()"
                onchange="window.editorMatriz.atualizarNota('${d.id}', ${s.col}, this.value)"
                onblur="window.editorMatriz.atualizarNota('${d.id}', ${s.col}, this.value)"
                class="input-nota w-full text-center border border-slate-300 dark:border-[#454545] bg-white dark:bg-[#141414] rounded py-0.5 px-2 text-xs font-mono font-bold transition-all text-slate-900 dark:text-slate-100">
            </td>
            <td class="py-1 px-2 text-center">
              <button type="button" onclick="window.editorMatriz.removerDisciplina('${d.id}')" class="text-rose-400 hover:text-rose-600 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition" title="Excluir disciplina">
                ${window.sgmIcons.get('trash', { size: 12 })}
              </button>
            </td>
          </tr>
        `;
      };

      let linhasTbody = "";

      // Cabeçalho da Base Nacional Comum
      if (baseComum.length > 0) {
        linhasTbody += `
          <tr class="secao-base-comum-divisor bg-slate-100/90 dark:bg-[#1E1E1E] border-b border-slate-300 dark:border-[#454545]">
            <td colspan="3" class="py-1 px-3 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span>Base Nacional Comum</span>
              </div>
            </td>
          </tr>
        `;
        linhasTbody += baseComum.map(renderLinhaDisciplina).join('');
      }

      // Separação sutil logo abaixo das disciplinas da Base Comum quando houver disciplinas da Parte Diversificada
      if (diversificada.length > 0) {
        linhasTbody += `
          <tr class="secao-diversificada-divisor bg-slate-100/90 dark:bg-[#1E1E1E] border-y border-slate-300 dark:border-[#454545]">
            <td colspan="3" class="py-1 px-3 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                <span>Parte Diversificada</span>
              </div>
            </td>
          </tr>
        `;
        linhasTbody += diversificada.map(renderLinhaDisciplina).join('');
      }

      cardsHtml += `
        <div id="editor_card_serie_col_${s.col}" class="card-serie-item ${isAtivo ? 'card-ativo flex flex-col' : 'hidden'} bg-white dark:bg-[#1C1C1C] rounded-xl border border-slate-300 dark:border-[#454545] shadow-md transition-all" data-col-index="${colIndex}">
          
          <!-- 1. CABEÇALHO DO CARD: SÉRIE / ANO (SEM INFORMAÇÃO 1 DE 9) -->
          <div class="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 dark:from-[#351034] dark:via-[#261324] dark:to-[#141414] text-white px-3.5 py-2 rounded-t-xl flex items-center justify-between shrink-0 shadow-xs">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-md bg-white/15 text-white flex items-center justify-center font-mono font-bold text-xs shrink-0">
                ${s.col}
              </span>
              <h4 class="font-bold text-sm tracking-tight text-white">
                ${s.label}
              </h4>
            </div>
            <span class="text-xs text-blue-200 dark:text-purple-200 font-medium">Lançamento de Notas</span>
          </div>

          <!-- 2. CORPO PRINCIPAL DO CARD: TABELA DE DISCIPLINAS E NOTAS (ALTURA NATURAL SEM TRAVA) -->
          <div class="bg-white dark:bg-[#252525]">
            <table class="w-full text-xs text-left border-collapse">
              <thead class="sticky top-0 z-10 bg-slate-100 dark:bg-[#1E1E1E] border-b border-slate-200 dark:border-[#383838] text-[11px] uppercase font-bold text-slate-600 dark:text-slate-300">
                <tr>
                  <th class="py-2 px-3">Disciplina Curricular</th>
                  <th class="py-2 px-3 w-36 text-center">Nota / Conceito</th>
                  <th class="py-2 px-2 w-8 text-center"></th>
                </tr>
              </thead>
              <tbody id="corpo_disciplinas_editor_card_${s.col}" class="divide-y divide-slate-100 dark:divide-[#303030]">
                ${linhasTbody}
              </tbody>
            </table>
          </div>

          <!-- 3. FINAL DO CARD: SELEÇÃO DE RESULTADO, ESTABELECIMENTO, ANO LETIVO E CIDADE/UF (COMPACTO) -->
          <div class="bg-slate-50 dark:bg-[#1A1A1A] p-2.5 border-t border-slate-200 dark:border-[#383838] rounded-b-xl space-y-2 shrink-0">
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <label class="block font-semibold text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Ano Letivo:</label>
                <input type="text" id="ano_letivo_col_${s.col}" value="${s.ano_letivo || ''}" placeholder="AAAA"
                  class="w-full text-center border rounded py-0.5 px-1.5 text-xs font-mono font-bold bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100">
              </div>
              <div class="sm:col-span-2">
                <label class="block font-semibold text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Estabelecimento / Escola:</label>
                <input type="text" id="escola_nome_col_${s.col}" value="${s.escola_nome || ''}" placeholder="Nome do estabelecimento"
                  class="w-full border rounded py-0.5 px-2 text-xs font-medium bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100">
              </div>
              <div>
                <label class="block font-semibold text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Cidade - UF:</label>
                <input type="text" id="escola_mun_col_${s.col}" value="${s.escola_municipio_uf || ''}" placeholder="Município/UF"
                  class="w-full border rounded py-0.5 px-2 text-xs bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100">
              </div>
            </div>

            <!-- RESULTADO FINAL DA SÉRIE -->
            <div class="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-[#2a2a2a] text-xs">
              <span class="font-bold text-slate-700 dark:text-slate-300 text-[11px]">Resultado da Série:</span>
              <select id="resultado_col_${s.col}" onchange="window.editorMatriz.aoAlterarResultadoSerie(${s.col}, this.value)" class="bg-white dark:bg-[#141414] text-slate-900 dark:text-slate-100 font-bold border border-blue-400 dark:border-purple-600 rounded px-2 py-0.5 text-xs focus:ring-2 focus:ring-blue-500">
                <option value="Aprovado" ${s.resultado_final === 'Aprovado' ? 'selected' : ''}>Aprovado</option>
                <option value="Promovido" ${s.resultado_final === 'Promovido' ? 'selected' : ''}>Promovido</option>
                <option value="Reprovado" ${s.resultado_final === 'Reprovado' ? 'selected' : ''}>Reprovado</option>
                <option value="Transferido" ${s.resultado_final === 'Transferido' ? 'selected' : ''}>Transferido</option>
                <option value="Desistente" ${s.resultado_final === 'Desistente' ? 'selected' : ''}>Desistente</option>
                <option value="Não Cursado" ${s.resultado_final === 'Não Cursado' ? 'selected' : ''}>Não Cursado</option>
              </select>
            </div>
            <input type="hidden" id="turno_col_${s.col}" value="${s.turno || 'DIURNO'}">
          </div>

        </div>
      `;
    });

    container.innerHTML = cardsHtml;
    this.atualizarBotoesETabsCarrossel();
    this.conectarNavegacao2DTeclado();
    this.seriesColunas.forEach(s => {
      const resVal = document.getElementById(`resultado_col_${s.col}`)?.value;
      if (resVal === "Não Cursado") {
        this.aplicarEstiloNaoCursado(s.col, true);
      }
    });
  }

  mudarCardSerie(novoIndex, direcao = "next", event = null) {
    if (event) event.preventDefault();
    if (novoIndex < 0 || novoIndex >= this.seriesColunas.length) return;
    if (novoIndex === this.cardSerieIndex) return;

    const modalCorpo = this.container.querySelector(".overflow-y-auto");
    const st = modalCorpo ? modalCorpo.scrollTop : 0;

    const colAtual = this.seriesColunas[this.cardSerieIndex].col;
    const colNova = this.seriesColunas[novoIndex].col;

    const cardAtual = document.getElementById(`editor_card_serie_col_${colAtual}`);
    const cardNovo = document.getElementById(`editor_card_serie_col_${colNova}`);

    if (cardAtual) {
      cardAtual.classList.remove("card-ativo", "anim-card-next", "anim-card-prev", "flex", "flex-col");
      cardAtual.classList.add("hidden");
    }

    this.cardSerieIndex = novoIndex;

    if (cardNovo) {
      cardNovo.classList.remove("hidden", "anim-card-next", "anim-card-prev");
      void cardNovo.offsetWidth;
      cardNovo.classList.add("card-ativo", "flex", "flex-col");
      if (direcao === "next" || direcao === "direct") {
        cardNovo.classList.add("anim-card-next");
      } else {
        cardNovo.classList.add("anim-card-prev");
      }
    }

    this.atualizarBotoesETabsCarrossel();

    if (modalCorpo) {
      modalCorpo.scrollTop = st;
      requestAnimationFrame(() => {
        if (modalCorpo) modalCorpo.scrollTop = st;
      });
    }
  }

  atualizarBotoesETabsCarrossel() {
    const btnAnt = document.getElementById("btnEditorSerieAnterior");
    const btnProx = document.getElementById("btnEditorSerieProximo");
    if (btnAnt) btnAnt.disabled = (this.cardSerieIndex <= 0);
    if (btnProx) btnProx.disabled = (this.cardSerieIndex >= this.seriesColunas.length - 1);

    const tabs = document.querySelectorAll("#editorTabsSeries .tab-serie-btn");
    tabs.forEach((tab, idx) => {
      if (idx === this.cardSerieIndex) {
        tab.classList.add("tab-ativa", "bg-blue-600", "text-white");
        tab.classList.remove("bg-slate-100", "text-slate-600");
      } else {
        tab.classList.remove("tab-ativa", "bg-blue-600", "text-white");
        tab.classList.add("bg-slate-100", "text-slate-600");
      }
    });
  }

  // ============================================================================
  // NAVEGAÇÃO 2D VIA TECLADO (PADRÃO PLANILHA EXCEL)
  // ============================================================================

  conectarNavegacao2DTeclado() {
    const inputs = document.querySelectorAll("#editorCardContainer .input-nota");

    inputs.forEach(input => {
      // Ao clicar ou focar em célula de nota já preenchida, seleciona todo o conteúdo
      input.addEventListener("click", () => {
        if (input.value && input.value.trim() !== "") {
          input.select();
        }
      });
      input.addEventListener("focus", () => {
        if (input.value && input.value.trim() !== "") {
          input.select();
        }
      });

      // Ao perder o foco (blur ao pular para outro campo ou clicar fora)
      input.addEventListener("blur", () => {
        const discId = input.id.split("_col_")[0].replace("nota_", "");
        const serie = parseInt(input.getAttribute("data-serie"), 10);
        this.atualizarNota(discId, serie, input.value);
      });

      input.addEventListener("keydown", (e) => {
        const row = parseInt(input.getAttribute("data-row"), 10);
        const col = parseInt(input.getAttribute("data-col"), 10);
        const serie = parseInt(input.getAttribute("data-serie"), 10);
        const discId = input.id.split("_col_")[0].replace("nota_", "");

        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          this.atualizarNota(discId, serie, input.value);
          const target = document.querySelector(`#editor_card_serie_col_${serie} .input-nota[data-row="${row + 1}"]`);
          if (target) {
            target.focus();
            target.select();
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.atualizarNota(discId, serie, input.value);
          const target = document.querySelector(`#editor_card_serie_col_${serie} .input-nota[data-row="${row - 1}"]`);
          if (target) {
            target.focus();
            target.select();
          }
        } else if (e.key === "ArrowLeft") {
          if (input.selectionStart === 0 && input.selectionEnd === 0) {
            this.atualizarNota(discId, serie, input.value);
            this.mudarCardSerie(this.cardSerieIndex - 1, "prev");
          }
        } else if (e.key === "ArrowRight") {
          if (input.selectionStart === input.value.length) {
            this.atualizarNota(discId, serie, input.value);
            this.mudarCardSerie(this.cardSerieIndex + 1, "next");
          }
        }
      });
    });
  }

  // ============================================================================
  // AUTOMAÇÃO DE SÉRIE "NÃO CURSADO"
  // ============================================================================

  aoAlterarResultadoSerie(col, valor) {
    const s = this.seriesColunas.find(item => item.col === col);
    if (s) s.resultado_final = valor;

    const isNaoCursado = (valor === "Não Cursado");
    this.aplicarEstiloNaoCursado(col, isNaoCursado);

    if (isNaoCursado) {
      // Preenche com '---' todas as notas vazias dessa coluna
      this.disciplinas.forEach(d => {
        const inputNota = document.getElementById(`nota_${d.id}_col_${col}`);
        if (inputNota && (!inputNota.value || inputNota.value.trim() === "")) {
          inputNota.value = "---";
          d.notas[col] = "---";
        }
      });
    }
  }

  aplicarEstiloNaoCursado(col, atenuar) {
    const card = document.getElementById(`editor_card_serie_col_${col}`);
    if (!card) return;
    const inputs = card.querySelectorAll(".input-nota");
    inputs.forEach(input => {
      if (atenuar) {
        input.classList.add("bg-slate-100", "dark:bg-[#1f1f1f]", "text-slate-400");
      } else {
        input.classList.remove("bg-slate-100", "dark:bg-[#1f1f1f]", "text-slate-400");
      }
    });
  }

  atualizarNomeDisciplina(discId, novoNome) {
    const d = this.disciplinas.find(item => item.id === discId);
    if (d && novoNome.trim()) {
      d.nome = novoNome.trim();
    }
  }

  formatarNota(valor) {
    if (window.formatarNotaHistorico) {
      return window.formatarNotaHistorico(valor);
    }
    return valor ? String(valor).trim() : "";
  }

  atualizarNota(discId, col, valor) {
    const formatada = this.formatarNota(valor);
    const d = this.disciplinas.find(item => item.id === discId);
    if (d) {
      d.notas[col] = formatada;
    }
    const input = document.getElementById(`nota_${discId}_col_${col}`);
    if (input && input.value !== formatada) {
      input.value = formatada;
    }
    return formatada;
  }

  // Preenche todo o formulário com dados existentes
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
    document.getElementById("campo_observacoes").value = aluno.observacoes_historico || "";

    // Reconstrói Séries / Vida Escolar
    vidaEscolar.forEach(v => {
      const col = v.ordem_coluna;
      const s = this.seriesColunas.find(item => item.col === col);
      if (s) {
        s.ano_letivo = v.ano_letivo || "";
        s.escola_nome = v.escola_nome || "";
        s.escola_municipio_uf = v.escola_municipio_uf || "";
        s.turno = v.turno || "DIURNO";
        s.resultado_final = v.resultado_final || "Aprovado";
      }
    });

    // Reconstrói Disciplinas e Notas
    if (notasCurriculares && notasCurriculares.length > 0) {
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
    }

    this.renderizarTabelaMatriz();
  }

  coletarPayloadDados() {
    const nomeCompleto = document.getElementById("campo_nome_completo")?.value?.trim();
    if (!nomeCompleto) {
      window.sgmToast.warning("Preencha o Nome Civil Completo do estudante.", "Campo Obrigatório");
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
      regime_ensino: this.regimeAtual,
      observacoes_historico: document.getElementById("campo_observacoes")?.value?.trim() || null,
      status_ficha: "DIGITADO"
    };

    const vidaEscolar = this.seriesColunas.map(s => {
      const col = s.col;
      return {
        ordem_coluna: col,
        label_serie: s.label,
        ano_letivo: document.getElementById(`ano_letivo_col_${col}`)?.value?.trim() || null,
        escola_nome: document.getElementById(`escola_nome_col_${col}`)?.value?.trim() || null,
        escola_municipio_uf: document.getElementById(`escola_mun_col_${col}`)?.value?.trim() || null,
        turno: document.getElementById(`turno_col_${col}`)?.value?.trim() || "DIURNO",
        resultado_final: document.getElementById(`resultado_col_${col}`)?.value || "Aprovado"
      };
    });

    // Ordena preservando Base Comum primeiro e Parte Diversificada em seguida
    const baseComum = this.disciplinas.filter(d => (d.categoria || "BASE_COMUM") === "BASE_COMUM");
    const diversificada = this.disciplinas.filter(d => d.categoria === "DIVERSIFICADA");
    const todasDisciplinas = [...baseComum, ...diversificada];

    const notas = [];
    let ordemSeq = 1;
    todasDisciplinas.forEach(d => {
      this.seriesColunas.forEach(s => {
        const inputVal = document.getElementById(`nota_${d.id}_col_${s.col}`)?.value?.trim();
        notas.push({
          ordem_coluna: s.col,
          categoria: d.categoria || "BASE_COMUM",
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
      btn.innerHTML = `<span>Gravando com HMAC...</span>`;

      const response = await fetch("/api/alunos/historico-completo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const res = await response.json();
      btn.disabled = false;
      btn.innerHTML = textoOriginal;

      if (!response.ok || !res.sucesso) {
        window.sgmToast.error(res.detail || "Erro ao salvar histórico escolar.", "Erro na Gravação");
        return;
      }

      window.sgmToast.success(
        `Histórico assinado com HMAC-SHA256! Código: ${res.codigo_autenticidade}`,
        "Registro Salvo com Sucesso"
      );

      if (modoTurbo) {
        // MODO TURBO: Incrementa contador, limpa civil e notas, preserva estrutura de anos e matérias
        this.contadorTurbo++;
        const badgeTurbo = document.getElementById("badgeTurboSessao");
        if (badgeTurbo) {
          badgeTurbo.textContent = `⚡ TURBO: ${this.contadorTurbo} FICHAS LANÇADAS`;
          badgeTurbo.classList.remove("hidden");
        }

        this.alunoAtualUuid = null;
        document.getElementById("campo_nome_completo").value = "";
        document.getElementById("campo_data_nascimento").value = "";
        document.getElementById("campo_filiacao_1").value = "";
        document.getElementById("campo_filiacao_2").value = "";
        document.getElementById("campo_cpf").value = "";

        // Limpa notas da matriz
        this.disciplinas.forEach(d => {
          this.seriesColunas.forEach(s => {
            const inputNota = document.getElementById(`nota_${d.id}_col_${s.col}`);
            if (inputNota) {
              const resCol = document.getElementById(`resultado_col_${s.col}`)?.value;
              inputNota.value = (resCol === "Não Cursado") ? "---" : "";
              d.notas[s.col] = inputNota.value;
            }
          });
        });

        // Foca automaticamente no nome do próximo estudante
        document.getElementById("campo_nome_completo")?.focus();

        // Atualiza a listagem de fundo sem fechar a matriz
        if (window.appMain && window.appMain.recarregarListaAlunos) {
          window.appMain.recarregarListaAlunos();
        }
      } else {
        if (window.appMain && window.appMain.recarregarListaAlunos) {
          window.appMain.recarregarListaAlunos();
          window.appMain.fecharModalEdicao();
        }
      }

    } catch (e) {
      window.sgmToast.error(`Falha na comunicação: ${e.message}`, "Erro de Rede");
    }
  }
}

// Inicializador global
window.EditorMatrizHistorico = EditorMatrizHistorico;
