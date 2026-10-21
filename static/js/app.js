/**
 * SGM-Históricos — app.js
 * Controlador Principal da Interface SPA Desktop
 * 
 * Integração:
 * - Setup Wizard e Modo Camaleão (Ativação de Primeiro Uso);
 * - Indicador luminoso em tempo real de Sincronização e Fila de IA;
 * - Busca multifatorial e listagem de ex-alunos do Arquivo Passivo;
 * - Modal de Escaneamento Sem Fio (QR Code na tela + Scanner USB WIA);
 * - Integração com editor_matriz.js e split_review.js.
 */

class AppControlePrincipal {
  constructor() {
    this.config = null;
    this.escolas = [];
    this.paginaAtual = 0;
    this.limitePorPagina = 25;
    this.sessaoScanAtiva = null;
    this.intervaloPollingScan = null;
    this.intervaloPollingSync = null;

    // Instancia os sub-módulos
    window.editorMatriz = new EditorMatrizHistorico("containerEditorMatriz");
    window.splitReview = new SplitReviewManager("containerSplitReview");
  }

  async inicializar() {
    await this.carregarConfiguracao();
    await this.carregarEscolas();

    if (!this.config?.configurado) {
      this.abrirModalSetupWizard();
    } else {
      this.aplicarPerfilInterface();
      this.recarregarListaAlunos();
      this.atualizarContadorFilaIa();
      this.atualizarStatusSincronizacao();
      
      // Inicia pollings em segundo plano (30s)
      this.iniciarPollingsBackground();
    }

    this.conectarEventosGerais();
  }

  async carregarConfiguracao() {
    try {
      const res = await fetch("/api/config/status");
      const dados = await res.json();
      this.config = dados.configuracao || {};
      this.config.configurado = dados.configurado;
      this.ipLocal = dados.ip_local;
      window.configManagerAtual = this.config;
    } catch (e) {
      console.error("Erro ao obter configuração:", e);
    }
  }

  async carregarEscolas() {
    try {
      const res = await fetch("/api/escolas");
      this.escolas = await res.json();
      this.preencherFiltroEscolas();
    } catch (e) {
      console.error("Erro ao listar escolas:", e);
    }
  }

  aplicarPerfilInterface() {
    const nomeBadge = document.getElementById("headerNomeEscola");
    const perfilBadge = document.getElementById("headerBadgePerfil");

    if (this.config.modo === "SME") {
      nomeBadge.textContent = "Secretaria Municipal de Educação (SME)";
      perfilBadge.textContent = "ACESSO GLOBAL";
      perfilBadge.className = "text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-400 text-slate-950";
      document.getElementById("btnPainelSme")?.classList.remove("hidden");
    } else {
      nomeBadge.textContent = this.config.escola_nome || "Escola Municipal";
      perfilBadge.textContent = "UNIDADE ESCOLAR";
      perfilBadge.className = "text-[10px] font-black uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-900";
      document.getElementById("btnPainelSme")?.classList.add("hidden");
    }
  }

  preencherFiltroEscolas() {
    const select = document.getElementById("filtroEscola");
    if (!select) return;

    select.innerHTML = `<option value="">Todas as Escolas Municipais</option>` +
      this.escolas.map(e => `
        <option value="${e.id}" ${this.config?.escola_id === e.id ? 'selected' : ''}>
          ${e.nome_oficial} ${e.extinta ? '(Extinta)' : ''}
        </option>
      `).join("");
  }

  // ============================================================================
  // SETUP WIZARD (MODO CAMALEÃO - ATIVAÇÃO DE PRIMEIRO USO)
  // ============================================================================

  abrirModalSetupWizard() {
    const modal = document.getElementById("modalSetupWizard");
    if (!modal) return;
    modal.classList.remove("hidden");

    // Popula dropdown das 8 escolas municipais oficiais
    fetch("/api/config/catalogo-escolas")
      .then(r => r.json())
      .then(lista => {
        const select = document.getElementById("wizardEscolaSelect");
        if (select) {
          select.innerHTML = lista.map(e => `
            <option value="${e.id}">[Escola ${e.id}] ${e.nome_oficial} (${e.drive_particao})</option>
          `).join("");
        }
      });
  }

  async ativarPerfilEscola() {
    const escolaId = parseInt(document.getElementById("wizardEscolaSelect")?.value, 10);
    const codigoAtivacao = document.getElementById("wizardCodigoAtivacao")?.value?.trim();
    const operador = document.getElementById("wizardOperadorEscola")?.value?.trim() || "Secretaria Escolar";

    if (!codigoAtivacao) {
      alert("Informe o código de ativação da unidade escolar (ex: ESC01-2026).");
      return;
    }

    try {
      const res = await fetch("/api/config/ativar-escola", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escola_id: escolaId,
          codigo_ativacao: codigoAtivacao,
          operador_nome: operador
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro na ativação.");

      alert("✓ Unidade Escolar ativada com sucesso!");
      document.getElementById("modalSetupWizard").classList.add("hidden");
      window.location.reload();
    } catch (e) {
      alert(`Falha na ativação: ${e.message}`);
    }
  }

  async ativarPerfilSme() {
    const senha = document.getElementById("wizardSenhaMestra")?.value;
    const operador = document.getElementById("wizardOperadorSme")?.value?.trim() || "Administrador SME";

    if (!senha) {
      alert("Informe a Senha Mestra da Secretaria.");
      return;
    }

    try {
      const res = await fetch("/api/config/ativar-sme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senha_mestra: senha,
          operador_nome: operador
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Senha Mestra incorreta.");

      alert("✓ Máquina ativada como Secretaria de Educação (SME)!");
      document.getElementById("modalSetupWizard").classList.add("hidden");
      window.location.reload();
    } catch (e) {
      alert(`Falha na ativação: ${e.message}`);
    }
  }

  // ============================================================================
  // LISTAGEM E BUSCA DE EX-ALUNOS
  // ============================================================================

  async recarregarListaAlunos() {
    const busca = document.getElementById("inputBuscaGeral")?.value?.trim();
    const escolaId = document.getElementById("filtroEscola")?.value;
    const statusFicha = document.getElementById("filtroStatus")?.value;

    let url = `/api/alunos?limite=${this.limitePorPagina}&offset=${this.paginaAtual * this.limitePorPagina}`;
    if (busca) url += `&busca=${encodeURIComponent(busca)}`;
    if (escolaId) url += `&escola_id=${escolaId}`;
    if (statusFicha) url += `&status_ficha=${encodeURIComponent(statusFicha)}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      this.renderizarTabelaAlunos(data.alunos || [], data.total || 0);
    } catch (e) {
      console.error("Erro ao carregar alunos:", e);
    }
  }

  renderizarTabelaAlunos(alunos, total) {
    const tbody = document.getElementById("tabelaAlunosBody");
    const totalEl = document.getElementById("totalAlunosEncontrados");
    if (totalEl) totalEl.textContent = `${total} ex-aluno(s) localizado(s)`;
    if (!tbody) return;

    if (alunos.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="p-8 text-center text-slate-500">
            <span class="text-3xl block mb-2">📂</span>
            Nenhum ex-aluno localizado com os filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = alunos.map(a => {
      // Badge de Status
      let badgeStatus = '<span class="status-badge status-pendente bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[11px] font-bold">Rascunho IA</span>';
      if (a.status_ficha === "LACRADO_HOMOLOGADO") {
        badgeStatus = '<span class="status-badge status-sucesso bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1">🔒 Homologado</span>';
      } else if (a.status_ficha === "DIGITADO") {
        badgeStatus = '<span class="status-badge status-digitado bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[11px] font-bold">Digitado</span>';
      }

      return `
        <tr class="linha-aluno border-b border-slate-200 transition-colors">
          <td class="p-3">
            <div class="font-bold text-slate-900 nome-aluno text-destaque-blue">${a.nome_completo}</div>
            <div class="text-xs text-slate-500 flex items-center gap-2">
              <span>Nasc: ${a.data_nascimento || 'Não informada'}</span>
              ${a.rg_numero ? `<span>RG: ${a.rg_numero}</span>` : ''}
            </div>
          </td>
          <td class="p-3 text-xs text-slate-600">
            <div class="font-semibold text-slate-700">${a.escola_nome || 'Escola ' + a.escola_id}</div>
            <div class="text-[11px] text-slate-400 font-mono">${a.codigo_autenticidade || '---'}</div>
          </td>
          <td class="p-3 text-xs">
            <span class="font-semibold text-slate-800">${a.regime_ensino === '8_ANOS' ? '8 Anos (1ª-8ª)' : (a.regime_ensino === '9_ANOS' ? '9 Anos (1º-9º)' : 'EJA')}</span>
          </td>
          <td class="p-3 text-xs">
            ${badgeStatus}
          </td>
          <td class="p-3 text-xs text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button type="button" title="Editar Histórico" onclick="window.appMain.abrirEdicaoAluno('${a.uuid}')" class="px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold border border-blue-200">
                ✏️ Editar
              </button>
              <button type="button" title="Imprimir Histórico A4" onclick="window.appMain.abrirImpressaoA4('${a.uuid}')" class="px-2.5 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold border border-slate-300">
                🖨️ A4
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  async abrirEdicaoAluno(alunoUuid) {
    try {
      const res = await fetch(`/api/alunos/${alunoUuid}/historico-completo`);
      if (!res.ok) throw new Error("Erro ao obter dados do aluno.");
      const dados = await res.json();

      document.getElementById("modalEdicaoMatriz").classList.remove("hidden");
      window.editorMatriz.renderizarInterfaceCompleta();
      window.editorMatriz.carregarDadosAlunoCompleto(dados.aluno, dados.vida_escolar, dados.notas_curriculares);

      // Aviso de violação de integridade caso o SQLite tenha sido adulterado externamente
      if (dados.integridade && !dados.integridade.integro) {
        alert("⚠️ ALERTA DE SEGURANÇA: Foi detectada divergência na assinatura digital HMAC deste registro! Ele pode ter sido modificado por fora do programa.");
      }
    } catch (e) {
      alert(`Falha: ${e.message}`);
    }
  }

  abrirNovoAluno() {
    document.getElementById("modalEdicaoMatriz").classList.remove("hidden");
    window.editorMatriz.renderizarInterfaceCompleta();
    window.editorMatriz.alunoAtualUuid = null;
    window.editorMatriz.carregarGradePadraoInicial();
    window.editorMatriz.renderizarTabelaMatriz();
  }

  fecharModalEdicao() {
    document.getElementById("modalEdicaoMatriz")?.classList.add("hidden");
  }

  abrirImpressaoA4(alunoUuid) {
    window.open(`/impressao/${alunoUuid}`, "_blank");
  }

  // ============================================================================
  // SCANNER SEM FIO (QR CODE + UPLOAD CELULAR + SCANNER USB)
  // ============================================================================

  async abrirModalScanner() {
    const modal = document.getElementById("modalScanner");
    if (!modal) return;
    modal.classList.remove("hidden");

    try {
      const res = await fetch("/api/scan/iniciar-sessao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escola_id: this.config?.escola_id || 1,
          origem_captura: "MOBILE_QR"
        })
      });

      const data = await res.json();
      this.sessaoScanAtiva = data.sessao_id;

      // Exibe QR Code e Link
      document.getElementById("imgQrCodeScanner").src = data.qr_code_base64;
      document.getElementById("linkMobileUrl").textContent = data.mobile_url;
      document.getElementById("linkMobileUrl").href = data.mobile_url;
      document.getElementById("scanSessaoIdBadge").textContent = `Sessão: ${data.sessao_id.substring(0, 8)}...`;

      this.iniciarMonitoramentoSessaoScan(data.sessao_id);
    } catch (e) {
      alert(`Erro ao iniciar sessão de escaneamento: ${e.message}`);
    }
  }

  exibirModalRejeicao(motivo) {
    const modal = document.getElementById("modalRejeicaoFotoPc");
    const txt = document.getElementById("txtMotivoRejeicaoPc");
    if (txt) txt.textContent = motivo;
    if (modal) modal.classList.remove("hidden");
  }

  fecharModalRejeicaoETirarOutra() {
    const modal = document.getElementById("modalRejeicaoFotoPc");
    if (modal) modal.classList.add("hidden");
    this.abrirModalScanner();
  }

  iniciarMonitoramentoSessaoScan(sessaoId) {
    if (this.intervaloPollingScan) clearInterval(this.intervaloPollingScan);

    const containerThumbs = document.getElementById("scanPaginasRecebidasGrid");
    containerThumbs.innerHTML = `<p class="text-xs text-slate-400 col-span-3 text-center py-4">Aguardando fotos do celular ou PC...</p>`;

    this.intervaloPollingScan = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan/${sessaoId}/status`);
        if (res.ok) {
          const dados = await res.json();

          // Bloqueio rigoroso: se rejeitado pela IA
          if (dados.status === "REJEITADO_INVALIDO") {
            clearInterval(this.intervaloPollingScan);
            document.getElementById("modalScanner").classList.add("hidden");
            this.exibirModalRejeicao(dados.ultimo_erro || "Documento rejeitado pela IA por não ser um Histórico Escolar válido ou estar ilegível.");
            return;
          }

          if (dados.paginas && dados.paginas.length > 0) {
            containerThumbs.innerHTML = dados.paginas.map((p, idx) => `
              <div class="relative bg-slate-100 rounded border border-slate-300 aspect-[3/4] overflow-hidden">
                <img src="/api/scan/imagem-preview?caminho=${encodeURIComponent(p)}" class="w-full h-full object-cover">
                <span class="absolute bottom-1 left-1 bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">Pág ${idx + 1}</span>
              </div>
            `).join("");
            document.getElementById("btnScanFinalizarIa").disabled = false;
          }
        }
      } catch (e) {}
    }, 2000);
  }

  async uploadImagemPc(file) {
    if (!this.sessaoScanAtiva || !file) return;

    const btn = document.getElementById("btnUploadArquivoPc");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Processando...";
    }

    const formData = new FormData();
    formData.append("arquivo", file);

    try {
      const res = await fetch(`/api/scan/${this.sessaoScanAtiva}/upload-pagina`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Foto / PDF do PC";
      }

      if (!res.ok || !data.sucesso) {
        // Bloqueio rigoroso: foto reprovada pelo OpenCV (erro 422)
        const motivo = data.detail || data.mensagem || "Foto rejeitada pelo Porteiro de Qualidade.";
        this.exibirModalRejeicao(motivo);
      }
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Foto / PDF do PC";
      }
      this.exibirModalRejeicao(`Erro no envio: ${e.message}`);
    }
  }

  async acionarScannerUsbPc() {
    if (!this.sessaoScanAtiva) return;
    const btn = document.getElementById("btnAcionarScannerWia");
    btn.disabled = true;
    btn.textContent = "Acionando scanner...";

    try {
      const res = await fetch(`/api/scan/${this.sessaoScanAtiva}/scanner-pc`, { method: "POST" });
      const data = await res.json();
      btn.disabled = false;
      btn.textContent = "Scanner USB (WIA)";

      if (!res.ok) {
        this.exibirModalRejeicao(data.detail || "Erro ao acionar scanner.");
      } else {
        alert(`✓ Página digitalizada com sucesso!`);
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Scanner USB (WIA)";
      this.exibirModalRejeicao(`Erro: ${e.message}`);
    }
  }

  async finalizarEnvelopeScan() {
    if (!this.sessaoScanAtiva) return;

    try {
      const res = await fetch(`/api/scan/${this.sessaoScanAtiva}/finalizar`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao finalizar.");

      clearInterval(this.intervaloPollingScan);
      document.getElementById("modalScanner").classList.add("hidden");
      alert("✓ Envelope enviado para a fila de Inteligência Artificial! Acompanhe na aba 'Fila de Revisão IA'.");
      this.atualizarContadorFilaIa();
    } catch (e) {
      alert(`Erro: ${e.message}`);
    }
  }

  // ============================================================================
  // FILA DE REVISÃO IA E SINCRONIZAÇÃO
  // ============================================================================

  async atualizarContadorFilaIa() {
    try {
      const res = await fetch("/api/ocr/fila");
      const data = await res.json();
      const badge = document.getElementById("badgeFilaIaCount");
      const total = data.total_para_revisar || 0;
      if (badge) {
        badge.textContent = total;
        badge.className = total > 0
          ? "bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full text-xs font-black animate-pulse"
          : "bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-xs font-bold";
      }

      this.renderizarCardsFilaIa(data.aguardando_revisao || [], data.rejeitados || [], data.erros_api || []);
    } catch (e) {}
  }

  renderizarCardsFilaIa(lista, rejeitados = [], errosApi = []) {
    const box = document.getElementById("containerCardsFilaIa");
    if (!box) return;

    if (lista.length === 0 && rejeitados.length === 0 && errosApi.length === 0) {
      box.innerHTML = `
        <div class="col-span-3 text-center py-12 text-slate-500">
          <span class="text-3xl block mb-2">🎉</span>
          Nenhum histórico aguardando revisão humana no momento. Todos os envelopes foram processados!
        </div>
      `;
      return;
    }

    let html = "";

    // 1. Cards de Erro na API do Gemini (Parados na fila para reenvio manual pelo operador)
    if (errosApi.length > 0) {
      html += errosApi.map(e => `
        <div class="bg-amber-50 rounded-xl border-2 border-amber-500 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-amber-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wide">FALHA NA API GEMINI</span>
              <span class="text-xs text-amber-700 font-mono font-bold">${e.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-amber-950 text-sm mb-1.5 flex items-center gap-1.5">
              <span>⚠️</span> Erro ao Transcrever Documento
            </h4>
            <p class="text-xs text-amber-950 bg-white p-2.5 rounded border border-amber-300 leading-relaxed font-mono break-all max-h-24 overflow-y-auto">
              ${e.ultimo_erro || "Erro inesperado na chamada da API do Gemini."}
            </p>
          </div>

          <div class="mt-4 flex gap-2">
            <button type="button" onclick="window.appMain.tentarNovamenteOcr('${e.sessao_id}')" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition">
              <span>🔄</span> Tentar Novamente
            </button>
            <button type="button" onclick="window.appMain.descartarSessaoRejeitada('${e.sessao_id}')" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs px-3 py-2 rounded-lg flex items-center justify-center transition" title="Descartar envelope">
              <span>🗑️</span>
            </button>
          </div>
        </div>
      `).join("");
    }

    // 2. Cards de Documentos Rejeitados pelo Controle de Qualidade / Gemini
    if (rejeitados.length > 0) {
      html += rejeitados.map(r => `
        <div class="bg-red-50 rounded-xl border-2 border-red-500 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wide">FOTO RECUSADA PELA IA</span>
              <span class="text-xs text-red-400 font-mono">${r.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-red-950 text-sm mb-1.5 flex items-center gap-1.5">
              <span>⛔</span> Documento Inválido ou Ilegível
            </h4>
            <p class="text-xs text-red-800 bg-white p-2.5 rounded border border-red-200 leading-relaxed font-medium">
              ${r.ultimo_erro || "A imagem enviada não é um Histórico Escolar ou está ilegível."}
            </p>
          </div>

          <div class="mt-4 flex gap-2">
            <button type="button" onclick="window.appMain.descartarSessaoRejeitada('${r.sessao_id}')" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1 transition">
              <span>🗑️</span> Descartar Envelope
            </button>
          </div>
        </div>
      `).join("");
    }

    // 3. Cards de Documentos Válidos Aguardando Revisão
    html += lista.map(s => {
      let dados = {};
      try { dados = JSON.parse(s.json_extraido_ia || "{}"); } catch (e) {}
      const nome = dados.dados_civis?.nome_completo?.valor || "Aluno Não Identificado";
      const pags = JSON.parse(s.paginas_locais_json || "[]");

      return `
        <div class="bg-white rounded-xl border border-amber-300 p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-amber-100 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded">PRONTO PARA CONFERÊNCIA</span>
              <span class="text-xs text-slate-400 font-mono">${s.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-slate-900 text-sm mb-1">${nome}</h4>
            <p class="text-xs text-slate-500">${pags.length} folha(s) escaneada(s)</p>
          </div>

          <button type="button" onclick="window.splitReview.abrirSessaoParaRevisao('${s.sessao_id}')" class="mt-4 w-full bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition">
            <span>🔍</span> Abrir Tela Dividida de Conferência
          </button>
        </div>
      `;
    }).join("");

    box.innerHTML = html;
  }

  async tentarNovamenteOcr(sessaoId) {
    try {
      const res = await fetch(`/api/ocr/sessao/${sessaoId}/tentar-novamente`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao reenviar envelope para a fila.");
      this.atualizarContadorFilaIa();
    } catch (e) {
      alert(`Erro: ${e.message}`);
    }
  }

  async descartarSessaoRejeitada(sessaoId) {
    if (!confirm("Deseja descartar este envelope reprovado?")) return;
    try {
      await fetch(`/api/ocr/sessao/${sessaoId}`, { method: "DELETE" });
      this.atualizarContadorFilaIa();
    } catch (e) {
      alert(`Erro ao descartar: ${e.message}`);
    }
  }

  async atualizarStatusSincronizacao() {
    try {
      const res = await fetch("/api/sync/status");
      const data = await res.json();
      const bulb = document.getElementById("indicadorLuminosoSync");
      const texto = document.getElementById("txtStatusSync");
      const totalPendentes = data.total_pendentes_outbox?.total_geral || 0;

      if (totalPendentes === 0) {
        bulb.className = "w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]";
        texto.textContent = "Nuvem Sincronizada";
      } else {
        bulb.className = "w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]";
        texto.textContent = `${totalPendentes} na fila offline`;
      }
    } catch (e) {}
  }

  async executarSincronizacaoManual() {
    const btn = document.getElementById("btnSincronizarManual");
    btn.disabled = true;
    btn.textContent = "Sincronizando...";

    try {
      const res = await fetch("/api/sync/executar", { method: "POST" });
      const data = await res.json();
      btn.disabled = false;
      btn.textContent = "Sincronizar";
      alert(data.mensagem);
      this.atualizarStatusSincronizacao();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Sincronizar";
      alert(`Falha: ${e.message}`);
    }
  }

  iniciarPollingsBackground() {
    this.intervaloPollingSync = setInterval(() => {
      this.atualizarStatusSincronizacao();
      this.atualizarContadorFilaIa();
    }, 15000);
  }

  conectarEventosGerais() {
    // Busca e filtros
    document.getElementById("inputBuscaGeral")?.addEventListener("input", () => {
      clearTimeout(this.debounceBusca);
      this.debounceBusca = setTimeout(() => {
        this.paginaAtual = 0;
        this.recarregarListaAlunos();
      }, 350);
    });

    document.getElementById("filtroEscola")?.addEventListener("change", () => {
      this.paginaAtual = 0;
      this.recarregarListaAlunos();
    });

    document.getElementById("filtroStatus")?.addEventListener("change", () => {
      this.paginaAtual = 0;
      this.recarregarListaAlunos();
    });

    // Botões superiores
    document.getElementById("btnNovoAluno")?.addEventListener("click", () => this.abrirNovoAluno());
    document.getElementById("btnAbrirScanner")?.addEventListener("click", () => this.abrirModalScanner());
    document.getElementById("btnSincronizarManual")?.addEventListener("click", () => this.executarSincronizacaoManual());

    // Scanner Modal
    document.getElementById("btnFecharModalScan")?.addEventListener("click", () => {
      clearInterval(this.intervaloPollingScan);
      document.getElementById("modalScanner").classList.add("hidden");
    });
    document.getElementById("btnAcionarScannerWia")?.addEventListener("click", () => this.acionarScannerUsbPc());
    document.getElementById("btnScanFinalizarIa")?.addEventListener("click", () => this.finalizarEnvelopeScan());

    // Upload de Imagem do PC
    const btnUploadPc = document.getElementById("btnUploadArquivoPc");
    const inputArquivoPc = document.getElementById("inputArquivoPcUpload");
    btnUploadPc?.addEventListener("click", () => inputArquivoPc?.click());
    inputArquivoPc?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.uploadImagemPc(file);
        inputArquivoPc.value = "";
      }
    });

    // Botão de Retentativa do Modal de Rejeição
    document.getElementById("btnTirarOutraFotoPc")?.addEventListener("click", () => {
      this.fecharModalRejeicaoETirarOutra();
    });

    // Fechar Modal de Edição Matriz ao clicar no fundo escuro ou tecla Escape
    document.getElementById("modalEdicaoMatriz")?.addEventListener("click", (e) => {
      if (e.target.id === "modalEdicaoMatriz") {
        this.fecharModalEdicao();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const modalMatriz = document.getElementById("modalEdicaoMatriz");
        if (modalMatriz && !modalMatriz.classList.contains("hidden")) {
          this.fecharModalEdicao();
        }
      }
    });

    // Abas de navegação principal (Acervo vs Fila IA vs Painel SME)
    document.getElementById("tabAcervo")?.addEventListener("click", () => this.trocarAbaPrincipal("acervo"));
    document.getElementById("tabFilaIa")?.addEventListener("click", () => this.trocarAbaPrincipal("filaIa"));
    document.getElementById("tabPainelSme")?.addEventListener("click", () => this.trocarAbaPrincipal("sme"));
  }

  trocarAbaPrincipal(aba) {
    const secaoAcervo = document.getElementById("secaoAcervo");
    const secaoFilaIa = document.getElementById("secaoFilaIa");
    const secaoSme = document.getElementById("secaoSme");

    const tabAcervo = document.getElementById("tabAcervo");
    const tabFilaIa = document.getElementById("tabFilaIa");
    const tabPainelSme = document.getElementById("tabPainelSme");

    secaoAcervo?.classList.add("hidden");
    secaoFilaIa?.classList.add("hidden");
    secaoSme?.classList.add("hidden");

    tabAcervo.className = "tab-inativa px-4 py-2 font-bold text-xs rounded-lg transition-colors text-slate-600 hover:bg-slate-100";
    tabFilaIa.className = "tab-inativa px-4 py-2 font-bold text-xs rounded-lg transition-colors text-slate-600 hover:bg-slate-100 flex items-center gap-1.5";
    if (tabPainelSme) tabPainelSme.className = "tab-inativa px-4 py-2 font-bold text-xs rounded-lg transition-colors text-slate-600 hover:bg-slate-100";

    if (aba === "acervo") {
      secaoAcervo?.classList.remove("hidden");
      tabAcervo.className = "tab-ativa px-4 py-2 font-bold text-xs rounded-lg transition-colors bg-white shadow-sm text-blue-900 border border-slate-200";
    } else if (aba === "filaIa") {
      secaoFilaIa?.classList.remove("hidden");
      tabFilaIa.className = "tab-ativa px-4 py-2 font-bold text-xs rounded-lg transition-colors bg-white shadow-sm text-blue-900 border border-slate-200 flex items-center gap-1.5";
      this.atualizarContadorFilaIa();
    } else if (aba === "sme") {
      secaoSme?.classList.remove("hidden");
      if (tabPainelSme) tabPainelSme.className = "tab-ativa px-4 py-2 font-bold text-xs rounded-lg transition-colors bg-white shadow-sm text-blue-900 border border-slate-200";
      this.carregarPainelSme();
    }
  }

  async carregarPainelSme() {
    try {
      const res = await fetch("/api/estatisticas/painel");
      const dados = await res.json();

      document.getElementById("smeTotalAlunos").textContent = dados.total_alunos_passivo;
      document.getElementById("smeTotalHomologados").textContent = dados.total_lacrados_homologados;
      document.getElementById("smeTotalRascunhos").textContent = dados.total_rascunhos_ia;

      const gridEscolas = document.getElementById("smeGridEscolas");
      if (gridEscolas && dados.detalhes_por_escola) {
        gridEscolas.innerHTML = dados.detalhes_por_escola.map(e => `
          <div class="bg-white p-3.5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <div class="font-bold text-slate-900 text-xs">${e.nome}</div>
              <div class="text-[11px] text-slate-500 font-mono">${e.drive_particao}</div>
            </div>
            <div class="text-right">
              <span class="text-sm font-black text-blue-900">${e.total}</span>
              <span class="block text-[10px] text-slate-400">${e.lacrados} lacrados</span>
            </div>
          </div>
        `).join("");
      }
    } catch (e) {}
  }
}

// Inicializa a aplicação ao carregar o DOM
document.addEventListener("DOMContentLoaded", () => {
  window.appMain = new AppControlePrincipal();
  window.appMain.inicializar();
});
