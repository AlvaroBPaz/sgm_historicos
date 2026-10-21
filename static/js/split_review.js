/**
 * SGM-Históricos — split_review.js
 * Módulo da Tela Dividida de Conferência e Revisão Livre da IA (Split-Screen)
 * 
 * Divisão:
 * - Lado Esquerdo (42%): Visualizador das páginas escaneadas com abas, zoom na roda do mouse, pan e rotação 90°.
 * - Lado Direito (58%): Formulário e Matriz preenchidos pelo Gemini 2.5 Flash, 100% editáveis pelo operador.
 * - Guia Visual Amarelo: Destaque 'bg-amber-100 border-amber-500' onde baixa_confianca == true,
 *   tornando-se verde/normal assim que o operador clica ou edita o campo.
 */

class SplitReviewManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.sessaoId = null;
    this.paginasWebp = [];
    this.paginaAtualIndex = 0;
    this.dadosIa = null;
    
    // Estado do visualizador da imagem (zoom, rotação, pan)
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

    try {
      const res = await fetch(`/api/ocr/sessao/${sessaoId}`);
      if (!res.ok) throw new Error("Não foi possível carregar a sessão.");
      
      const dados = await res.json();
      this.paginasWebp = dados.paginas || [];
      this.dadosIa = dados.dados_ia || {};
      this.paginaAtualIndex = 0;

      this.renderizarInterfaceSplit();
      this.iniciarVisualizadorImagem();
    } catch (e) {
      alert(`Erro ao abrir revisão: ${e.message}`);
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
      <div class="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex flex-col overflow-hidden">
        
        <!-- BARRA SUPERIOR DO SPLIT SCREEN -->
        <header class="bg-slate-900 border-b border-slate-700 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            <span class="bg-amber-500 text-slate-950 text-xs font-black px-2 py-0.5 rounded">MODO REVISÃO IA</span>
            <h1 class="text-sm font-bold truncate">Conferência de Documento: ${civis.nome_completo?.valor || 'Ex-Aluno Não Identificado'}</h1>
            <span class="text-xs text-slate-400">(${this.paginasWebp.length} folha(s) escaneada(s))</span>
          </div>

          <div class="flex items-center gap-2">
            <button id="btnSplitCancelar" type="button" class="text-xs font-semibold px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition">
              Fechar / Cancelar
            </button>
            <button id="btnSplitAprovarSalvar" type="button" class="text-xs font-bold px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center gap-1.5 transition">
              <span>✓</span> Aprovar e Salvar Histórico Oficial
            </button>
          </div>
        </header>

        <!-- CORPO PRINCIPAL COM DIVISÃO 42% / 58% -->
        <div class="flex-1 flex overflow-hidden">
          
          <!-- LADO ESQUERDO: 42% VISUALIZADOR DE PÁGINAS ESCANEADAS -->
          <div class="w-[42%] bg-slate-950 border-r border-slate-800 flex flex-col relative select-none">
            
            <!-- ABAS DAS PÁGINAS (Página 1, Página 2...) E CONTROLES -->
            <div class="bg-slate-900 border-b border-slate-800 p-2 flex items-center justify-between shrink-0">
              <div class="flex items-center gap-1 overflow-x-auto" id="splitAbasPaginas">
                ${this.paginasWebp.map((p, idx) => `
                  <button type="button" onclick="window.splitReview.trocarPagina(${idx})" class="text-xs font-semibold px-3 py-1 rounded transition-colors ${this.paginaAtualIndex === idx ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}">
                    Página ${idx + 1}
                  </button>
                `).join('')}
              </div>

              <!-- BOTÕES DE ZOOM E ROTAÇÃO -->
              <div class="flex items-center gap-1">
                <button id="btnZoomMenos" type="button" title="Diminuir Zoom" class="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-white text-xs">🔍-</button>
                <button id="btnZoomMais" type="button" title="Aumentar Zoom" class="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-white text-xs">🔍+</button>
                <button id="btnGirar90" type="button" title="Girar 90°" class="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-white text-xs">🔄</button>
                <button id="btnResetView" type="button" title="Ajustar à Tela" class="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-white text-xs">⤢</button>
              </div>
            </div>

            <!-- ÁREA DO VISUALIZADOR COM DRAG AND ZOOM -->
            <div id="splitViewerCanvas" class="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing flex items-center justify-center">
              <img id="splitImgDocumento" src="/api/scan/imagem-preview?caminho=${encodeURIComponent(this.paginasWebp[this.paginaAtualIndex] || '')}" alt="Documento Original" class="max-w-none transition-transform duration-75 origin-center shadow-2xl pointer-events-none" style="transform: translate(0px, 0px) scale(1) rotate(0deg);">
            </div>

            <!-- DICA RÁPIDA DE OPERAÇÃO -->
            <div class="bg-slate-900/90 text-slate-400 text-[11px] p-2 text-center border-t border-slate-800">
              Dica: Use a <b>roda do mouse</b> para dar zoom e <b>arraste com o mouse</b> para navegar na folha antiga.
            </div>
          </div>

          <!-- LADO DIREITO: 58% FORMULÁRIO E MATRIZ 100% EDITÁVEIS -->
          <div class="w-[58%] bg-slate-50 flex flex-col overflow-y-auto">
            
            <!-- ALERTA ORIENTATIVO DOS CAMPOS AMARELOS -->
            <div class="bg-amber-50 border-b border-amber-200 p-3.5 flex items-start gap-3">
              <span class="text-xl">💡</span>
              <div class="text-xs text-amber-900">
                <b>Guia Visual de Baixa Confiança:</b> Campos com fundo <span class="bg-amber-200 px-1.5 py-0.5 rounded font-bold border border-amber-400">amarelo</span> indicam rasura, carimbo ou letra cursiva duvidosa detectada pela IA. <b>Você tem liberdade total para alterar qualquer valor</b>. Ao clicar ou editar, o campo fica validado.
              </div>
            </div>

            <div class="p-5 space-y-6">

              <!-- REGIME DE ENSINO SUGERIDO PELA IA -->
              <div class="bg-white p-3.5 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <span class="text-xs font-bold text-slate-700 block">Regime Educacional Sugerido pela IA:</span>
                  <span class="text-xs text-slate-500">Altere se a IA confundiu 8 Séries com 9 Anos ou EJA.</span>
                </div>
                <div class="flex items-center gap-1.5 text-xs font-bold">
                  <label class="cursor-pointer flex items-center gap-1 bg-slate-100 hover:bg-blue-50 px-2.5 py-1.5 rounded border border-slate-300">
                    <input type="radio" name="split_regime" value="8_ANOS" ${regimeSugerido === '8_ANOS' ? 'checked' : ''} onchange="window.splitReview.atualizarRegimeMatriz('8_ANOS')">
                    8 Anos (1ª a 8ª Série)
                  </label>
                  <label class="cursor-pointer flex items-center gap-1 bg-slate-100 hover:bg-blue-50 px-2.5 py-1.5 rounded border border-slate-300">
                    <input type="radio" name="split_regime" value="9_ANOS" ${regimeSugerido === '9_ANOS' ? 'checked' : ''} onchange="window.splitReview.atualizarRegimeMatriz('9_ANOS')">
                    9 Anos (1º ao 9º Ano)
                  </label>
                  <label class="cursor-pointer flex items-center gap-1 bg-slate-100 hover:bg-blue-50 px-2.5 py-1.5 rounded border border-slate-300">
                    <input type="radio" name="split_regime" value="EJA_ETAPAS" ${regimeSugerido === 'EJA_ETAPAS' ? 'checked' : ''} onchange="window.splitReview.atualizarRegimeMatriz('EJA_ETAPAS')">
                    EJA (Etapas)
                  </label>
                </div>
              </div>

              <!-- DADOS CIVIS IDENTIFICADOS -->
              <div class="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span>👤</span> Identificação Civil do Ex-Aluno
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-slate-700 mb-1">Nome Completo *</label>
                    ${this.gerarInputEditavel("split_nome_completo", civis.nome_completo, "Nome completo do aluno")}
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1">Data de Nascimento</label>
                    ${this.gerarInputEditavel("split_data_nascimento", civis.data_nascimento, "DD/MM/AAAA")}
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-slate-700 mb-1">Naturalidade (Município)</label>
                    ${this.gerarInputEditavel("split_nat_mun", civis.naturalidade_municipio, "Município")}
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-slate-700 mb-1">UF</label>
                    ${this.gerarInputEditavel("split_nat_uf", civis.naturalidade_uf, "UF")}
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-slate-700 mb-1">RG / Registro Civil</label>
                    ${this.gerarInputEditavel("split_rg_numero", civis.rg_numero, "RG antigo")}
                  </div>

                  <div class="sm:col-span-3 grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-slate-700 mb-1">Nome da Mãe / Filiação 1</label>
                      ${this.gerarInputEditavel("split_filiacao_1", civis.filiacao_1, "Nome da mãe")}
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-slate-700 mb-1">Nome do Pai / Filiação 2</label>
                      ${this.gerarInputEditavel("split_filiacao_2", civis.filiacao_2, "Nome do pai (se constar)")}
                    </div>
                  </div>
                </div>
              </div>

              <!-- PLANILHA MATRICIAL DE SÉRIES E NOTAS EXTRAÍDAS -->
              <div class="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span>📊</span> Matriz de Notas e Séries Cursadas
                  </h3>
                  <button type="button" onclick="window.splitReview.adicionarDisciplinaLinha()" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-bold border border-slate-300">
                    + Adicionar Matéria
                  </button>
                </div>

                <div class="overflow-x-auto border border-slate-300 rounded shadow-inner">
                  <table class="w-full text-xs border-collapse text-left" id="tabelaSplitMatriz">
                    <!-- Gerada dinamicamente com base nas colunas e notas da IA -->
                  </table>
                </div>
              </div>

              <!-- OBSERVAÇÕES E LEIS EXTRAÍDAS -->
              <div class="bg-white p-4 rounded-lg border border-slate-200">
                <label class="block text-xs font-bold text-slate-700 mb-1">Observações Históricas / Leis da Época</label>
                <textarea id="split_observacoes" rows="2" class="w-full border border-slate-300 rounded p-2 text-xs focus:ring-2 focus:ring-blue-500">${obs.valor || ''}</textarea>
              </div>

            </div>
          </div>
        </div>
      </div>
    `;

    this.conectarEventosSplit();
    this.renderizarMatrizRevisao(regimeSugerido, series, notas);
  }

  gerarInputEditavel(id, campoObj, placeholder = "") {
    const valor = campoObj?.valor || "";
    const isDuvidoso = campoObj?.baixa_confianca === true;
    const classeDestaque = isDuvidoso
      ? "bg-amber-100 border-amber-500 text-amber-950 ring-2 ring-amber-300 font-bold"
      : "bg-white border-slate-300 text-slate-800";

    return `
      <input type="text" id="${id}" value="${valor}" placeholder="${placeholder}"
        class="w-full border rounded px-2.5 py-1.5 text-xs transition-colors ${classeDestaque}"
        onfocus="window.splitReview.removerAlertaAmarelo(this)"
        oninput="window.splitReview.removerAlertaAmarelo(this)">
    `;
  }

  removerAlertaAmarelo(inputEl) {
    if (inputEl.classList.contains("bg-amber-100")) {
      inputEl.classList.remove("bg-amber-100", "border-amber-500", "text-amber-950", "ring-2", "ring-amber-300");
      inputEl.classList.add("bg-emerald-50", "border-emerald-400", "text-slate-900");
    }
  }

  renderizarMatrizRevisao(regime, seriesIa = [], notasIa = []) {
    const tabela = document.getElementById("tabelaSplitMatriz");
    if (!tabela) return;

    const numCols = regime === "9_ANOS" ? 9 : (regime === "EJA_ETAPAS" ? 4 : 8);
    const colunas = [];
    for (let c = 1; c <= numCols; c++) {
      let label = `${c}ª Série`;
      if (regime === "9_ANOS") label = `${c}º Ano`;
      if (regime === "EJA_ETAPAS") label = `${c}ª Etapa`;
      
      const sIa = seriesIa.find(s => s.ordem_coluna === c);
      colunas.push({
        col: c,
        label: sIa?.label_serie?.valor || label,
        ano_letivo: sIa?.ano_letivo?.valor || "",
        escola_nome: sIa?.escola_nome?.valor || "",
        resultado_final: sIa?.resultado_final?.valor || "Aprovado",
        duvidoso: sIa?.resultado_final?.baixa_confianca || false
      });
    }

    // Agrupa notas por nome da disciplina
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

    // Se a IA não retornou disciplinas, adiciona clássicas para preenchimento
    if (mapaDisciplinas.size === 0) {
      ["Língua Portuguesa", "Matemática", "Estudos Sociais", "Ciências", "Educação Física"].forEach(m => {
        mapaDisciplinas.set(m, { nome: m, categoria: "BASE_COMUM", notas: {} });
      });
    }

    let html = `
      <thead>
        <tr class="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
          <th class="p-2 w-48 border-r border-slate-300">DISCIPLINA</th>
          ${colunas.map(c => `
            <th class="p-1.5 text-center border-r border-slate-300 min-w-[75px] text-blue-900">${c.label}</th>
          `).join('')}
          <th class="p-1 w-10 text-center">X</th>
        </tr>

        <!-- Linha Ano Letivo -->
        <tr class="bg-slate-50 border-b border-slate-200">
          <td class="p-1.5 font-semibold text-slate-600 border-r border-slate-300">Ano:</td>
          ${colunas.map(c => `
            <td class="p-1 border-r border-slate-300">
              <input type="text" id="split_ano_col_${c.col}" value="${c.ano_letivo}" placeholder="Ano" class="w-full text-center border border-slate-300 rounded py-0.5 text-xs">
            </td>
          `).join('')}
          <td></td>
        </tr>

        <!-- Linha Resultado -->
        <tr class="bg-blue-50/70 border-b-2 border-slate-300">
          <td class="p-1.5 font-bold text-blue-900 border-r border-slate-300">Resultado:</td>
          ${colunas.map(c => `
            <td class="p-1 border-r border-slate-300">
              <select id="split_res_col_${c.col}" class="w-full border border-blue-300 rounded py-0.5 text-xs font-bold text-slate-800">
                <option value="Aprovado" ${c.resultado_final === 'Aprovado' ? 'selected' : ''}>Aprovado</option>
                <option value="Promovido" ${c.resultado_final === 'Promovido' ? 'selected' : ''}>Promovido</option>
                <option value="Reprovado" ${c.resultado_final === 'Reprovado' ? 'selected' : ''}>Reprovado</option>
                <option value="Transferido" ${c.resultado_final === 'Transferido' ? 'selected' : ''}>Transferido</option>
                <option value="Não Cursado" ${c.resultado_final === 'Não Cursado' ? 'selected' : ''}>Não Cursado</option>
              </select>
            </td>
          `).join('')}
          <td></td>
        </tr>
      </thead>
      <tbody id="splitCorpoDisciplinas">
    `;

    let discIdx = 0;
    mapaDisciplinas.forEach((d, nomeDisc) => {
      html += `
        <tr class="border-b border-slate-200 hover:bg-slate-50" id="linha_split_disc_${discIdx}">
          <td class="p-1.5 border-r border-slate-300 font-semibold text-slate-800">
            <input type="text" id="nome_split_disc_${discIdx}" value="${nomeDisc}" class="w-full border-0 border-b border-transparent focus:border-blue-500 text-xs font-semibold">
          </td>
          ${colunas.map(c => {
            const notaObj = d.notas[c.col] || { valor: "", duvidoso: false };
            const classeDestaque = notaObj.duvidoso
              ? "bg-amber-100 border-amber-500 font-black text-amber-950 ring-2 ring-amber-300"
              : "bg-white border-slate-300 text-slate-900";

            return `
              <td class="p-1 border-r border-slate-300">
                <input type="text" id="nota_split_disc_${discIdx}_col_${c.col}" value="${notaObj.valor}" placeholder="---"
                  class="w-full text-center border rounded py-1 text-xs font-bold transition-colors ${classeDestaque}"
                  onfocus="window.splitReview.removerAlertaAmarelo(this)"
                  oninput="window.splitReview.removerAlertaAmarelo(this)">
              </td>
            `;
          }).join('')}
          <td class="p-1 text-center">
            <button type="button" onclick="document.getElementById('linha_split_disc_${discIdx}').remove()" class="text-rose-500 hover:text-rose-700 font-bold">×</button>
          </td>
        </tr>
      `;
      discIdx++;
    });

    html += "</tbody>";
    tabela.innerHTML = html;
    this.totalLinhasDisciplinas = discIdx;
    this.colunasAtuais = colunas;
  }

  adicionarDisciplinaLinha() {
    const nome = prompt("Nome da nova disciplina para a planilha:");
    if (!nome || !nome.trim()) return;

    const tbody = document.getElementById("splitCorpoDisciplinas");
    if (!tbody) return;

    const idx = this.totalLinhasDisciplinas || 100;
    const tr = document.createElement("tr");
    tr.className = "border-b border-slate-200 hover:bg-slate-50";
    tr.id = `linha_split_disc_${idx}`;

    let html = `
      <td class="p-1.5 border-r border-slate-300 font-semibold text-slate-800">
        <input type="text" id="nome_split_disc_${idx}" value="${nome.trim()}" class="w-full border-0 border-b border-transparent focus:border-blue-500 text-xs font-semibold">
      </td>
    `;
    this.colunasAtuais.forEach(c => {
      html += `
        <td class="p-1 border-r border-slate-300">
          <input type="text" id="nota_split_disc_${idx}_col_${c.col}" value="" placeholder="---" class="w-full text-center border border-slate-300 rounded py-1 text-xs font-bold">
        </td>
      `;
    });
    html += `
      <td class="p-1 text-center">
        <button type="button" onclick="document.getElementById('linha_split_disc_${idx}').remove()" class="text-rose-500 hover:text-rose-700 font-bold">×</button>
      </td>
    `;
    tr.innerHTML = html;
    tbody.appendChild(tr);
    this.totalLinhasDisciplinas = idx + 1;
  }

  trocarPagina(index) {
    this.paginaAtualIndex = index;
    const img = document.getElementById("splitImgDocumento");
    if (img && this.paginasWebp[index]) {
      img.src = `/api/scan/imagem-preview?caminho=${encodeURIComponent(this.paginasWebp[index])}`;
    }
    // Atualiza visual das abas
    const abasBox = document.getElementById("splitAbasPaginas");
    if (abasBox) {
      const botoes = abasBox.querySelectorAll("button");
      botoes.forEach((btn, idx) => {
        btn.className = `text-xs font-semibold px-3 py-1 rounded transition-colors ${this.paginaAtualIndex === idx ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`;
      });
    }
  }

  iniciarVisualizadorImagem() {
    const viewer = document.getElementById("splitViewerCanvas");
    const img = document.getElementById("splitImgDocumento");
    if (!viewer || !img) return;

    const aplicarTransform = () => {
      img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomNivel}) rotate(${this.rotacaoGraus}deg)`;
    };

    // Zoom na roda do mouse
    viewer.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      this.zoomNivel = Math.min(Math.max(0.4, this.zoomNivel + delta), 4.0);
      aplicarTransform();
    }, { passive: false });

    // Drag / Pan com o mouse
    viewer.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.startX;
      this.panY = e.clientY - this.startY;
      aplicarTransform();
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    // Controles manuais
    document.getElementById("btnZoomMais")?.addEventListener("click", () => {
      this.zoomNivel = Math.min(4.0, this.zoomNivel + 0.25);
      aplicarTransform();
    });
    document.getElementById("btnZoomMenos")?.addEventListener("click", () => {
      this.zoomNivel = Math.max(0.4, this.zoomNivel - 0.25);
      aplicarTransform();
    });
    document.getElementById("btnGirar90")?.addEventListener("click", () => {
      this.rotacaoGraus = (this.rotacaoGraus + 90) % 360;
      aplicarTransform();
    });
    document.getElementById("btnResetView")?.addEventListener("click", () => {
      this.zoomNivel = 1.0;
      this.panX = 0;
      this.panY = 0;
      this.rotacaoGraus = 0;
      aplicarTransform();
    });
  }

  conectarEventosSplit() {
    document.getElementById("btnSplitCancelar")?.addEventListener("click", () => {
      if (confirm("Deseja sair da revisão? Os dados não salvos permanecerão como rascunho na fila de IA.")) {
        this.container.innerHTML = "";
      }
    });

    document.getElementById("btnSplitAprovarSalvar")?.addEventListener("click", () => this.aprovarESalvar());
  }

  async aprovarESalvar() {
    const nome = document.getElementById("split_nome_completo")?.value?.trim();
    if (!nome) {
      alert("Por favor, preencha o Nome Completo do aluno antes de aprovar.");
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
      resultado_final: document.getElementById(`split_res_col_${c.col}`)?.value || "Aprovado"
    }));

    const notas = [];
    const tbody = document.getElementById("splitCorpoDisciplinas");
    if (tbody) {
      const rows = tbody.querySelectorAll("tr");
      rows.forEach((r, idx) => {
        const idLinha = r.id.replace("linha_split_disc_", "");
        const nomeDisc = document.getElementById(`nome_split_disc_${idLinha}`)?.value?.trim();
        if (nomeDisc) {
          this.colunasAtuais.forEach(c => {
            const notaVal = document.getElementById(`nota_split_disc_${idLinha}_col_${c.col}`)?.value?.trim();
            notas.push({
              ordem_coluna: c.col,
              categoria: "BASE_COMUM",
              ordem_disciplina: idx + 1,
              disciplina_nome: nomeDisc,
              nota_ou_conceito: notaVal || "---"
            });
          });
        }
      });
    }

    const payload = {
      aluno: aluno,
      vida_escolar: vidaEscolar,
      notas_curriculares: notas,
      operador: "Revisor Split-Screen"
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
        alert(data.detail || "Erro ao aprovar histórico.");
        btn.disabled = false;
        btn.textContent = "Aprovar e Salvar Histórico Oficial";
        return;
      }

      alert(`✓ Histórico Escolar aprovado e assinado digitalmente!\nCódigo de Autenticidade: ${data.codigo_autenticidade}`);
      this.container.innerHTML = "";

      // Atualiza listagens no aplicativo principal
      if (window.appMain) {
        window.appMain.recarregarListaAlunos();
        window.appMain.atualizarContadorFilaIa();
      }
    } catch (e) {
      alert(`Falha ao salvar: ${e.message}`);
    }
  }
}

// Instância global
window.SplitReviewManager = SplitReviewManager;
