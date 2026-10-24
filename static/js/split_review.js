/**
 * SGM-Históricos — split_review.js
 * Módulo da Tela Dividida de Conferência e Revisão Livre da IA (Split-Screen)
 * Padrão UI/UX Pro Max (Data-Dense Dashboard - Densidade 8/10)
 * 
 * Recursos Avançados:
 * - Lado Esquerdo (42%): Visualizador de alta resolução com HUD flutuante, roda de zoom, pan e rotação;
 * - Lado Direito (58%): Formulário e Matriz preenchidos pelo Gemini 2.5 Flash, 100% editáveis;
 * - Barra de Soberania Humana com Contador Dinâmico de Campos Duvidosos e Navegador "Próximo Campo";
 * - Transição suave de Baixa Confiança (Âmbar) para Validado (Verde Esmeralda);
 * - Navegação matricial 2D por teclado (Padrão Excel) e persistência com integridade HMAC-SHA256.
 */

class SplitReviewManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.sessaoId = null;
    this.paginasWebp = [];
    this.paginaAtualIndex = 0;
    this.dadosIa = null;
    this.colunasAtuais = [];
    this.totalLinhasDisciplinas = 0;
    this.indiceDuvidosoAtual = 0;
    this.cardSerieIndex = 0;
    this.disciplinasCadastradas = [];
    
    // Estado do visualizador de imagem (zoom, rotação, pan)
    this.zoomNivel = 1.0;
    this.rotacaoGraus = 0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
  }

  async abrirSessaoParaRevisao(sessaoId) {
    this.sessaoId = sessaoId;
    this.zoomNivel = 1.0;
    this.rotacaoGraus = 0;
    this.panX = 0;
    this.panY = 0;
    this.indiceDuvidosoAtual = 0;
    this.cardSerieIndex = 0;
    this.disciplinasCadastradas = [];

    try {
      const res = await fetch(`/api/ocr/sessao/${sessaoId}`);
      if (!res.ok) throw new Error("Não foi possível carregar os dados desta sessão de OCR.");
      
      const dados = await res.json();
      this.paginasWebp = dados.paginas || [];
      this.dadosIa = dados.dados_ia || {};
      this.paginaAtualIndex = 0;

      this.renderizarInterfaceSplit();
      this.iniciarVisualizadorImagem();
      this.atualizarContadorDuvidosos();
    } catch (e) {
      window.sgmToast.error(e.message, "Erro na Abertura do Split-Screen");
    }
  }

  renderizarInterfaceSplit() {
    if (!this.container) return;

    const civis = this.dadosIa.dados_civis || {};
    const regimeSugerido = this.dadosIa.regime_ensino || "8_ANOS";
    const series = this.dadosIa.series_cursadas || [];
    const notas = this.dadosIa.notas_curriculares || [];
    const obs = this.dadosIa.observacoes_historico || {};

    this.container.innerHTML = `
      <div class="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex flex-col overflow-hidden select-none">
        
        <!-- BARRA SUPERIOR DO SPLIT SCREEN (APP BAR NATIVA) -->
        <header class="bg-slate-900 border-b border-slate-700 text-white px-4 py-2 flex items-center justify-between shrink-0 shadow-md">
          <div class="flex items-center gap-3">
            <span class="bg-amber-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider font-mono">
              CONFERÊNCIA IA
            </span>
            <div class="flex items-center gap-2">
              <h1 class="text-xs sm:text-sm font-bold truncate max-w-md">
                ${civis.nome_completo?.valor || 'Ex-Aluno Não Identificado'}
              </h1>
              <span class="text-xs text-slate-400 font-mono">(${this.paginasWebp.length} folha(s) escaneada(s))</span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button id="btnSplitExcluirAnalise" type="button" class="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-700/60 text-rose-300 hover:bg-rose-950/40 hover:text-white transition flex items-center gap-1.5" title="Descartar esta análise e excluir as imagens escaneadas">
              ${window.sgmIcons.get('trash', { size: 14 })}
              <span>Excluir Análise</span>
            </button>
            <button id="btnSplitCancelar" type="button" class="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition">
              Fechar / Sair
            </button>
            <button id="btnSplitAprovarSalvar" type="button" class="text-xs font-bold px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md flex items-center gap-1.5 transition active:scale-95">
              ${window.sgmIcons.get('check', { size: 14 })}
              <span>Aprovar e Salvar Histórico Oficial</span>
            </button>
          </div>
        </header>

        <!-- CORPO PRINCIPAL COM DIVISÃO ESPECIFICADA: 42% / 58% -->
        <div class="flex-1 flex overflow-hidden">
          
          <!-- LADO ESQUERDO: 42% VISUALIZADOR DE PÁGINAS ESCANEADAS -->
          <div class="w-[42%] bg-slate-950 border-r border-slate-800 flex flex-col relative select-none">
            
            <!-- ABAS DAS PÁGINAS ESCANEADAS NO TOPO -->
            <div class="bg-slate-900 border-b border-slate-800 px-3 py-1.5 flex items-center justify-between shrink-0">
              <div class="flex items-center gap-1 overflow-x-auto" id="splitAbasPaginas">
                ${this.paginasWebp.map((p, idx) => `
                  <button type="button" onclick="event.preventDefault(); window.splitReview.trocarPagina(${idx}, event)" class="text-xs font-semibold px-2.5 py-1 rounded transition-colors ${this.paginaAtualIndex === idx ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-400 hover:bg-slate-800'}">
                    Página ${idx + 1}
                  </button>
                `).join('')}
              </div>
              <span class="text-[10px] text-slate-500 font-mono">Arraste para mover | Roda p/ zoom</span>
            </div>

            <!-- CANVAS DO VISUALIZADOR COM DRAG AND ZOOM -->
            <div id="splitViewerCanvas" class="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing flex items-center justify-center bg-[#0d0f17]">
              <img id="splitImgDocumento" src="/api/scan/imagem-preview?caminho=${encodeURIComponent(this.paginasWebp[this.paginaAtualIndex] || '')}" alt="Documento Original Escaneado" class="max-w-none transition-transform duration-75 origin-center shadow-2xl pointer-events-none" style="transform: translate(0px, 0px) scale(1) rotate(0deg);">
            </div>

            <!-- HUD FLUTUANTE DE CONTROLE DE IMAGEM -->
            <div class="hud-controle-imagem">
              <button id="btnZoomMenos" type="button" title="Diminuir Zoom" class="hud-btn">
                ${window.sgmIcons.get('zoomOut', { size: 15 })}
              </button>
              <div id="hudZoomIndicator" class="hud-indicador-zoom">100%</div>
              <button id="btnZoomMais" type="button" title="Aumentar Zoom" class="hud-btn">
                ${window.sgmIcons.get('zoomIn', { size: 15 })}
              </button>
              <div class="w-px h-4 bg-slate-600 mx-1"></div>
              <button id="btnGirarEsquerda" type="button" title="Girar -90°" class="hud-btn">
                ${window.sgmIcons.get('rotateCcw', { size: 15 })}
              </button>
              <button id="btnGirarDireita" type="button" title="Girar +90°" class="hud-btn">
                ${window.sgmIcons.get('rotateCw', { size: 15 })}
              </button>
              <button id="btnResetView" type="button" title="Ajustar à Tela (Reset)" class="hud-btn">
                ${window.sgmIcons.get('maximize', { size: 15 })}
              </button>
            </div>
          </div>

          <!-- LADO DIREITO: 58% FORMULÁRIO E MATRIZ 100% EDITÁVEIS -->
          <div class="w-[58%] bg-slate-50 dark:bg-[#1E1E1E] flex flex-col overflow-y-auto" id="splitPainelDireito">
            
            <!-- BARRA DE ORIENTAÇÃO -->
            <div class="sticky top-0 z-20 bg-amber-50 dark:bg-[#2e1d0f] border-b border-amber-300 dark:border-amber-800/80 px-4 py-2.5 flex items-center gap-2 shadow-2xs">
              <div class="w-6 h-6 rounded-md bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 flex items-center justify-center shrink-0">
                ${window.sgmIcons.get('alertTriangle', { size: 14 })}
              </div>
              <span class="text-xs font-bold text-amber-950 dark:text-amber-200">
                Confira os dados antes de salvar
              </span>
            </div>

            <div class="p-4 space-y-4">

              <!-- REGIME DE ENSINO SUGERIDO PELA IA -->
              <div class="bg-white dark:bg-[#2D2D2D] p-3 rounded-xl border border-slate-200 dark:border-[#454545] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span class="text-xs font-bold text-slate-700 dark:text-slate-300 block">Regime Educacional Sugerido:</span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">Altere se a IA confundiu 8 Séries com 9 Anos ou EJA.</span>
                </div>
                <div class="flex items-center gap-1.5 text-xs font-bold">
                  <label class="cursor-pointer flex items-center gap-1 bg-slate-100 dark:bg-[#141414] hover:bg-blue-50 dark:hover:bg-[#383838] px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#454545]">
                    <input type="radio" name="split_regime" value="8_ANOS" ${regimeSugerido === '8_ANOS' ? 'checked' : ''} onchange="window.splitReview.atualizarRegimeMatriz('8_ANOS')">
                    <span>8 Anos (1ª–8ª)</span>
                  </label>
                  <label class="cursor-pointer flex items-center gap-1 bg-slate-100 dark:bg-[#141414] hover:bg-blue-50 dark:hover:bg-[#383838] px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#454545]">
                    <input type="radio" name="split_regime" value="9_ANOS" ${regimeSugerido === '9_ANOS' ? 'checked' : ''} onchange="window.splitReview.atualizarRegimeMatriz('9_ANOS')">
                    <span>9 Anos (1º–9º)</span>
                  </label>
                  <label class="cursor-pointer flex items-center gap-1 bg-slate-100 dark:bg-[#141414] hover:bg-blue-50 dark:hover:bg-[#383838] px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#454545]">
                    <input type="radio" name="split_regime" value="EJA_ETAPAS" ${regimeSugerido === 'EJA_ETAPAS' ? 'checked' : ''} onchange="window.splitReview.atualizarRegimeMatriz('EJA_ETAPAS')">
                    <span>EJA (Etapas)</span>
                  </label>
                </div>
              </div>

              <!-- DADOS CIVIS IDENTIFICADOS COM HIGHLIGHT DE CONFIANÇA -->
              <div class="bg-white dark:bg-[#2D2D2D] p-3.5 rounded-xl border border-slate-200 dark:border-[#454545] space-y-3">
                <h3 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  ${window.sgmIcons.get('user', { size: 14, className: 'text-blue-600' })}
                  <span>Identificação Civil do Ex-Aluno</span>
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div class="sm:col-span-2">
                    <label class="block font-semibold mb-1">Nome Completo Civil *</label>
                    ${this.gerarInputEditavel("split_nome_completo", civis.nome_completo, "Nome completo civil do estudante")}
                  </div>
                  <div>
                    <label class="block font-semibold mb-1">Data de Nascimento</label>
                    ${this.gerarInputEditavel("split_data_nascimento", civis.data_nascimento, "DD/MM/AAAA", "font-mono")}
                  </div>

                  <div>
                    <label class="block font-semibold mb-1">Naturalidade (Município)</label>
                    ${this.gerarInputEditavel("split_nat_mun", civis.naturalidade_municipio, "Município")}
                  </div>
                  <div>
                    <label class="block font-semibold mb-1">UF</label>
                    ${this.gerarInputEditavel("split_nat_uf", civis.naturalidade_uf, "UF", "uppercase text-center font-mono")}
                  </div>
                  <div>
                    <label class="block font-semibold mb-1">RG / Registro Civil</label>
                    ${this.gerarInputEditavel("split_rg_numero", civis.rg_numero, "RG antigo", "font-mono")}
                  </div>

                  <div class="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label class="block font-semibold mb-1">Filiação 1 (Nome da Mãe)</label>
                      ${this.gerarInputEditavel("split_filiacao_1", civis.filiacao_1, "Nome da mãe")}
                    </div>
                    <div>
                      <label class="block font-semibold mb-1">Filiação 2 (Nome do Pai)</label>
                      ${this.gerarInputEditavel("split_filiacao_2", civis.filiacao_2, "Nome do pai (se constar)")}
                    </div>
                  </div>
                </div>
              </div>

              <!-- MATRIZ CURRICULAR EM FORMATO CARD CARROSSEL FOCADO (70% LARGURA) -->
              <div class="bg-white dark:bg-[#2D2D2D] p-3.5 rounded-xl border border-slate-200 dark:border-[#454545] space-y-3">
                
                <!-- TOPO DA SEÇÃO DE NOTAS -->
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-[#383838] pb-2.5">
                  <div>
                    <h3 class="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      ${window.sgmIcons.get('sparkles', { size: 14, className: 'text-amber-500' })}
                      <span>Matriz Curricular de Séries e Notas Extraídas</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400">Card com 1 ano por visualização. Navegue pelas setas ou atalhos.</p>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <input type="text" id="splitInputNovaMateria" placeholder="Nova disciplina..." class="bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded px-2.5 py-1 text-xs w-40">
                    <select id="splitSelectNovaMateriaCat" class="bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded px-2 py-1 text-xs">
                      <option value="BASE_COMUM">Base Comum</option>
                      <option value="DIVERSIFICADA">Parte Diversificada</option>
                    </select>
                    <button type="button" id="splitBtnAddMateria" class="bg-blue-700 hover:bg-blue-800 dark:bg-[#84167A] dark:hover:bg-[#9B1D90] text-white text-xs font-bold px-3 py-1 rounded flex items-center gap-1 shadow-xs transition">
                      ${window.sgmIcons.get('plus', { size: 12 })}
                      <span>Adicionar</span>
                    </button>
                  </div>
                </div>

                <!-- SELETOR RÁPIDO DE ANOS (PÍLULAS SUPERIORES) -->
                <div class="flex items-center justify-center gap-1 overflow-x-auto py-1" id="splitTabsSeries"></div>

                <!-- CARROSSEL: SETA ESQUERDA (15%) + CARD 1 ANO (70%) + SETA DIREITA (15%) -->
                <div class="flex items-center justify-between gap-2 w-full my-1">
                  
                  <!-- SETA ESQUERDA (15%) -->
                  <div class="w-[15%] flex justify-center">
                    <button id="btnSerieAnterior" type="button" title="Ano Anterior (Seta Esquerda)"
                      class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-slate-100 hover:bg-blue-50 dark:bg-[#1E1E1E] dark:hover:bg-[#383838] border border-slate-300 dark:border-[#454545] text-slate-700 dark:text-slate-200 shadow-sm transition active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer">
                      ${window.sgmIcons.get('chevronLeft', { size: 24 })}
                    </button>
                  </div>

                  <!-- CARD CENTRAL (70% DE LARGURA) -->
                  <div class="w-[70%] relative overflow-hidden" id="splitCardContainer">
                    <!-- Cards de cada ano são gerados dinamicamente com animação suave -->
                  </div>

                  <!-- SETA DIREITA (15%) -->
                  <div class="w-[15%] flex justify-center">
                    <button id="btnSerieProximo" type="button" title="Próximo Ano (Seta Direita)"
                      class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-slate-100 hover:bg-blue-50 dark:bg-[#1E1E1E] dark:hover:bg-[#383838] border border-slate-300 dark:border-[#454545] text-slate-700 dark:text-slate-200 shadow-sm transition active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer">
                      ${window.sgmIcons.get('chevronRight', { size: 24 })}
                    </button>
                  </div>

                </div>

              </div>

              <!-- OBSERVAÇÕES E LEIS EXTRAÍDAS PELA IA -->
              <div class="bg-white dark:bg-[#2D2D2D] p-3.5 rounded-xl border border-slate-200 dark:border-[#454545]">
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Observações Históricas / Leis da Época / Pareceres Extraídos
                </label>
                <textarea id="split_observacoes" rows="2" placeholder="Observações do histórico, equivalências ou pareceres..." class="w-full bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500">${obs.valor || ''}</textarea>
              </div>

            </div>
          </div>
        </div>
      </div>
    `;

    this.iniciarVisualizadorImagem();
    this.conectarEventosSplit();
    this.renderizarMatrizRevisao(regimeSugerido, series, notas);
  }

  gerarInputEditavel(id, campoObj, placeholder = "", classeExtra = "") {
    const valor = campoObj?.valor || "";
    const isDuvidoso = campoObj?.baixa_confianca === true;
    const classeDestaque = isDuvidoso
      ? "campo-baixa-confianca bg-amber-100 dark:bg-[#3D2200] border-amber-500 text-amber-950 dark:text-[#FFD580] font-bold"
      : "bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100";

    return `
      <input type="text" id="${id}" value="${valor}" placeholder="${placeholder}"
        class="w-full border rounded-lg px-2.5 py-1.5 text-xs transition-colors ${classeDestaque} ${classeExtra}"
        onfocus="window.splitReview.removerAlertaAmarelo(this)"
        oninput="window.splitReview.removerAlertaAmarelo(this)">
    `;
  }

  removerAlertaAmarelo(inputEl) {
    if (inputEl.classList.contains("campo-baixa-confianca")) {
      inputEl.classList.remove("campo-baixa-confianca", "bg-amber-100", "border-amber-500", "text-amber-950");
      inputEl.classList.add("campo-validado");
      this.atualizarContadorDuvidosos();
    }
  }

  atualizarContadorDuvidosos() {
    const duvidosos = document.querySelectorAll("#splitPainelDireito .campo-baixa-confianca");
    const count = duvidosos.length;
    const badge = document.getElementById("splitBadgeDuvidosos");
    if (!badge) return;

    if (count > 0) {
      badge.textContent = `${count} duvidoso(s)`;
      badge.className = "font-mono text-[11px] font-bold px-2 py-0.2 rounded bg-amber-200 text-amber-950 border border-amber-400";
    } else {
      badge.textContent = `✓ Todos os campos validados!`;
      badge.className = "font-mono text-[11px] font-bold px-2 py-0.2 rounded bg-emerald-100 text-emerald-900 border border-emerald-400";
    }
  }

  irParaProximoCampoDuvidoso() {
    const duvidosos = Array.from(document.querySelectorAll("#splitPainelDireito .campo-baixa-confianca"));
    if (duvidosos.length === 0) {
      window.sgmToast.success("Todos os campos de baixa confiança já foram revisados e validados!", "Revisão Completa");
      return;
    }

    if (this.indiceDuvidosoAtual >= duvidosos.length) {
      this.indiceDuvidosoAtual = 0;
    }

    const campoAlvo = duvidosos[this.indiceDuvidosoAtual];
    if (campoAlvo) {
      campoAlvo.scrollIntoView({ behavior: "smooth", block: "center" });
      campoAlvo.focus();
      campoAlvo.select();
      this.indiceDuvidosoAtual = (this.indiceDuvidosoAtual + 1) % duvidosos.length;
    }
  }

  renderizarMatrizRevisao(regime, seriesIa = [], notasIa = []) {
    const container = document.getElementById("splitCardContainer");
    const tabsContainer = document.getElementById("splitTabsSeries");
    if (!container) return;

    const numCols = regime === "9_ANOS" ? 9 : (regime === "EJA_ETAPAS" ? 4 : 8);
    const colunas = [];
    for (let c = 1; c <= numCols; c++) {
      let label = `${c}ª Série`;
      if (regime === "9_ANOS") label = `${c}º Ano`;
      if (regime === "EJA_ETAPAS") {
        const romanos = ["I", "II", "III", "IV"];
        label = `${c}ª Etapa (${romanos[c - 1] || c})`;
      }
      
      const sIa = seriesIa.find(s => s.ordem_coluna === c);
      colunas.push({
        col: c,
        label: label,
        ano_letivo: (sIa?.ano_letivo?.valor !== undefined ? sIa.ano_letivo.valor : (sIa?.ano_letivo || "")),
        escola_nome: (sIa?.escola_nome?.valor !== undefined ? sIa.escola_nome.valor : (sIa?.escola_nome || "")),
        escola_municipio_uf: (sIa?.escola_municipio_uf?.valor !== undefined ? sIa.escola_municipio_uf.valor : (sIa?.escola_municipio_uf || "")),
        turno: (sIa?.turno?.valor !== undefined ? sIa.turno.valor : (sIa?.turno || "DIURNO")),
        resultado_final: (sIa?.resultado_final?.valor !== undefined ? sIa.resultado_final.valor : (sIa?.resultado_final || "Aprovado")),
        duvidosoAno: sIa?.ano_letivo?.baixa_confianca || false,
        duvidosoEscola: sIa?.escola_nome?.baixa_confianca || false,
        duvidosoMun: sIa?.escola_municipio_uf?.baixa_confianca || false
      });
    }

    this.colunasAtuais = colunas;
    if (this.cardSerieIndex >= colunas.length) {
      this.cardSerieIndex = 0;
    }

    // Se ainda não temos disciplinas carregadas nesta sessão, carrega a partir de notasIa
    if (!this.disciplinasCadastradas || this.disciplinasCadastradas.length === 0) {
      const mapaDisciplinas = new Map();
      notasIa.forEach(n => {
        const nome = n.disciplina_nome?.valor?.trim() || "Disciplina";
        if (!mapaDisciplinas.has(nome)) {
          mapaDisciplinas.set(nome, {
            nome: nome,
            categoria: n.categoria || "BASE_COMUM",
            notas: {}
          });
        }
        mapaDisciplinas.get(nome).notas[n.ordem_coluna] = {
          valor: n.nota_ou_conceito?.valor || "",
          duvidoso: n.nota_ou_conceito?.baixa_confianca || false
        };
      });

      if (mapaDisciplinas.size === 0) {
        ["Língua Portuguesa", "Matemática", "Estudos Sociais", "Ciências Físicas e Biológicas", "Educação Física"].forEach(m => {
          mapaDisciplinas.set(m, { nome: m, categoria: "BASE_COMUM", notas: {} });
        });
      }

      // Salva array ordenado de disciplinas
      this.disciplinasCadastradas = [];
      let dIdx = 0;
      mapaDisciplinas.forEach((d, nomeDisc) => {
        this.disciplinasCadastradas.push({
          id: dIdx,
          nome: nomeDisc,
          categoria: d.categoria || "BASE_COMUM",
          notas: d.notas || {}
        });
        dIdx++;
      });
      this.totalLinhasDisciplinas = dIdx;
    }

    // 1. Renderiza Pílulas / Tabs de Seleção Rápida
    if (tabsContainer) {
      tabsContainer.innerHTML = colunas.map((c, idx) => `
        <button type="button" onclick="event.preventDefault(); window.splitReview.mudarCardSerie(${idx}, 'direct', event)"
          class="tab-serie-btn px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${idx === this.cardSerieIndex ? 'tab-ativa bg-blue-600 text-white border-blue-600' : 'bg-slate-100 dark:bg-[#1E1E1E] text-slate-600 dark:text-slate-300 border-slate-300 dark:border-[#454545] hover:bg-slate-200 dark:hover:bg-[#333]'}">
          ${c.label}
        </button>
      `).join('');
    }

    // 2. Renderiza os Cards de Cada Série dentro de splitCardContainer (70% largura no centro)
    let cardsHtml = "";
    colunas.forEach((c, colIndex) => {
      const isAtivo = (colIndex === this.cardSerieIndex);
      cardsHtml += `
        <div id="card_serie_col_${c.col}" class="card-serie-item ${isAtivo ? 'card-ativo flex flex-col' : 'hidden'} bg-white dark:bg-[#1C1C1C] rounded-xl border border-slate-300 dark:border-[#454545] shadow-md transition-all" data-col-index="${colIndex}">
          
          <!-- 1. CABEÇALHO DO CARD: SÉRIE / ANO (SEM INFORMAÇÃO 1 DE 9) -->
          <div class="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 dark:from-[#351034] dark:via-[#261324] dark:to-[#141414] text-white px-3.5 py-2 rounded-t-xl flex items-center justify-between shrink-0 shadow-xs">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-md bg-white/15 text-white flex items-center justify-center font-mono font-bold text-xs shrink-0">
                ${c.col}
              </span>
              <h4 class="font-bold text-sm tracking-tight text-white">
                ${c.label}
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
              <tbody id="corpo_disciplinas_card_${c.col}" class="divide-y divide-slate-100 dark:divide-[#303030]">
                ${this.gerarHtmlTbodyDisciplinasCard(c.col)}
              </tbody>
            </table>
          </div>

          <!-- 3. FINAL DO CARD: SELEÇÃO DE RESULTADO, ESTABELECIMENTO, ANO LETIVO E CIDADE/UF (COMPACTO) -->
          <div class="bg-slate-50 dark:bg-[#1A1A1A] p-2.5 border-t border-slate-200 dark:border-[#383838] rounded-b-xl space-y-2 shrink-0">
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <label class="block font-semibold text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Ano Letivo:</label>
                <input type="text" id="split_ano_col_${c.col}" value="${c.ano_letivo}" placeholder="AAAA"
                  class="w-full text-center border rounded py-0.5 px-1.5 text-xs font-mono font-bold ${c.duvidosoAno ? 'campo-baixa-confianca bg-amber-100 dark:bg-[#3D2200] border-amber-500 text-amber-950 dark:text-[#FFD580]' : 'bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100'}"
                  onfocus="window.splitReview.removerAlertaAmarelo(this)">
              </div>
              <div class="sm:col-span-2">
                <label class="block font-semibold text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Estabelecimento / Escola:</label>
                <input type="text" id="split_escola_col_${c.col}" value="${c.escola_nome}" placeholder="Nome do estabelecimento"
                  class="w-full border rounded py-0.5 px-2 text-xs font-medium ${c.duvidosoEscola ? 'campo-baixa-confianca bg-amber-100 dark:bg-[#3D2200] border-amber-500 text-amber-950 dark:text-[#FFD580]' : 'bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100'}"
                  onfocus="window.splitReview.removerAlertaAmarelo(this)">
              </div>
              <div>
                <label class="block font-semibold text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Cidade - UF:</label>
                <input type="text" id="split_mun_col_${c.col}" value="${c.escola_municipio_uf}" placeholder="Município/UF"
                  class="w-full border rounded py-0.5 px-2 text-xs ${c.duvidosoMun ? 'campo-baixa-confianca bg-amber-100 dark:bg-[#3D2200] border-amber-500 text-amber-950 dark:text-[#FFD580]' : 'bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] text-slate-800 dark:text-slate-100'}"
                  onfocus="window.splitReview.removerAlertaAmarelo(this)">
              </div>
            </div>

            <!-- RESULTADO FINAL DA SÉRIE -->
            <div class="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-[#2a2a2a] text-xs">
              <span class="font-bold text-slate-700 dark:text-slate-300 text-[11px]">Resultado da Série:</span>
              <select id="split_res_col_${c.col}" class="bg-white dark:bg-[#141414] text-slate-900 dark:text-slate-100 font-bold border border-blue-400 dark:border-purple-600 rounded px-2 py-0.5 text-xs focus:ring-2 focus:ring-blue-500">
                <option value="Aprovado" ${c.resultado_final === 'Aprovado' ? 'selected' : ''}>Aprovado</option>
                <option value="Promovido" ${c.resultado_final === 'Promovido' ? 'selected' : ''}>Promovido</option>
                <option value="Reprovado" ${c.resultado_final === 'Reprovado' ? 'selected' : ''}>Reprovado</option>
                <option value="Transferido" ${c.resultado_final === 'Transferido' ? 'selected' : ''}>Transferido</option>
                <option value="Desistente" ${c.resultado_final === 'Desistente' ? 'selected' : ''}>Desistente</option>
                <option value="Não Cursado" ${c.resultado_final === 'Não Cursado' ? 'selected' : ''}>Não Cursado</option>
              </select>
            </div>
            <input type="hidden" id="split_turno_col_${c.col}" value="${c.turno || 'DIURNO'}">
          </div>

        </div>
      `;
    });

    container.innerHTML = cardsHtml;

    // Configura botões de seta e listeners
    this.atualizarBotoesETabsCarrossel();
    this.conectarNavegacao2DSplit();
  }

  conectarNavegacao2DSplit() {
    const inputs = document.querySelectorAll("#splitPainelDireito .input-nota");
    inputs.forEach(input => {
      input.addEventListener("focus", () => {
        if (input.value && input.value.trim() !== "") input.select();
      });

      input.addEventListener("keydown", (e) => {
        const row = parseInt(input.getAttribute("data-split-row"), 10);
        const col = parseInt(input.getAttribute("data-split-col"), 10);
        if (isNaN(row) || isNaN(col)) return;

        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          const target = document.querySelector(`#corpo_disciplinas_card_${col} .input-nota[data-split-row="${row + 1}"]`);
          if (target) {
            target.focus();
            target.select();
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const target = document.querySelector(`#corpo_disciplinas_card_${col} .input-nota[data-split-row="${row - 1}"]`);
          if (target) {
            target.focus();
            target.select();
          }
        } else if (e.key === "ArrowLeft") {
          if (input.selectionStart === 0 && input.selectionEnd === 0) {
            this.mudarCardSerie(this.cardSerieIndex - 1, "prev");
          }
        } else if (e.key === "ArrowRight") {
          if (input.selectionStart === input.value.length) {
            this.mudarCardSerie(this.cardSerieIndex + 1, "next");
          }
        }
      });
    });
  }

  mudarCardSerie(novoIndex, direcao = "next", event = null) {
    if (event) event.preventDefault();
    if (novoIndex < 0 || novoIndex >= this.colunasAtuais.length) return;
    if (novoIndex === this.cardSerieIndex) return;

    const painel = document.getElementById("splitPainelDireito");
    const st = painel ? painel.scrollTop : 0;

    const colAtual = this.colunasAtuais[this.cardSerieIndex].col;
    const colNova = this.colunasAtuais[novoIndex].col;

    const cardAtual = document.getElementById(`card_serie_col_${colAtual}`);
    const cardNovo = document.getElementById(`card_serie_col_${colNova}`);

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

    if (painel) {
      painel.scrollTop = st;
      requestAnimationFrame(() => {
        if (painel) painel.scrollTop = st;
      });
    }
  }

  atualizarRegimeMatriz(novoRegime) {
    this.regimeAtual = novoRegime;

    // 1. Salva as notas digitadas atualmente no DOM dentro de this.disciplinasCadastradas
    if (this.disciplinasCadastradas && this.disciplinasCadastradas.length > 0) {
      this.disciplinasCadastradas.forEach(d => {
        this.colunasAtuais.forEach(c => {
          const inputNota = document.getElementById(`nota_split_disc_${d.id}_col_${c.col}`);
          if (inputNota) {
            if (!d.notas) d.notas = {};
            d.notas[c.col] = {
              valor: inputNota.value.trim(),
              duvidoso: inputNota.classList.contains("campo-baixa-confianca")
            };
          }
        });
      });
    }

    // 2. Coleta os metadados das colunas atuais
    const seriesAtuais = this.colunasAtuais.map(c => ({
      ordem_coluna: c.col,
      ano_letivo: document.getElementById(`split_ano_col_${c.col}`)?.value?.trim() || c.ano_letivo,
      escola_nome: document.getElementById(`split_escola_col_${c.col}`)?.value?.trim() || c.escola_nome,
      escola_municipio_uf: document.getElementById(`split_mun_col_${c.col}`)?.value?.trim() || c.escola_municipio_uf,
      turno: document.getElementById(`split_turno_col_${c.col}`)?.value?.trim() || c.turno,
      resultado_final: document.getElementById(`split_res_col_${c.col}`)?.value || c.resultado_final,
      duvidosoAno: c.duvidosoAno,
      duvidosoEscola: c.duvidosoEscola,
      duvidosoMun: c.duvidosoMun
    }));

    // 3. Garante que os botões de rádio no topo reflitam a escolha
    const radios = document.querySelectorAll('input[name="split_regime"]');
    radios.forEach(r => { r.checked = (r.value === novoRegime); });

    this.cardSerieIndex = 0;
    this.renderizarMatrizRevisao(novoRegime, seriesAtuais);
    window.sgmToast?.info(`Regime alterado para ${novoRegime === '9_ANOS' ? '9 Anos (1º–9º)' : (novoRegime === 'EJA_ETAPAS' ? 'EJA (Etapas)' : '8 Séries (1ª–8ª)')}.`, "Regime Atualizado");
  }

  atualizarBotoesETabsCarrossel() {
    const btnAnt = document.getElementById("btnSerieAnterior");
    const btnProx = document.getElementById("btnSerieProximo");
    if (btnAnt) btnAnt.disabled = (this.cardSerieIndex <= 0);
    if (btnProx) btnProx.disabled = (this.cardSerieIndex >= this.colunasAtuais.length - 1);

    const tabs = document.querySelectorAll("#splitTabsSeries .tab-serie-btn");
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

  sincronizarNomeDisciplina(id, novoNome) {
    const disc = this.disciplinasCadastradas.find(d => d.id === id);
    if (disc) {
      disc.nome = novoNome;
    }
    this.colunasAtuais.forEach(c => {
      const input = document.getElementById(`nome_split_disc_${id}_col_${c.col}`);
      if (input && input.value !== novoNome) {
        input.value = novoNome;
      }
    });
  }

  gerarHtmlTbodyDisciplinasCard(col) {
    const baseComum = this.disciplinasCadastradas.filter(d => (d.categoria || "BASE_COMUM") === "BASE_COMUM");
    const diversificada = this.disciplinasCadastradas.filter(d => d.categoria === "DIVERSIFICADA");

    let rowIdx = 0;
    const renderLinha = (d) => {
      const notaObj = d.notas[col] || { valor: "", duvidoso: false };
      const classeDestaque = notaObj.duvidoso
        ? "campo-baixa-confianca bg-amber-100 dark:bg-[#3D2200] border-amber-500 font-mono font-bold text-amber-950 dark:text-[#FFD580]"
        : "bg-white dark:bg-[#141414] border-slate-300 dark:border-[#454545] font-mono text-slate-900 dark:text-slate-100";
      const rIndex = rowIdx++;

      return `
        <tr class="linha-disc-item hover:bg-slate-50 dark:hover:bg-[#252525] transition-colors" id="linha_card_${col}_disc_${d.id}">
          <td class="py-1.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
            <input type="text" id="nome_split_disc_${d.id}_col_${col}" value="${d.nome}"
              class="w-full bg-transparent border-0 border-b border-transparent focus:border-blue-500 text-xs font-semibold focus:outline-none"
              oninput="window.splitReview.sincronizarNomeDisciplina(${d.id}, this.value)">
          </td>
          <td class="py-1 px-3 w-36 text-center">
            <input type="text" id="nota_split_disc_${d.id}_col_${col}" value="${window.formatarNotaHistorico ? window.formatarNotaHistorico(notaObj.valor) : notaObj.valor}" placeholder="---"
              data-split-row="${rIndex}" data-split-col="${col}"
              class="input-nota w-full text-center border rounded py-0.5 px-2 text-xs font-mono font-bold transition-all ${classeDestaque}"
              onfocus="window.splitReview.removerAlertaAmarelo(this); if (this.value) this.select();"
              onclick="if (this.value) this.select();"
              oninput="window.splitReview.removerAlertaAmarelo(this)"
              onchange="this.value = window.formatarNotaHistorico ? window.formatarNotaHistorico(this.value) : this.value"
              onblur="this.value = window.formatarNotaHistorico ? window.formatarNotaHistorico(this.value) : this.value">
          </td>
          <td class="py-1 px-2 text-center">
            <button type="button" onclick="window.splitReview.removerDisciplinaLinha(${d.id})" class="text-rose-400 hover:text-rose-600 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition" title="Excluir disciplina da grade">
              ${window.sgmIcons.get('trash', { size: 12 })}
            </button>
          </td>
        </tr>
      `;
    };

    let linhasHtml = "";

    // Cabeçalho da Base Nacional Comum
    if (baseComum.length > 0) {
      linhasHtml += `
        <tr class="secao-base-comum-divisor bg-slate-100/90 dark:bg-[#1E1E1E] border-b border-slate-300 dark:border-[#454545]">
          <td colspan="3" class="py-1 px-3 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              <span>Base Nacional Comum</span>
            </div>
          </td>
        </tr>
      `;
      linhasHtml += baseComum.map(renderLinha).join('');
    }

    if (diversificada.length > 0) {
      linhasHtml += `
        <tr class="secao-diversificada-divisor bg-slate-100/90 dark:bg-[#1E1E1E] border-y border-slate-300 dark:border-[#454545]">
          <td colspan="3" class="py-1 px-3 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
              <span>Parte Diversificada</span>
            </div>
          </td>
        </tr>
      `;
      linhasHtml += diversificada.map(renderLinha).join('');
    }

    return linhasHtml;
  }

  sincronizarNotasDigitadas() {
    this.disciplinasCadastradas.forEach(d => {
      this.colunasAtuais.forEach(c => {
        const inputNota = document.getElementById(`nota_split_disc_${d.id}_col_${c.col}`);
        if (inputNota) {
          if (!d.notas[c.col]) d.notas[c.col] = { valor: "", duvidoso: false };
          const fmt = window.formatarNotaHistorico ? window.formatarNotaHistorico(inputNota.value) : inputNota.value.trim();
          inputNota.value = fmt;
          d.notas[c.col].valor = fmt;
        }
      });
    });

    this.colunasAtuais.forEach(c => {
      c.ano_letivo = document.getElementById(`split_ano_col_${c.col}`)?.value?.trim() || c.ano_letivo;
      c.escola_nome = document.getElementById(`split_escola_col_${c.col}`)?.value?.trim() || c.escola_nome;
      c.escola_municipio_uf = document.getElementById(`split_mun_col_${c.col}`)?.value?.trim() || c.escola_municipio_uf;
      c.turno = document.getElementById(`split_turno_col_${c.col}`)?.value?.trim() || c.turno;
      c.resultado_final = document.getElementById(`split_res_col_${c.col}`)?.value || c.resultado_final;
    });
  }

  reconstruirCorpoTabelasCards() {
    this.colunasAtuais.forEach(c => {
      const tbody = document.getElementById(`corpo_disciplinas_card_${c.col}`);
      if (tbody) {
        tbody.innerHTML = this.gerarHtmlTbodyDisciplinasCard(c.col);
      }
    });
  }

  adicionarDisciplinaLinha() {
    const inputNome = document.getElementById("splitInputNovaMateria");
    const selectCat = document.getElementById("splitSelectNovaMateriaCat");
    const nome = inputNome?.value?.trim();
    const cat = selectCat?.value || "BASE_COMUM";

    if (!nome) {
      window.sgmToast.warning("Digite o nome da disciplina para adicionar.", "Campo Obrigatório");
      inputNome?.focus();
      return;
    }

    this.sincronizarNotasDigitadas();

    const novoId = this.totalLinhasDisciplinas || Date.now();
    this.totalLinhasDisciplinas = novoId + 1;
    this.disciplinasCadastradas.push({
      id: novoId,
      nome: nome,
      categoria: cat,
      notas: {}
    });

    inputNome.value = "";
    this.reconstruirCorpoTabelasCards();
    this.conectarNavegacao2DSplit();
    window.sgmToast.success(`Disciplina "${nome}" (${cat === 'DIVERSIFICADA' ? 'Parte Diversificada' : 'Base Comum'}) adicionada à grade.`, "Disciplina Adicionada");
  }

  removerDisciplinaLinha(id) {
    this.sincronizarNotasDigitadas();
    this.disciplinasCadastradas = this.disciplinasCadastradas.filter(d => d.id !== id);
    this.reconstruirCorpoTabelasCards();
    this.conectarNavegacao2DSplit();
    this.atualizarContadorDuvidosos();
  }

  trocarPagina(index, event = null) {
    if (event) event.preventDefault();
    const painel = document.getElementById("splitPainelDireito");
    const st = painel ? painel.scrollTop : 0;

    this.paginaAtualIndex = index;
    const img = document.getElementById("splitImgDocumento");
    if (img && this.paginasWebp[index]) {
      img.src = `/api/scan/imagem-preview?caminho=${encodeURIComponent(this.paginasWebp[index])}`;
      this.aplicarTransformVisualizador();
    }

    const abasBox = document.getElementById("splitAbasPaginas");
    if (abasBox) {
      const botoes = abasBox.querySelectorAll("button");
      botoes.forEach((btn, idx) => {
        btn.className = `text-xs font-semibold px-2.5 py-1 rounded transition-colors ${this.paginaAtualIndex === idx ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-400 hover:bg-slate-800'}`;
      });
    }

    if (painel) {
      painel.scrollTop = st;
      requestAnimationFrame(() => {
        if (painel) painel.scrollTop = st;
      });
    }
  }

  aplicarTransformVisualizador() {
    const img = document.getElementById("splitImgDocumento");
    const zoomIndicator = document.getElementById("hudZoomIndicator");
    if (!img) return;

    img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomNivel}) rotate(${this.rotacaoGraus}deg)`;
    if (zoomIndicator) {
      zoomIndicator.textContent = `${Math.round(this.zoomNivel * 100)}%`;
    }
  }

  iniciarVisualizadorImagem() {
    const viewer = document.getElementById("splitViewerCanvas");
    const img = document.getElementById("splitImgDocumento");
    if (!viewer || !img) return;

    this.aplicarTransformVisualizador();

    // Remove ouvintes globais anteriores para evitar acúmulo
    if (this._splitMouseMove) {
      window.removeEventListener("mousemove", this._splitMouseMove);
      window.removeEventListener("mouseup", this._splitMouseUp);
      window.removeEventListener("touchmove", this._splitTouchMove);
      window.removeEventListener("touchend", this._splitTouchEnd);
    }

    // Zoom na roda do mouse (suave, centrado e com limites seguros)
    viewer.onwheel = (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const novoZoom = Math.min(Math.max(0.2, +(this.zoomNivel * zoomFactor).toFixed(2)), 6.0);
      this.zoomNivel = novoZoom;
      this.aplicarTransformVisualizador();
    };

    // Drag / Pan com o mouse (zero latência com transition: none durante movimento)
    viewer.onmousedown = (e) => {
      if (e.button !== 0) return; // Apenas botão principal (esquerdo)
      e.preventDefault();
      this.isDragging = true;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
      viewer.classList.remove("cursor-grab");
      viewer.classList.add("cursor-grabbing");
      img.style.transition = "none";
    };

    this._splitMouseMove = (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.startX;
      this.panY = e.clientY - this.startY;
      this.aplicarTransformVisualizador();
    };

    this._splitMouseUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        viewer.classList.remove("cursor-grabbing");
        viewer.classList.add("cursor-grab");
        img.style.transition = "transform 75ms ease-out";
      }
    };

    window.addEventListener("mousemove", this._splitMouseMove);
    window.addEventListener("mouseup", this._splitMouseUp);

    // Suporte a Touch e Pinch-Zoom para dispositivos sensíveis ao toque
    let touchStartDist = 0;
    viewer.ontouchstart = (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.startX = e.touches[0].clientX - this.panX;
        this.startY = e.touches[0].clientY - this.panY;
        img.style.transition = "none";
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    };

    this._splitTouchMove = (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        e.preventDefault();
        this.panX = e.touches[0].clientX - this.startX;
        this.panY = e.touches[0].clientY - this.startY;
        this.aplicarTransformVisualizador();
      } else if (e.touches.length === 2 && touchStartDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / touchStartDist;
        this.zoomNivel = Math.min(Math.max(0.2, +(this.zoomNivel * factor).toFixed(2)), 6.0);
        touchStartDist = dist;
        this.aplicarTransformVisualizador();
      }
    };

    this._splitTouchEnd = () => {
      this.isDragging = false;
      touchStartDist = 0;
      img.style.transition = "transform 75ms ease-out";
    };

    window.addEventListener("touchmove", this._splitTouchMove, { passive: false });
    window.addEventListener("touchend", this._splitTouchEnd);

    // Conexão dos Botões do HUD Flutuante
    const btnZoomMais = document.getElementById("btnZoomMais");
    const btnZoomMenos = document.getElementById("btnZoomMenos");
    const btnGirarDireita = document.getElementById("btnGirarDireita");
    const btnGirarEsquerda = document.getElementById("btnGirarEsquerda");
    const btnResetView = document.getElementById("btnResetView");

    if (btnZoomMais) {
      btnZoomMais.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.zoomNivel = Math.min(6.0, +(this.zoomNivel + 0.25).toFixed(2));
        this.aplicarTransformVisualizador();
      };
    }

    if (btnZoomMenos) {
      btnZoomMenos.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.zoomNivel = Math.max(0.2, +(this.zoomNivel - 0.25).toFixed(2));
        this.aplicarTransformVisualizador();
      };
    }

    if (btnGirarDireita) {
      btnGirarDireita.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.rotacaoGraus = (this.rotacaoGraus + 90) % 360;
        this.aplicarTransformVisualizador();
      };
    }

    if (btnGirarEsquerda) {
      btnGirarEsquerda.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.rotacaoGraus = (this.rotacaoGraus - 90 + 360) % 360;
        this.aplicarTransformVisualizador();
      };
    }

    if (btnResetView) {
      btnResetView.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.zoomNivel = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.rotacaoGraus = 0;
        this.aplicarTransformVisualizador();
      };
    }
  }

  conectarEventosSplit() {
    document.getElementById("btnSplitCancelar")?.addEventListener("click", async () => {
      const confirmou = await window.sgmDialog.confirm({
        title: "Sair da Revisão de IA",
        message: "Os dados desta conferência permanecerão salvos na Fila de IA para continuidade posterior. Deseja sair?",
        confirmText: "Sim, Sair da Revisão"
      });
      if (confirmou) {
        this.container.innerHTML = "";
      }
    });

    document.getElementById("btnSplitExcluirAnalise")?.addEventListener("click", () => this.excluirAnalise());
    document.getElementById("btnSplitAprovarSalvar")?.addEventListener("click", () => this.aprovarESalvar());
    document.getElementById("splitBtnAddMateria")?.addEventListener("click", () => this.adicionarDisciplinaLinha());
    document.getElementById("splitInputNovaMateria")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.adicionarDisciplinaLinha();
    });

    document.getElementById("btnSerieAnterior")?.addEventListener("click", () => this.mudarCardSerie(this.cardSerieIndex - 1, "prev"));
    document.getElementById("btnSerieProximo")?.addEventListener("click", () => this.mudarCardSerie(this.cardSerieIndex + 1, "next"));

    // Atalhos globais do split-screen para navegação entre cards
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        this.mudarCardSerie(this.cardSerieIndex - 1, "prev");
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        this.mudarCardSerie(this.cardSerieIndex + 1, "next");
      }
    });
  }

  async aprovarESalvar() {
    const nome = document.getElementById("split_nome_completo")?.value?.trim();
    if (!nome) {
      window.sgmToast.warning("Preencha o Nome Completo do aluno antes de aprovar.", "Nome Obrigatório");
      document.getElementById("split_nome_completo")?.focus();
      return;
    }

    const regime = document.querySelector('input[name="split_regime"]:checked')?.value || "8_ANOS";

    const aluno = {
      escola_id: window.configManagerAtual?.escola_id || 1,
      nome_completo: nome,
      data_nascimento: document.getElementById("split_data_nascimento")?.value?.trim() || null,
      naturalidade_municipio: document.getElementById("split_nat_mun")?.value?.trim() || null,
      naturalidade_uf: document.getElementById("split_nat_uf")?.value?.trim()?.toUpperCase() || null,
      filiacao_1: document.getElementById("split_filiacao_1")?.value?.trim() || null,
      filiacao_2: document.getElementById("split_filiacao_2")?.value?.trim() || null,
      rg_numero: document.getElementById("split_rg_numero")?.value?.trim() || null,
      regime_ensino: regime,
      observacoes_historico: document.getElementById("split_observacoes")?.value?.trim() || null,
      status_ficha: "DIGITADO",
      paginas_webp_json: JSON.stringify(this.paginasWebp)
    };

    const vidaEscolar = this.colunasAtuais.map(c => ({
      ordem_coluna: c.col,
      label_serie: c.label,
      ano_letivo: document.getElementById(`split_ano_col_${c.col}`)?.value?.trim() || null,
      escola_nome: document.getElementById(`split_escola_col_${c.col}`)?.value?.trim() || null,
      escola_municipio_uf: document.getElementById(`split_mun_col_${c.col}`)?.value?.trim() || null,
      turno: document.getElementById(`split_turno_col_${c.col}`)?.value?.trim() || "DIURNO",
      resultado_final: document.getElementById(`split_res_col_${c.col}`)?.value || "Aprovado"
    }));

    const baseComum = this.disciplinasCadastradas.filter(d => (d.categoria || "BASE_COMUM") === "BASE_COMUM");
    const diversificada = this.disciplinasCadastradas.filter(d => d.categoria === "DIVERSIFICADA");
    const todasDisciplinas = [...baseComum, ...diversificada];

    const notas = [];
    todasDisciplinas.forEach((d, idx) => {
      const nomeDisc = d.nome?.trim();
      if (nomeDisc) {
        this.colunasAtuais.forEach(c => {
          const notaInput = document.getElementById(`nota_split_disc_${d.id}_col_${c.col}`);
          const notaVal = notaInput?.value?.trim();
          notas.push({
            ordem_coluna: c.col,
            categoria: d.categoria || "BASE_COMUM",
            ordem_disciplina: idx + 1,
            disciplina_nome: nomeDisc,
            nota_ou_conceito: notaVal || "---"
          });
        });
      }
    });

    const operador = window.configManagerAtual?.operador_instalacao || "Revisor Split-Screen";
    const payload = {
      aluno: aluno,
      vida_escolar: vidaEscolar,
      notas_curriculares: notas,
      operador: operador
    };

    try {
      const btn = document.getElementById("btnSplitAprovarSalvar");
      btn.disabled = true;
      btn.textContent = "Gravando com HMAC...";

      const res = await fetch(`/api/ocr/sessao/${this.sessaoId}/aprovar-e-salvar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.sucesso) {
        window.sgmToast.error(data.detail || "Erro ao aprovar histórico escolar.", "Falha");
        btn.disabled = false;
        btn.textContent = "Aprovar e Salvar Histórico Oficial";
        return;
      }

      window.sgmToast.success(
        `Histórico aprovado e assinado digitalmente! Código: ${data.codigo_autenticidade}`,
        "Conferência Concluída"
      );

      this.container.innerHTML = "";

      if (window.appMain) {
        window.appMain.recarregarListaAlunos();
        window.appMain.atualizarContadorFilaIa();
      }
    } catch (e) {
      window.sgmToast.error(e.message, "Falha de Rede");
    }
  }

  async excluirAnalise() {
    const confirmou = await window.sgmDialog.confirm({
      title: "Excluir Análise de IA",
      message: "Deseja realmente excluir esta análise de IA e descartar as imagens escaneadas? Esta ação não pode ser desfeita.",
      confirmText: "Sim, Excluir Análise",
      isDanger: true
    });

    if (!confirmou) return;

    try {
      const res = await fetch(`/api/ocr/sessao/${this.sessaoId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok || !data.sucesso) {
        window.sgmToast.error(data.detail || "Erro ao excluir análise de IA.", "Falha");
        return;
      }

      window.sgmToast.success("A análise e as páginas escaneadas foram excluídas com sucesso.", "Análise Excluída");
      this.container.innerHTML = "";

      if (window.appMain) {
        if (typeof window.appMain.recarregarListaAlunos === "function") window.appMain.recarregarListaAlunos();
        if (typeof window.appMain.atualizarContadorFilaIa === "function") window.appMain.atualizarContadorFilaIa();
        if (typeof window.appMain.carregarFilaOcr === "function") window.appMain.carregarFilaOcr();
      }
    } catch (e) {
      window.sgmToast.error("Falha ao comunicar com o servidor: " + e.message, "Erro");
    }
  }
}

// Instância global
window.SplitReviewManager = SplitReviewManager;
