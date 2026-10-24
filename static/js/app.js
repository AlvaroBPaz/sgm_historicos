/**
 * SGM-Históricos — app.js
 * Controlador Principal da Interface SPA Desktop
 * Padrão UI/UX Pro Max (Data-Dense Dashboard - Densidade 8/10)
 * 
 * Módulos Integrados:
 * - Setup Wizard & Modo Camaleão (Gestão da Máquina, IP Local e Reset);
 * - Verificador de Autenticidade e Integridade HMAC-SHA256;
 * - Busca multifatorial e Tabela do Acervo Passivo com Paginação Completa;
 * - Menu de Ações por Linha: Editar, Homologar/Lacrar, Desbloquear (Senha Mestra), Imprimir A4 e Excluir;
 * - Fila de Transcrição IA (Gemini 2.5 Flash) com visualização em tempo real do pipeline;
 * - Scanner Sem Fio (QR Code + Cópia de Link + Drag & Drop de Arquivos PC + WIA);
 * - Trilha de Auditoria Imutável (Logs SQLite com detalhes colapsáveis);
 * - Painel Geral da Secretaria (SME), Multi-Drive 30 GB e Backups Fernet (.db.enc).
 */

class AppControlePrincipal {
  constructor() {
    this.config = null;
    this.escolas = [];
    this.paginaAtual = 0;
    this.limitePorPagina = 25;
    this.totalAlunos = 0;
    this.sessaoScanAtiva = null;
    this.intervaloPollingScan = null;
    this.intervaloPollingSync = null;
    this.alunoParaDesbloquear = null;

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
      
      // Inicia pollings em segundo plano (15 segundos)
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
      this.ipLocal = dados.ip_local || "127.0.0.1";
      this.porta = dados.porta || 8000;
      window.configManagerAtual = this.config;
    } catch (e) {
      console.error("Erro ao obter configuração:", e);
    }
  }

  async carregarEscolas() {
    try {
      const res = await fetch("/api/escolas");
      this.escolas = await res.json();
      this.preencherFiltrosEscolas();
    } catch (e) {
      console.error("Erro ao listar escolas:", e);
    }
  }

  aplicarPerfilInterface() {
    const nomeBadge = document.getElementById("headerNomeEscola");
    const perfilBadge = document.getElementById("headerBadgePerfil");
    const tabSme = document.getElementById("tabPainelSme");

    if (this.config.modo === "SME") {
      nomeBadge.textContent = "Secretaria Municipal de Educação (SME) — Gestão Global";
      perfilBadge.textContent = "ACESSO GLOBAL SME";
      perfilBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-mono";
      tabSme?.classList.remove("hidden");
    } else {
      nomeBadge.textContent = this.config.escola_nome || "Escola Municipal Vinculada";
      perfilBadge.textContent = "UNIDADE ESCOLAR";
      perfilBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-900 dark:bg-blue-950/70 dark:text-blue-300 font-mono";
      tabSme?.classList.add("hidden");
    }
  }

  preencherFiltrosEscolas() {
    const select = document.getElementById("filtroEscola");
    const selectAuditoria = document.getElementById("filtroAuditoriaEscola");

    const optionsHtml = `<option value="">Todas as Escolas Municipais</option>` +
      this.escolas.map(e => `
        <option value="${e.id}" ${this.config?.escola_id === e.id ? 'selected' : ''}>
          ${e.nome_oficial} ${e.extinta ? '(Extinta)' : ''}
        </option>
      `).join("");

    if (select) select.innerHTML = optionsHtml;
    if (selectAuditoria) selectAuditoria.innerHTML = optionsHtml;
  }

  toggleMostrarSenha(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  }

  // ============================================================================
  // SETUP WIZARD & GESTÃO DA MÁQUINA (MODO CAMALEÃO)
  // ============================================================================

  abrirModalSetupWizard() {
    const modal = document.getElementById("modalSetupWizard");
    if (!modal) return;
    modal.classList.remove("hidden");

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
      window.sgmToast.warning("Informe o código de ativação da unidade escolar (ex: ESC01-2026).", "Código Necessário");
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
      if (!res.ok) throw new Error(data.detail || "Erro na ativação da unidade.");

      window.sgmToast.success("Unidade Escolar ativada com sucesso!", "Modo Escola Configurado");
      document.getElementById("modalSetupWizard").classList.add("hidden");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      window.sgmToast.error(e.message, "Falha na Ativação");
    }
  }

  async ativarPerfilSme() {
    const senha = document.getElementById("wizardSenhaMestra")?.value;
    const operador = document.getElementById("wizardOperadorSme")?.value?.trim() || "Administrador SME";

    if (!senha) {
      window.sgmToast.warning("Informe a Senha Mestra da Secretaria.", "Senha Obrigatória");
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

      window.sgmToast.success("Máquina ativada como Secretaria Municipal de Educação!", "Modo SME Configurado");
      document.getElementById("modalSetupWizard").classList.add("hidden");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      window.sgmToast.error(e.message, "Falha na Ativação SME");
    }
  }

  abrirModalConfigMaquina() {
    const modal = document.getElementById("modalConfigMaquina");
    if (!modal) return;

    document.getElementById("cfgInfoIpLocal").textContent = `${this.ipLocal}:${this.porta}`;
    document.getElementById("cfgInfoPerfil").textContent = this.config.modo === "SME" ? "SECRETARIA (SME)" : "UNIDADE ESCOLAR";
    document.getElementById("cfgInfoEscola").textContent = this.config.escola_nome || "Gestão Global de Todas as Escolas";
    document.getElementById("cfgInfoDrive").textContent = this.config.drive_particao || "DRIVE_A / DRIVE_B";
    document.getElementById("cfgInfoOperador").textContent = this.config.operador_instalacao || "Operador Local";

    modal.classList.remove("hidden");
  }

  fecharModalConfigMaquina() {
    document.getElementById("modalConfigMaquina")?.classList.add("hidden");
  }

  async resetarMaquina() {
    const senha = document.getElementById("inputResetSenhaMestra")?.value;
    if (!senha) {
      window.sgmToast.warning("Informe a Senha Mestra da Secretaria para redefinir a máquina.", "Atenção");
      return;
    }

    const confirmou = await window.sgmDialog.confirm({
      title: "Confirmar Reset da Máquina",
      message: "Tem certeza que deseja redefinir este computador ao modo virgem? O assistente de ativação será reaberto.",
      confirmText: "Sim, Resetar Máquina",
      isDanger: true
    });

    if (!confirmou) return;

    try {
      const res = await fetch("/api/config/resetar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha_mestra: senha })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Senha Mestra incorreta.");

      window.sgmToast.success("Configuração da máquina redefinida com sucesso!", "Reset Concluído");
      this.fecharModalConfigMaquina();
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      window.sgmToast.error(e.message, "Erro ao Resetar");
    }
  }

  // ============================================================================
  // VERIFICADOR DE AUTENTICIDADE E INTEGRIDADE HMAC
  // ============================================================================

  abrirModalVerificadorHmac(codigoInicial = "") {
    const modal = document.getElementById("modalVerificadorHmac");
    const input = document.getElementById("inputCodigoVerificadorHmac");
    const resBox = document.getElementById("resultadoVerificadorHmac");
    if (!modal) return;

    if (input) input.value = codigoInicial || "";
    if (resBox) {
      resBox.className = "hidden p-4 rounded-xl border space-y-2 text-xs";
      resBox.innerHTML = "";
    }

    modal.classList.remove("hidden");
    if (codigoInicial) {
      this.consultarCodigoAutenticidade(codigoInicial);
    } else {
      input?.focus();
    }
  }

  fecharModalVerificadorHmac() {
    document.getElementById("modalVerificadorHmac")?.classList.add("hidden");
  }

  async consultarCodigoAutenticidade(codigoParam = null) {
    const codigo = codigoParam || document.getElementById("inputCodigoVerificadorHmac")?.value?.trim();
    if (!codigo) {
      window.sgmToast.warning("Digite o código de autenticidade (ex: VER-2026-WLTH).", "Campo Obrigatório");
      return;
    }

    const resBox = document.getElementById("resultadoVerificadorHmac");
    resBox.className = "p-4 rounded-xl border border-slate-200 dark:border-[#454545] bg-slate-50 dark:bg-[#1E1E1E] space-y-2 text-xs";
    resBox.innerHTML = `<span class="text-slate-500">Validando assinatura criptográfica HMAC-SHA256 no banco local...</span>`;
    resBox.classList.remove("hidden");

    try {
      const res = await fetch(`/api/alunos/verificar/${encodeURIComponent(codigo)}`);
      const data = await res.json();

      if (!res.ok) {
        resBox.className = "p-4 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-[#261212] space-y-2 text-xs text-red-900 dark:text-red-200";
        resBox.innerHTML = `
          <div class="flex items-center gap-2 font-bold text-sm text-red-700 dark:text-red-400">
            ${window.sgmIcons.get('alertCircle', { size: 18 })}
            <span>Código Não Localizado</span>
          </div>
          <p>${data.detail || "Este código não consta no arquivo passivo oficial deste município."}</p>
        `;
        return;
      }

      const isIntegro = data.autentico;
      const cardColor = isIntegro
        ? "border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-[#12261b] text-emerald-950 dark:text-emerald-100"
        : "border-red-300 dark:border-red-900 bg-red-50 dark:bg-[#261212] text-red-950 dark:text-red-100";

      resBox.className = `p-4 rounded-xl border ${cardColor} space-y-2 text-xs`;
      resBox.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 font-bold text-sm ${isIntegro ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}">
            ${window.sgmIcons.get(isIntegro ? 'shieldCheck' : 'alertTriangle', { size: 20 })}
            <span>${isIntegro ? 'DOCUMENTO ÍNTEGRO E AUTÊNTICO' : 'ALERTA DE VIOLAÇÃO DE INTEGRIDADE'}</span>
          </div>
          <span class="font-mono font-bold bg-white dark:bg-[#141414] px-2 py-0.5 rounded border border-slate-300 dark:border-[#454545]">${data.codigo}</span>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-[#383838]">
          <div><b>Estudante:</b> ${data.nome_aluno}</div>
          <div><b>Escola:</b> ${data.escola}</div>
          <div><b>Regime:</b> ${data.regime_ensino}</div>
          <div><b>Status da Ficha:</b> <span class="font-bold">${data.status_ficha}</span></div>
        </div>

        <p class="text-[11px] pt-1 leading-relaxed ${isIntegro ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400 font-bold'}">
          ${data.aviso_segurança}
        </p>
      `;
    } catch (e) {
      resBox.innerHTML = `<span class="text-red-600">Falha ao verificar código: ${e.message}</span>`;
    }
  }

  // ============================================================================
  // LISTAGEM DO ACERVO PASSIVO COM BUSCA MULTIFATORIAL E PAGINAÇÃO COMPLETA
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
      this.totalAlunos = data.total || 0;
      this.renderizarTabelaAlunos(data.alunos || [], this.totalAlunos);
      this.atualizarControlesPaginacao();
    } catch (e) {
      console.error("Erro ao carregar alunos:", e);
    }
  }

  atualizarControlesPaginacao() {
    const total = this.totalAlunos;
    const offset = this.paginaAtual * this.limitePorPagina;
    const fim = Math.min(offset + this.limitePorPagina, total);
    const totalPaginas = Math.ceil(total / this.limitePorPagina) || 1;

    const infoEl = document.getElementById("indicadorPaginacaoInfo");
    const pagAtualEl = document.getElementById("txtPaginaAtual");
    const btnPrimeira = document.getElementById("btnPagPrimeira");
    const btnAnterior = document.getElementById("btnPagAnterior");
    const btnProxima = document.getElementById("btnPagProxima");
    const btnUltima = document.getElementById("btnPagUltima");

    if (infoEl) {
      infoEl.textContent = total > 0 ? `Exibindo ${offset + 1}–${fim} de ${total} ex-alunos` : `Nenhum ex-aluno`;
    }
    if (pagAtualEl) {
      pagAtualEl.textContent = `${this.paginaAtual + 1} / ${totalPaginas}`;
    }

    if (btnPrimeira) btnPrimeira.disabled = (this.paginaAtual === 0);
    if (btnAnterior) btnAnterior.disabled = (this.paginaAtual === 0);
    if (btnProxima) btnProxima.disabled = (this.paginaAtual >= totalPaginas - 1);
    if (btnUltima) btnUltima.disabled = (this.paginaAtual >= totalPaginas - 1);
  }

  renderizarTabelaAlunos(alunos, total) {
    const tbody = document.getElementById("tabelaAlunosBody");
    const totalEl = document.getElementById("totalAlunosEncontrados");
    if (totalEl) totalEl.textContent = `${total} ex-aluno(s) localizado(s)`;
    if (!tbody) return;

    if (alunos.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="p-8 text-center text-slate-500 dark:text-slate-400">
            <div class="w-12 h-12 mx-auto mb-2 text-slate-400 dark:text-slate-600 flex items-center justify-center">
              ${window.sgmIcons.get('folder', { size: 32 })}
            </div>
            Nenhum ex-aluno localizado com os filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = alunos.map((a, idx) => {
      // Badge de Status
      let badgeStatus = `
        <span class="inline-flex items-center gap-1 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 px-2 py-0.5 rounded text-[11px] font-bold">
          ${window.sgmIcons.get('bot', { size: 12 })} Rascunho IA
        </span>
      `;
      let btnLacre = `
        <button type="button" title="Homologar e Lacrar Ficha" onclick="window.appMain.homologarLacrarAluno('${a.uuid}')" class="w-[112px] justify-center px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900 font-semibold border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 shrink-0">
          ${window.sgmIcons.get('lock', { size: 12 })}
          <span class="hidden sm:inline">Homologar</span>
        </button>
      `;

      if (a.status_ficha === "LACRADO_HOMOLOGADO") {
        badgeStatus = `
          <span class="inline-flex items-center gap-1 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300 px-2 py-0.5 rounded text-[11px] font-bold">
            ${window.sgmIcons.get('shieldCheck', { size: 12, className: 'text-emerald-600 dark:text-emerald-400' })} Homologado
          </span>
        `;
        btnLacre = `
          <button type="button" title="Desbloquear Ficha Homologada (Requer Senha Mestra)" onclick="window.appMain.abrirModalDesbloquear('${a.uuid}', '${a.nome_completo.replace(/'/g, "\\'")}')" class="w-[112px] justify-center px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 hover:bg-amber-100 font-semibold border border-amber-200 dark:border-amber-800 flex items-center gap-1 shrink-0">
            ${window.sgmIcons.get('unlock', { size: 12 })}
            <span class="hidden sm:inline">Desbloquear</span>
          </button>
        `;
      } else if (a.status_ficha === "DIGITADO") {
        badgeStatus = `
          <span class="inline-flex items-center gap-1 bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300 px-2 py-0.5 rounded text-[11px] font-bold">
            ${window.sgmIcons.get('pencil', { size: 12 })} Digitado
          </span>
        `;
      }

      const zebrado = (idx % 2 === 0) ? "linha-impar" : "linha-par";
      const codAut = a.codigo_autenticidade || "---";

      return `
        <tr class="${zebrado} border-b border-slate-100 dark:border-[#383838] transition-colors">
          <td class="py-2.5 px-3.5">
            <div class="font-bold text-slate-900 dark:text-slate-100 text-[13px]">${a.nome_completo}</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
              <span>Nasc: ${a.data_nascimento || 'Não informada'}</span>
              ${a.rg_numero ? `<span>• RG: ${a.rg_numero}</span>` : ''}
              ${a.cpf ? `<span>• CPF: ${a.cpf}</span>` : ''}
            </div>
          </td>
          <td class="py-2.5 px-3.5 text-xs">
            <div class="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <span>${a.escola_nome || 'Escola ' + a.escola_id}</span>
              ${a.escola_extinta ? `<span class="text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 px-1.5 py-0.2 rounded">Extinta</span>` : ''}
            </div>
            <div class="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
              <span>${codAut}</span>
              ${codAut !== '---' ? `
                <button type="button" title="Copiar código de autenticidade" onclick="window.appMain.copiarTexto('${codAut}')" class="p-0.5 hover:text-blue-600 transition">
                  ${window.sgmIcons.get('copy', { size: 11 })}
                </button>
                <button type="button" title="Verificar integridade HMAC" onclick="window.appMain.abrirModalVerificadorHmac('${codAut}')" class="p-0.5 text-emerald-600 hover:text-emerald-700 transition">
                  ${window.sgmIcons.get('shieldCheck', { size: 11 })}
                </button>
              ` : ''}
            </div>
          </td>
          <td class="py-2.5 px-3.5 text-xs">
            <span class="font-semibold">${a.regime_ensino === '8_ANOS' ? '8 Anos (1ª–8ª)' : (a.regime_ensino === '9_ANOS' ? '9 Anos (1º–9º)' : 'EJA')}</span>
          </td>
          <td class="py-2.5 px-3.5 text-xs">
            ${badgeStatus}
          </td>
          <td class="py-2.5 px-3.5 text-xs text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
              <button type="button" title="Editar Histórico" onclick="window.appMain.abrirEdicaoAluno('${a.uuid}')" class="w-[72px] justify-center px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 hover:bg-blue-100 font-semibold border border-blue-200 dark:border-blue-800 flex items-center gap-1 shrink-0">
                ${window.sgmIcons.get('pencil', { size: 12 })}
                <span class="hidden sm:inline">Editar</span>
              </button>
              ${btnLacre}
              <button type="button" title="Imprimir Histórico Oficial A4" onclick="window.appMain.abrirImpressaoA4('${a.uuid}')" class="w-[58px] justify-center px-2 py-1 rounded bg-slate-100 dark:bg-[#383838] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#454545] font-semibold border border-slate-300 dark:border-[#454545] flex items-center gap-1 shrink-0">
                ${window.sgmIcons.get('printer', { size: 12 })}
                <span class="hidden sm:inline">A4</span>
              </button>
              <button type="button" title="Excluir Registro" onclick="window.appMain.excluirAluno('${a.uuid}', '${a.nome_completo.replace(/'/g, "\\'")}')" class="w-7 h-7 flex items-center justify-center rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 border border-transparent hover:border-rose-200 shrink-0">
                ${window.sgmIcons.get('trash', { size: 13 })}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  async copiarTexto(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      window.sgmToast.success(`Código ${texto} copiado para a área de transferência!`, "Copiado");
    } catch (e) {
      window.sgmToast.info(texto, "Código");
    }
  }

  // ============================================================================
  // AÇÕES SOBRE REGISTRO (HOMOLOGAR / DESBLOQUEAR / EXCLUIR / EDITAR)
  // ============================================================================

  async abrirEdicaoAluno(alunoUuid) {
    try {
      const res = await fetch(`/api/alunos/${alunoUuid}/historico-completo`);
      if (!res.ok) throw new Error("Erro ao obter dados do aluno.");
      const dados = await res.json();

      document.getElementById("modalEdicaoMatriz").classList.remove("hidden");
      window.editorMatriz.renderizarInterfaceCompleta();
      window.editorMatriz.carregarDadosAlunoCompleto(dados.aluno, dados.vida_escolar, dados.notas_curriculares);

      if (dados.integridade && !dados.integridade.integro) {
        window.sgmToast.error(
          "Divergência na assinatura HMAC detectada! O registro pode ter sido modificado por fora do programa.",
          "Alerta de Integridade"
        );
      }
    } catch (e) {
      window.sgmToast.error(e.message, "Falha ao Abrir Histórico");
    }
  }

  abrirNovoAluno() {
    document.getElementById("modalEdicaoMatriz").classList.remove("hidden");
    window.editorMatriz.alunoAtualUuid = null;
    window.editorMatriz.carregarGradePadraoInicial();
    window.editorMatriz.renderizarInterfaceCompleta();
  }

  fecharModalEdicao() {
    document.getElementById("modalEdicaoMatriz")?.classList.add("hidden");
  }

  async homologarLacrarAluno(alunoUuid) {
    const confirmou = await window.sgmDialog.confirm({
      title: "Homologar e Lacrar Ficha Escolar",
      message: "Ao homologar, esta ficha será protegida contra edições acidentais e receberá status oficial para impressão. Deseja lacrar?",
      confirmText: "Sim, Homologar e Lacrar"
    });

    if (!confirmou) return;

    try {
      const operador = this.config?.operador_instalacao || "Secretaria Escolar";
      const res = await fetch(`/api/alunos/${alunoUuid}/homologar-lacrar?operador=${encodeURIComponent(operador)}`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao homologar ficha.");

      window.sgmToast.success("Ficha homologada e lacrada oficialmente!", "Homologado");
      this.recarregarListaAlunos();
    } catch (e) {
      window.sgmToast.error(e.message, "Falha na Homologação");
    }
  }

  abrirModalDesbloquear(alunoUuid, nomeAluno) {
    this.alunoParaDesbloquear = alunoUuid;
    document.getElementById("txtDesbloquearAlunoNome").textContent = nomeAluno;
    document.getElementById("inputDesbloquearSenha").value = "";
    document.getElementById("inputDesbloquearMotivo").value = "";
    document.getElementById("modalDesbloquearFicha")?.classList.remove("hidden");
  }

  fecharModalDesbloquear() {
    this.alunoParaDesbloquear = null;
    document.getElementById("modalDesbloquearFicha")?.classList.add("hidden");
  }

  async confirmarDesbloqueio() {
    if (!this.alunoParaDesbloquear) return;
    const senha = document.getElementById("inputDesbloquearSenha")?.value;
    const motivo = document.getElementById("inputDesbloquearMotivo")?.value?.trim();

    if (!senha) {
      window.sgmToast.warning("A Senha Mestra da Secretaria é obrigatória.", "Atenção");
      return;
    }
    if (!motivo) {
      window.sgmToast.warning("Informe a justificativa da reabertura para registro na auditoria.", "Justificativa Obrigatória");
      return;
    }

    try {
      const operador = this.config?.operador_instalacao || "Administrador SME";
      const res = await fetch(`/api/alunos/${this.alunoParaDesbloquear}/desbloquear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senha_mestra: senha,
          motivo: motivo,
          operador: operador
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Senha incorreta ou erro no desbloqueio.");

      window.sgmToast.success("Ficha desbloqueada com sucesso para edição!", "Desbloqueada");
      this.fecharModalDesbloquear();
      this.recarregarListaAlunos();
    } catch (e) {
      window.sgmToast.error(e.message, "Erro no Desbloqueio");
    }
  }

  async excluirAluno(alunoUuid, nomeAluno) {
    const confirmou = await window.sgmDialog.confirm({
      title: "Excluir Histórico de Ex-Aluno",
      message: `Tem certeza que deseja excluir o histórico de "${nomeAluno}"? Esta ação removerá os dados civis, séries e notas vinculadas.`,
      confirmText: "Sim, Excluir Definitivamente",
      isDanger: true
    });

    if (!confirmou) return;

    try {
      const operador = this.config?.operador_instalacao || "Secretaria";
      const res = await fetch(`/api/alunos/${alunoUuid}?operador=${encodeURIComponent(operador)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao excluir registro.");

      window.sgmToast.success("Registro de ex-aluno excluído com sucesso.", "Exclusão Concluída");
      this.recarregarListaAlunos();
    } catch (e) {
      window.sgmToast.error(e.message, "Falha na Exclusão");
    }
  }

  // ============================================================================
  // IMPRESSÃO A4 EMBUTIDA
  // ============================================================================

  abrirImpressaoA4(alunoUuid) {
    const modal = document.getElementById("modalImpressaoEmbutida");
    const iframe = document.getElementById("iframeImpressaoA4");
    if (!modal || !iframe) {
      window.open(`/impressao/${alunoUuid}`, "_blank");
      return;
    }

    iframe.src = `/impressao/${alunoUuid}`;
    modal.classList.remove("hidden");
  }

  fecharImpressaoEmbutida() {
    const modal = document.getElementById("modalImpressaoEmbutida");
    const iframe = document.getElementById("iframeImpressaoA4");
    if (modal) modal.classList.add("hidden");
    if (iframe) iframe.src = "about:blank";
  }

  imprimirDocumentoEmbutido() {
    const iframe = document.getElementById("iframeImpressaoA4");
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.error("Erro ao disparar impressão:", e);
      }
    }
  }

  // ============================================================================
  // SCANNER SEM FIO (QR CODE + UPLOAD PC + SCANNER WIA)
  // ============================================================================

  async abrirModalScanner() {
    const modal = document.getElementById("modalScanner");
    if (!modal) return;
    modal.classList.remove("hidden");

    try {
      const temaAtual = localStorage.getItem("sgm_theme") || (document.documentElement.classList.contains("dark") ? "dark" : "light");
      const res = await fetch("/api/scan/iniciar-sessao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escola_id: this.config?.escola_id || 1,
          origem_captura: "MOBILE_QR",
          tema: temaAtual
        })
      });

      const data = await res.json();
      this.sessaoScanAtiva = data.sessao_id;

      document.getElementById("imgQrCodeScanner").src = data.qr_code_base64;
      const linkEl = document.getElementById("linkMobileUrl");
      linkEl.textContent = data.mobile_url;
      linkEl.href = data.mobile_url;
      document.getElementById("scanSessaoIdBadge").textContent = `Sessão: ${data.sessao_id.substring(0, 8)}...`;

      this.iniciarMonitoramentoSessaoScan(data.sessao_id);
    } catch (e) {
      window.sgmToast.error(e.message, "Erro na Sessão de Scan");
    }
  }

  exibirModalRejeicao(motivo) {
    const modal = document.getElementById("modalRejeicaoFotoPc");
    const txt = document.getElementById("txtMotivoRejeicaoPc");
    if (txt) txt.textContent = motivo;
    if (modal) modal.classList.remove("hidden");
  }

  fecharModalRejeicaoETirarOutra() {
    document.getElementById("modalRejeicaoFotoPc")?.classList.add("hidden");
    this.abrirModalScanner();
  }

  fecharModalRejeicaoEForcarAceite() {
    document.getElementById("modalRejeicaoFotoPc")?.classList.add("hidden");
    if (this.ultimoArquivoScanPc) {
      this.uploadImagemPc(this.ultimoArquivoScanPc, true);
    }
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

          if (dados.status === "REJEITADO_INVALIDO") {
            clearInterval(this.intervaloPollingScan);
            document.getElementById("modalScanner").classList.add("hidden");
            this.exibirModalRejeicao(dados.ultimo_erro || "Documento rejeitado pela IA por não ser um Histórico Escolar válido ou estar ilegível.");
            return;
          }

          if (dados.paginas && dados.paginas.length > 0) {
            containerThumbs.innerHTML = dados.paginas.map((p, idx) => `
              <div class="relative bg-slate-100 rounded border border-slate-300 aspect-[3/4] overflow-hidden shadow-2xs">
                <img src="/api/scan/imagem-preview?caminho=${encodeURIComponent(p)}" class="w-full h-full object-cover">
                <span class="absolute bottom-1 left-1 bg-black/80 text-white text-[10px] px-1.5 py-0.2 rounded font-bold font-mono">Pág ${idx + 1}</span>
              </div>
            `).join("");
            document.getElementById("btnScanFinalizarIa").disabled = false;
          }
        }
      } catch (e) {}
    }, 2000);
  }

  async uploadImagemPc(file, forcar = false) {
    if (!this.sessaoScanAtiva || !file) return;
    this.ultimoArquivoScanPc = file;

    const btn = document.getElementById("btnUploadArquivoPc");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>Processando...</span>`;
    }

    const formData = new FormData();
    formData.append("arquivo", file);
    if (forcar) formData.append("forcar_aceite", "true");

    try {
      const res = await fetch(`/api/scan/${this.sessaoScanAtiva}/upload-pagina`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Foto / PDF do PC</span>`;
      }

      if (!res.ok || !data.sucesso) {
        const motivo = data.detail || data.mensagem || "Foto rejeitada pelo Porteiro de Qualidade.";
        this.exibirModalRejeicao(motivo);
      } else {
        window.sgmToast.success(`Página ${data.pagina_numero} aprovada pelo Porteiro OpenCV! (${data.tamanho_kb} KB)`, "Página Aprovada");
      }
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Foto / PDF do PC</span>`;
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
        window.sgmToast.success("Página digitalizada via WIA com sucesso!", "Scanner Concluído");
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
      window.sgmToast.success("Envelope enviado para transcrição pela IA! Acompanhe na aba 'Fila de Revisão IA'.", "Fila IA");
      this.atualizarContadorFilaIa();
    } catch (e) {
      window.sgmToast.error(e.message, "Erro ao Finalizar");
    }
  }

  // ============================================================================
  // FILA DE REVISÃO IA E PIPELINE VISÍVEL
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
          ? "font-mono bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full text-xs font-black animate-pulse"
          : "font-mono bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-xs font-bold";
      }

      // Atualiza os 4 contadores do resumo
      const pendentesCount = (data.pendentes_ia?.length || 0) + (data.processando_ia?.length || 0);
      const elProcessando = document.getElementById("countOcrProcessando");
      if (elProcessando) elProcessando.textContent = pendentesCount;

      const iconProcessando = document.getElementById("iconOcrProcessando");
      if (iconProcessando) {
        if (pendentesCount > 0) {
          iconProcessando.classList.add("animate-spin");
        } else {
          iconProcessando.classList.remove("animate-spin");
        }
      }

      const elProntos = document.getElementById("countOcrProntos");
      if (elProntos) elProntos.textContent = data.total_para_revisar || 0;
      const elErros = document.getElementById("countOcrErrosApi");
      if (elErros) elErros.textContent = data.total_erros_api || 0;
      const elRejeitados = document.getElementById("countOcrRejeitados");
      if (elRejeitados) elRejeitados.textContent = data.total_rejeitados || 0;

      this.renderizarCardsFilaIa(
        data.aguardando_revisao || [],
        data.rejeitados || [],
        data.erros_api || [],
        data.processando_ia || [],
        data.pendentes_ia || []
      );
    } catch (e) {}
  }

  renderizarCardsFilaIa(lista, rejeitados = [], errosApi = [], processando = [], pendentes = []) {
    const box = document.getElementById("containerCardsFilaIa");
    if (!box) return;

    if (lista.length === 0 && rejeitados.length === 0 && errosApi.length === 0 && processando.length === 0 && pendentes.length === 0) {
      box.innerHTML = `
        <div class="col-span-3 text-center py-12 text-slate-500">
          <div class="w-12 h-12 mx-auto mb-2 text-slate-400 flex items-center justify-center">
            ${window.sgmIcons.get('sparkles', { size: 32 })}
          </div>
          Nenhum histórico aguardando revisão humana no momento. Todos os envelopes foram processados!
        </div>
      `;
      return;
    }

    let html = "";

    // 1. Cards de Envelopes Processando / Aguardando Fila do Gemini
    processando.concat(pendentes).forEach(p => {
      const pags = JSON.parse(p.paginas_locais_json || "[]");
      html += `
        <div class="bg-blue-50/60 dark:bg-[#1b253b] rounded-xl border border-blue-300 dark:border-blue-800 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                ${window.sgmIcons.get('refresh', { size: 10, className: 'animate-spin' })}
                ${p.status === 'PROCESSANDO_IA' ? 'TRANSCREVENDO NO GEMINI' : 'NA FILA DE PROCESSAMENTO'}
              </span>
              <span class="text-xs text-blue-700 dark:text-blue-300 font-mono font-bold">${p.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-slate-900 dark:text-slate-100 text-sm mb-1 flex items-center gap-1.5">
              ${window.sgmIcons.get('bot', { size: 14, className: 'text-blue-500' })}
              <span>Envelope em Processamento</span>
            </h4>
            <p class="text-xs text-slate-500 dark:text-slate-400">${pags.length} folha(s) sendo lida(s) pela Inteligência Artificial...</p>
          </div>
          <div class="mt-4 flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
            <div class="w-2 h-2 rounded-full bg-blue-500 animate-ping"></div>
            <span>Aguarde a conclusão para abrir na Tela Dividida</span>
          </div>
        </div>
      `;
    });

    // 2. Cards de Erro na API do Gemini
    errosApi.forEach(e => {
      html += `
        <div class="bg-amber-50 dark:bg-[#2e1d0f] rounded-xl border-2 border-amber-500 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-amber-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wide">FALHA NA API GEMINI</span>
              <span class="text-xs text-amber-700 dark:text-amber-400 font-mono font-bold">${e.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-amber-950 dark:text-amber-200 text-sm mb-1.5 flex items-center gap-1.5">
              ${window.sgmIcons.get('alertTriangle', { size: 15, className: 'text-amber-600' })}
              <span>Erro ao Transcrever Documento</span>
            </h4>
            <p class="text-xs text-amber-950 dark:text-amber-200 bg-white dark:bg-[#141414] p-2.5 rounded border border-amber-300 dark:border-amber-800 leading-relaxed font-mono break-all max-h-24 overflow-y-auto">
              ${e.ultimo_erro || "Erro inesperado na chamada da API do Gemini."}
            </p>
          </div>

          <div class="mt-4 flex gap-2">
            <button type="button" onclick="window.appMain.tentarNovamenteOcr('${e.sessao_id}')" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition">
              ${window.sgmIcons.get('refresh', { size: 13 })}
              <span>Tentar Novamente</span>
            </button>
            <button type="button" onclick="window.appMain.descartarSessaoRejeitada('${e.sessao_id}')" class="bg-slate-200 dark:bg-[#383838] hover:bg-slate-300 text-slate-700 dark:text-slate-300 font-bold text-xs px-3 py-2 rounded-lg flex items-center justify-center transition" title="Descartar envelope">
              ${window.sgmIcons.get('trash', { size: 13 })}
            </button>
          </div>
        </div>
      `;
    });

    // 3. Cards de Documentos Rejeitados
    rejeitados.forEach(r => {
      html += `
        <div class="bg-rose-50 dark:bg-[#251010] rounded-xl border-2 border-rose-500 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-rose-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wide">FOTO RECUSADA PELA IA</span>
              <span class="text-xs text-rose-500 font-mono">${r.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-rose-950 dark:text-rose-200 text-sm mb-1.5 flex items-center gap-1.5">
              ${window.sgmIcons.get('alertCircle', { size: 15, className: 'text-rose-600' })}
              <span>Documento Inválido ou Ilegível</span>
            </h4>
            <p class="text-xs text-rose-800 dark:text-rose-200 bg-white dark:bg-[#141414] p-2.5 rounded border border-rose-200 dark:border-rose-900 leading-relaxed font-medium">
              ${r.ultimo_erro || "A imagem enviada não é um Histórico Escolar ou está ilegível."}
            </p>
          </div>

          <div class="mt-4 flex gap-2">
            <button type="button" onclick="window.appMain.descartarSessaoRejeitada('${r.sessao_id}')" class="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1 transition">
              ${window.sgmIcons.get('trash', { size: 13 })}
              <span>Descartar Envelope</span>
            </button>
          </div>
        </div>
      `;
    });

    // 4. Cards de Documentos Válidos Aguardando Revisão
    lista.forEach(s => {
      let dados = {};
      try { dados = JSON.parse(s.json_extraido_ia || "{}"); } catch (e) {}
      const nome = dados.dados_civis?.nome_completo?.valor || "Aluno Não Identificado";
      const pags = JSON.parse(s.paginas_locais_json || "[]");

      html += `
        <div class="bg-white dark:bg-[#2D2D2D] rounded-xl border border-amber-300 dark:border-amber-700/60 p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-black px-2 py-0.5 rounded">PRONTO PARA CONFERÊNCIA</span>
              <span class="text-xs text-slate-400 font-mono">${s.sessao_id.substring(0, 8)}...</span>
            </div>
            <h4 class="font-bold text-slate-900 dark:text-slate-100 text-sm mb-1">${nome}</h4>
            <p class="text-xs text-slate-500 dark:text-slate-400">${pags.length} folha(s) escaneada(s)</p>
          </div>

          <button type="button" onclick="window.splitReview.abrirSessaoParaRevisao('${s.sessao_id}')" class="mt-4 w-full bg-blue-700 hover:bg-blue-800 dark:bg-[#84167A] dark:hover:bg-[#9B1D90] text-white font-bold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition shadow-sm">
            ${window.sgmIcons.get('search', { size: 13 })}
            <span>Abrir Tela Dividida de Conferência</span>
          </button>
        </div>
      `;
    });

    box.innerHTML = html;
  }

  async tentarNovamenteOcr(sessaoId) {
    try {
      const res = await fetch(`/api/ocr/sessao/${sessaoId}/tentar-novamente`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao reenviar envelope.");
      window.sgmToast.success("Sessão reinserida na fila do Gemini 2.5 Flash!", "Reenviado");
      this.atualizarContadorFilaIa();
    } catch (e) {
      window.sgmToast.error(e.message, "Falha");
    }
  }

  async descartarSessaoRejeitada(sessaoId) {
    const confirmou = await window.sgmDialog.confirm({
      title: "Descartar Envelope",
      message: "Tem certeza que deseja remover este envelope da fila? As imagens temporárias serão excluídas.",
      confirmText: "Sim, Descartar",
      isDanger: true
    });

    if (!confirmou) return;

    try {
      await fetch(`/api/ocr/sessao/${sessaoId}`, { method: "DELETE" });
      window.sgmToast.info("Envelope descartado.", "Fila IA");
      this.atualizarContadorFilaIa();
    } catch (e) {
      window.sgmToast.error(e.message, "Erro");
    }
  }

  // ============================================================================
  // SINCRONIZAÇÃO HÍBRIDA & STATUS OUTBOX
  // ============================================================================

  async atualizarStatusSincronizacao() {
    try {
      const res = await fetch("/api/sync/status");
      const data = await res.json();
      const bulb = document.getElementById("indicadorLuminosoSync");
      const texto = document.getElementById("txtStatusSync");
      const totalPendentes = data.total_pendentes_outbox?.total_geral || 0;

      if (totalPendentes === 0) {
        if (bulb) bulb.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(46,204,113,0.9)]";
        if (texto) texto.textContent = "Nuvem Sincronizada";
      } else {
        if (bulb) bulb.className = "w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.9)] animate-ping";
        if (texto) texto.textContent = `${totalPendentes} na fila offline`;
      }
    } catch (e) {}
  }

  async executarSincronizacaoManual() {
    const btn = document.getElementById("btnSincronizarManual");
    const spinner = document.getElementById("iconSyncSpinner");
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.add("animate-spin");

    try {
      const res = await fetch("/api/sync/executar", { method: "POST" });
      const data = await res.json();
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.remove("animate-spin");
      window.sgmToast.success(data.mensagem || "Sincronização concluída com o Supabase!", "Sincronização");
      this.atualizarStatusSincronizacao();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.remove("animate-spin");
      window.sgmToast.error(e.message, "Falha na Sincronização");
    }
  }

  // ============================================================================
  // PAINEL GERAL DA SECRETARIA (SME) & ESCOLAS EXTINTAS
  // ============================================================================

  async carregarPainelSme() {
    try {
      const res = await fetch("/api/estatisticas/painel");
      const dados = await res.json();

      document.getElementById("smeTotalAlunos").textContent = dados.total_alunos_passivo;
      document.getElementById("smeTotalHomologados").textContent = dados.total_lacrados_homologados;
      document.getElementById("smeTotalDigitados").textContent = dados.total_digitados;
      document.getElementById("smeTotalRascunhos").textContent = dados.total_rascunhos_ia;

      const pct = dados.total_alunos_passivo > 0
        ? Math.round((dados.total_lacrados_homologados / dados.total_alunos_passivo) * 100)
        : 0;
      document.getElementById("smeTaxaHomologados").textContent = `${pct}% do acervo lacrado`;

      const gridEscolas = document.getElementById("smeGridEscolas");
      if (gridEscolas && dados.detalhes_por_escola) {
        gridEscolas.innerHTML = dados.detalhes_por_escola.map(e => {
          const taxa = e.total > 0 ? Math.round((e.lacrados / e.total) * 100) : 0;
          return `
            <div class="bg-white dark:bg-[#1E1E1E] p-3.5 rounded-xl border border-slate-200 dark:border-[#454545] shadow-2xs flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${e.drive_particao === 'DRIVE_A' ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300' : 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300'}">${e.drive_particao}</span>
                  <span class="text-[11px] font-bold text-slate-500 font-mono">${taxa}%</span>
                </div>
                <div class="font-bold text-slate-900 dark:text-slate-100 text-xs">${e.nome}</div>
              </div>
              <div class="mt-3">
                <div class="w-full bg-slate-100 dark:bg-[#141414] rounded-full h-1.5 overflow-hidden mb-1.5">
                  <div class="bg-emerald-500 h-1.5 rounded-full" style="width: ${taxa}%"></div>
                </div>
                <div class="flex justify-between text-[11px] font-mono">
                  <span class="text-slate-500">${e.total} no acervo</span>
                  <span class="text-emerald-600 dark:text-emerald-400 font-bold">${e.lacrados} lacrados</span>
                </div>
              </div>
            </div>
          `;
        }).join("");
      }
    } catch (e) {}
  }

  async gerarBackupCriptografado() {
    window.sgmToast.info("Iniciando geração de backup criptografado com Fernet...", "Backup em Andamento");
    try {
      const res = await fetch("/api/backup/gerar", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao gerar cópia de segurança.");
      window.sgmToast.success(data.mensagem || "Backup .db.enc gerado e enviado com sucesso!", "Backup Concluído");
    } catch (e) {
      window.sgmToast.error(e.message, "Falha no Backup");
    }
  }

  abrirModalCadastrarEscolaExtinta() {
    document.getElementById("modalCadastrarEscolaExtinta")?.classList.remove("hidden");
  }

  fecharModalCadastrarEscolaExtinta() {
    document.getElementById("modalCadastrarEscolaExtinta")?.classList.add("hidden");
  }

  async salvarEscolaExtinta() {
    const nome = document.getElementById("cadExtintaNome")?.value?.trim();
    const inep = document.getElementById("cadExtintaInep")?.value?.trim();
    const local = document.getElementById("cadExtintaLocal")?.value?.trim();
    const ato = document.getElementById("cadExtintaAto")?.value?.trim();

    if (!nome) {
      window.sgmToast.warning("O nome oficial da escola extinta é obrigatório.", "Atenção");
      return;
    }

    try {
      const res = await fetch("/api/escolas/extintas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_oficial: nome,
          codigo_inep: inep,
          observacao_acervo_extinta: local,
          ato_criacao: ato
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erro ao cadastrar escola extinta.");

      window.sgmToast.success(`Escola extinta "${nome}" cadastrada com sucesso no acervo recolhido da SME!`, "Escola Cadastrada");
      this.fecharModalCadastrarEscolaExtinta();
      await this.carregarEscolas();
      this.carregarPainelSme();
    } catch (e) {
      window.sgmToast.error(e.message, "Falha no Cadastro");
    }
  }

  // ============================================================================
  // TRILHA DE AUDITORIA IMUTÁVEL (MÓDULO 8)
  // ============================================================================

  async carregarTrilhaAuditoria() {
    const escolaId = document.getElementById("filtroAuditoriaEscola")?.value;
    let url = "/api/auditoria?limite=100";
    if (escolaId) url += `&escola_id=${escolaId}`;

    const tbody = document.getElementById("tabelaAuditoriaBody");
    if (!tbody) return;

    try {
      const res = await fetch(url);
      const logs = await res.json();

      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-500">Nenhum log de auditoria encontrado.</td></tr>`;
        return;
      }

      tbody.innerHTML = logs.map(l => {
        let badgeAcao = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#383838]">${l.acao}</span>`;
        if (l.acao.includes("HOMOLOGAR")) badgeAcao = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">HOMOLOGAÇÃO</span>`;
        else if (l.acao.includes("DESBLOQUEAR")) badgeAcao = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">DESBLOQUEIO</span>`;
        else if (l.acao.includes("EXCLUIR")) badgeAcao = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300">EXCLUSÃO</span>`;
        else if (l.acao.includes("ATIVAR")) badgeAcao = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300">ATIVAÇÃO</span>`;

        let detalhesFormatados = l.detalhes_json || "{}";
        try {
          detalhesFormatados = JSON.stringify(JSON.parse(l.detalhes_json), null, 2);
        } catch (e) {}

        const operador = l.detalhes_json && l.detalhes_json.includes('"operador"')
          ? JSON.parse(l.detalhes_json).operador || "Sistema"
          : "Operador";

        return `
          <tr class="hover:bg-slate-50 dark:hover:bg-[#252525]">
            <td class="py-2 px-3 text-[11px] whitespace-nowrap text-slate-600 dark:text-slate-400">${l.criado_em}</td>
            <td class="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">${operador}</td>
            <td class="py-2 px-3">${badgeAcao}</td>
            <td class="py-2 px-3 text-[11px] text-slate-500">${l.aluno_uuid ? l.aluno_uuid.substring(0, 8) + '...' : (l.escola_id ? 'Escola ' + l.escola_id : 'Global')}</td>
            <td class="py-2 px-3 text-[11px]">
              <details class="cursor-pointer">
                <summary class="text-blue-600 dark:text-blue-400 hover:underline">Ver Detalhes</summary>
                <pre class="bg-slate-100 dark:bg-[#141414] p-2 rounded mt-1 text-[10px] overflow-x-auto max-w-md">${detalhesFormatados}</pre>
              </details>
            </td>
          </tr>
        `;
      }).join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Erro ao carregar auditoria: ${e.message}</td></tr>`;
    }
  }

  // ============================================================================
  // CONEXÃO DE EVENTOS GERAIS
  // ============================================================================

  conectarEventosGerais() {
    // Busca em tempo real com debounce
    const inputBusca = document.getElementById("inputBuscaGeral");
    const btnLimparBusca = document.getElementById("btnLimparBusca");

    inputBusca?.addEventListener("input", () => {
      if (btnLimparBusca) {
        btnLimparBusca.classList.toggle("hidden", !inputBusca.value);
      }
      clearTimeout(this.debounceBusca);
      this.debounceBusca = setTimeout(() => {
        this.paginaAtual = 0;
        this.recarregarListaAlunos();
      }, 250);
    });

    btnLimparBusca?.addEventListener("click", () => {
      inputBusca.value = "";
      btnLimparBusca.classList.add("hidden");
      this.paginaAtual = 0;
      this.recarregarListaAlunos();
      inputBusca.focus();
    });

    // Filtros
    document.getElementById("filtroEscola")?.addEventListener("change", () => {
      this.paginaAtual = 0;
      this.recarregarListaAlunos();
    });

    document.getElementById("filtroStatus")?.addEventListener("change", () => {
      this.paginaAtual = 0;
      this.recarregarListaAlunos();
    });

    // Paginação
    document.getElementById("seletorLimitePorPagina")?.addEventListener("change", (e) => {
      this.limitePorPagina = parseInt(e.target.value, 10);
      this.paginaAtual = 0;
      this.recarregarListaAlunos();
    });

    document.getElementById("btnPagPrimeira")?.addEventListener("click", () => {
      if (this.paginaAtual > 0) {
        this.paginaAtual = 0;
        this.recarregarListaAlunos();
      }
    });

    document.getElementById("btnPagAnterior")?.addEventListener("click", () => {
      if (this.paginaAtual > 0) {
        this.paginaAtual--;
        this.recarregarListaAlunos();
      }
    });

    document.getElementById("btnPagProxima")?.addEventListener("click", () => {
      const totalPaginas = Math.ceil(this.totalAlunos / this.limitePorPagina);
      if (this.paginaAtual < totalPaginas - 1) {
        this.paginaAtual++;
        this.recarregarListaAlunos();
      }
    });

    document.getElementById("btnPagUltima")?.addEventListener("click", () => {
      const totalPaginas = Math.ceil(this.totalAlunos / this.limitePorPagina);
      if (this.paginaAtual < totalPaginas - 1) {
        this.paginaAtual = totalPaginas - 1;
        this.recarregarListaAlunos();
      }
    });

    // Botões superiores
    document.getElementById("btnNovoAluno")?.addEventListener("click", () => this.abrirNovoAluno());
    document.getElementById("btnAbrirScanner")?.addEventListener("click", () => this.abrirModalScanner());
    document.getElementById("btnSincronizarManual")?.addEventListener("click", () => this.executarSincronizacaoManual());
    document.getElementById("btnAbrirVerificadorHmac")?.addEventListener("click", () => this.abrirModalVerificadorHmac());
    document.getElementById("btnAbrirConfigMaquina")?.addEventListener("click", () => this.abrirModalConfigMaquina());

    // Modal Configuração da Máquina
    document.getElementById("btnFecharConfigMaquina")?.addEventListener("click", () => this.fecharModalConfigMaquina());
    document.getElementById("btnExecutarResetMaquina")?.addEventListener("click", () => this.resetarMaquina());

    // Modal Verificador HMAC
    document.getElementById("btnFecharVerificadorHmac")?.addEventListener("click", () => this.fecharModalVerificadorHmac());
    document.getElementById("btnConsultarCodigoHmac")?.addEventListener("click", () => this.consultarCodigoAutenticidade());
    document.getElementById("inputCodigoVerificadorHmac")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.consultarCodigoAutenticidade();
    });

    // Modal Desbloquear Ficha
    document.getElementById("btnCancelarDesbloqueio")?.addEventListener("click", () => this.fecharModalDesbloquear());
    document.getElementById("btnConfirmarDesbloqueio")?.addEventListener("click", () => this.confirmarDesbloqueio());

    // Modal Cadastrar Escola Extinta
    document.getElementById("btnAbrirCadastroEscolaExtinta")?.addEventListener("click", () => this.abrirModalCadastrarEscolaExtinta());
    document.getElementById("btnFecharCadEscolaExtinta")?.addEventListener("click", () => this.fecharModalCadastrarEscolaExtinta());
    document.getElementById("btnCancelarCadEscolaExtinta")?.addEventListener("click", () => this.fecharModalCadastrarEscolaExtinta());
    document.getElementById("btnSalvarEscolaExtinta")?.addEventListener("click", () => this.salvarEscolaExtinta());
    document.getElementById("btnGerarBackupCriptografado")?.addEventListener("click", () => this.gerarBackupCriptografado());

    // Scanner Modal
    document.getElementById("btnFecharModalScan")?.addEventListener("click", () => {
      clearInterval(this.intervaloPollingScan);
      document.getElementById("modalScanner").classList.add("hidden");
    });
    document.getElementById("btnAcionarScannerWia")?.addEventListener("click", () => this.acionarScannerUsbPc());
    document.getElementById("btnScanFinalizarIa")?.addEventListener("click", () => this.finalizarEnvelopeScan());
    document.getElementById("btnCopiarLinkScan")?.addEventListener("click", () => {
      const link = document.getElementById("linkMobileUrl")?.href;
      if (link) this.copiarTexto(link);
    });

    // Upload de Imagem do PC e Drag & Drop
    const btnUploadPc = document.getElementById("btnUploadArquivoPc");
    const inputArquivoPc = document.getElementById("inputArquivoPcUpload");
    const dropZone = document.getElementById("dropZoneScanPc");

    btnUploadPc?.addEventListener("click", () => inputArquivoPc?.click());
    dropZone?.addEventListener("click", () => inputArquivoPc?.click());

    inputArquivoPc?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.uploadImagemPc(file);
        inputArquivoPc.value = "";
      }
    });

    if (dropZone) {
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("border-blue-500", "bg-blue-50/50");
      });
      dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("border-blue-500", "bg-blue-50/50");
      });
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("border-blue-500", "bg-blue-50/50");
        const file = e.dataTransfer.files?.[0];
        if (file) this.uploadImagemPc(file);
      });
    }

    // Modal de Rejeição de Foto
    document.getElementById("btnTirarOutraFotoPc")?.addEventListener("click", () => this.fecharModalRejeicaoETirarOutra());
    document.getElementById("btnForcarAceiteFotoPc")?.addEventListener("click", () => this.fecharModalRejeicaoEForcarAceite());

    // Modal de Impressão Embutida
    document.getElementById("btnFecharImpressaoModal")?.addEventListener("click", () => this.fecharImpressaoEmbutida());
    document.getElementById("btnImprimirIframe")?.addEventListener("click", () => this.imprimirDocumentoEmbutido());

    // Alternância de Tela Cheia (Fullscreen)
    const alternarTelaCheia = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    };
    document.getElementById("btnToggleFullscreen")?.addEventListener("click", alternarTelaCheia);

    // Teclas de atalho (Escape e F11)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.fecharModalEdicao();
        this.fecharImpressaoEmbutida();
        this.fecharModalConfigMaquina();
        this.fecharModalVerificadorHmac();
        this.fecharModalDesbloquear();
        this.fecharModalCadastrarEscolaExtinta();
      } else if (e.key === "F11") {
        e.preventDefault();
        alternarTelaCheia();
      }
    });

    // Abas de navegação principal
    document.getElementById("tabAcervo")?.addEventListener("click", () => this.trocarAbaPrincipal("acervo"));
    document.getElementById("tabFilaIa")?.addEventListener("click", () => this.trocarAbaPrincipal("filaIa"));
    document.getElementById("tabPainelSme")?.addEventListener("click", () => this.trocarAbaPrincipal("sme"));
    document.getElementById("tabAuditoria")?.addEventListener("click", () => this.trocarAbaPrincipal("auditoria"));
    document.getElementById("btnRecarregarAuditoria")?.addEventListener("click", () => this.carregarTrilhaAuditoria());
    document.getElementById("filtroAuditoriaEscola")?.addEventListener("change", () => this.carregarTrilhaAuditoria());
  }

  trocarAbaPrincipal(aba) {
    const secaoAcervo = document.getElementById("secaoAcervo");
    const secaoFilaIa = document.getElementById("secaoFilaIa");
    const secaoSme = document.getElementById("secaoSme");
    const secaoAuditoria = document.getElementById("secaoAuditoria");

    const tabAcervo = document.getElementById("tabAcervo");
    const tabFilaIa = document.getElementById("tabFilaIa");
    const tabPainelSme = document.getElementById("tabPainelSme");
    const tabAuditoria = document.getElementById("tabAuditoria");

    secaoAcervo?.classList.add("hidden");
    secaoFilaIa?.classList.add("hidden");
    secaoSme?.classList.add("hidden");
    secaoAuditoria?.classList.add("hidden");

    const classeInativa = "tab-inativa px-3 py-1.5 font-bold text-xs rounded-lg transition-colors text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#262626] flex items-center gap-1.5";
    const classeAtiva = "tab-ativa px-3 py-1.5 font-bold text-xs rounded-lg transition-colors bg-white dark:bg-[#2D2D2D] shadow-2xs text-blue-900 dark:text-[#3B9EFF] border border-slate-300 dark:border-[#454545] flex items-center gap-1.5";

    tabAcervo.className = classeInativa;
    tabFilaIa.className = classeInativa;
    if (tabPainelSme) tabPainelSme.className = classeInativa;
    if (tabAuditoria) tabAuditoria.className = classeInativa;

    if (aba === "acervo") {
      secaoAcervo?.classList.remove("hidden");
      tabAcervo.className = classeAtiva;
    } else if (aba === "filaIa") {
      secaoFilaIa?.classList.remove("hidden");
      tabFilaIa.className = classeAtiva;
      this.atualizarContadorFilaIa();
    } else if (aba === "sme") {
      secaoSme?.classList.remove("hidden");
      if (tabPainelSme) tabPainelSme.className = classeAtiva;
      this.carregarPainelSme();
    } else if (aba === "auditoria") {
      secaoAuditoria?.classList.remove("hidden");
      if (tabAuditoria) tabAuditoria.className = classeAtiva;
      this.carregarTrilhaAuditoria();
    }
  }

  iniciarPollingsBackground() {
    this.intervaloPollingSync = setInterval(() => {
      this.atualizarStatusSincronizacao();
      this.atualizarContadorFilaIa();
    }, 15000);
  }
}

// Inicializa a aplicação ao carregar o DOM
document.addEventListener("DOMContentLoaded", () => {
  window.appMain = new AppControlePrincipal();
  window.appMain.inicializar();
});
