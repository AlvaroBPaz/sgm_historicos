/**
 * SGM-Históricos — theme.js
 * Gerenciador Oficial do Modo Noturno + Biblioteca de Ícones Vetoriais SVG + Sistema de Toasts e Diálogos Acessíveis
 * Framework: UI/UX Pro Max (Zero Emojis, Zero Native Alerts)
 */

(function () {
  const CHAVE_STORAGE = 'sgm_theme';

  // ============================================================================
  // 1. BIBLIOTECA DE ÍCONES VETORIAIS SVG (LUCIDE / HEROICONS - STROKE 2)
  // ============================================================================
  const ICONS = {
    moon: `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`,
    sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
    landmark: `<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>`,
    school: `<path d="m4 6 8-4 8 4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M14 22v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4"/><path d="M18 5v17"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/>`,
    user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
    plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
    printer: `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>`,
    pencil: `<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>`,
    trash: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`,
    shieldCheck: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>`,
    shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>`,
    lock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
    unlock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
    refresh: `<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/>`,
    copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
    check: `<polyline points="20 6 9 17 4 12"/>`,
    checkCircle: `<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`,
    alertTriangle: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>`,
    alertCircle: `<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>`,
    x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
    chevronLeft: `<path d="m15 18-6-6 6-6"/>`,
    chevronRight: `<path d="m9 18 6-6-6-6"/>`,
    chevronDown: `<path d="m6 9 6 6 6-6"/>`,
    chevronsLeft: `<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>`,
    chevronsRight: `<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>`,
    zoomIn: `<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>`,
    zoomOut: `<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>`,
    rotateCw: `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`,
    rotateCcw: `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`,
    maximize: `<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`,
    sliders: `<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>`,
    eye: `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>`,
    eyeOff: `<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>`,
    database: `<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>`,
    hardDrive: `<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>`,
    cloud: `<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>`,
    cloudCheck: `<path d="M12 13h.01"/><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 15 2 2 4-4"/>`,
    sparkles: `<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>`,
    cpu: `<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>`,
    bot: `<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`,
    zap: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
    camera: `<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>`,
    fileText: `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
    arrowRight: `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
    arrowLeft: `<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`,
    folder: `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`,
    key: `<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>`
  };

  function svg(name, { size = 16, className = '', strokeWidth = 2 } = {}) {
    const pathContent = ICONS[name] || ICONS.sparkles;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${pathContent}</svg>`;
  }

  window.sgmIcons = {
    get: svg,
    names: Object.keys(ICONS)
  };

  // ============================================================================
  // 2. SISTEMA DE TOAST NOTIFICATIONS (SUBSTITUTO DE ALERTS NATIVOS)
  // ============================================================================
  class ToastManager {
    constructor() {
      this.container = null;
    }

    assegurarContainer() {
      if (!this.container || !document.body.contains(this.container)) {
        this.container = document.getElementById('sgmToastContainer');
        if (!this.container) {
          this.container = document.createElement('div');
          this.container.id = 'sgmToastContainer';
          document.body.appendChild(this.container);
        }
      }
      return this.container;
    }

    show(tipo, mensagem, titulo = '', duracaoMs = 2200) {
      const cont = this.assegurarContainer();
      const toast = document.createElement('div');
      toast.className = `sgm-toast sgm-toast-${tipo}`;

      let iconeNome = 'sparkles';
      if (tipo === 'success') iconeNome = 'checkCircle';
      if (tipo === 'error') iconeNome = 'alertCircle';
      if (tipo === 'warning') iconeNome = 'alertTriangle';
      if (tipo === 'info') iconeNome = 'sparkles';

      if (!titulo) {
        if (tipo === 'success') titulo = 'Sucesso';
        else if (tipo === 'error') titulo = 'Erro no Sistema';
        else if (tipo === 'warning') titulo = 'Atenção Operacional';
        else titulo = 'Informação';
      }

      toast.innerHTML = `
        <div class="sgm-toast-icon">
          ${svg(iconeNome, { size: 18, className: tipo === 'success' ? 'text-emerald-500' : (tipo === 'error' ? 'text-red-500' : 'text-amber-500') })}
        </div>
        <div class="sgm-toast-content">
          <div class="sgm-toast-title">${titulo}</div>
          <div class="sgm-toast-message">${mensagem}</div>
        </div>
        <button type="button" class="sgm-toast-close" title="Fechar notificação">
          ${svg('x', { size: 14 })}
        </button>
      `;

      cont.appendChild(toast);

      let timeoutRemover = setTimeout(() => fechar(), duracaoMs);

      function fechar() {
        clearTimeout(timeoutRemover);
        if (toast.classList.contains('hiding')) return;
        toast.classList.add('hiding');
        setTimeout(() => {
          if (toast.parentNode) toast.remove();
        }, 300);
      }

      toast.querySelector('.sgm-toast-close').addEventListener('click', fechar);
    }

    success(msg, titulo = 'Operação Concluída') { this.show('success', msg, titulo, 2200); }
    error(msg, titulo = 'Falha na Operação') { this.show('error', msg, titulo, 4000); }
    warning(msg, titulo = 'Atenção Operacional') { this.show('warning', msg, titulo, 3200); }
    info(msg, titulo = 'Informação') { this.show('info', msg, titulo, 2200); }
  }

  window.sgmToast = new ToastManager();

  // ============================================================================
  // 3. SISTEMA DE DIÁLOGOS E CONFIRMAÇÕES ACESSÍVEIS (ZERO CONFIRM / PROMPT NATIVOS)
  // ============================================================================
  class DialogManager {
    confirm({ title = 'Confirmação', message = 'Tem certeza que deseja prosseguir?', confirmText = 'Confirmar', cancelText = 'Cancelar', isDanger = false } = {}) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'sgm-modal-backdrop';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');

        const btnCor = isDanger
          ? 'bg-rose-600 hover:bg-rose-700 text-white'
          : 'bg-blue-700 dark:bg-[#84167A] hover:bg-blue-800 dark:hover:bg-[#9B1D90] text-white';

        backdrop.innerHTML = `
          <div class="sgm-modal-card p-5 sm:p-6 space-y-4">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-xl ${isDanger ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/50' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400'} flex items-center justify-center shrink-0">
                ${svg(isDanger ? 'alertTriangle' : 'shieldCheck', { size: 20 })}
              </div>
              <div class="flex-1">
                <h3 class="font-bold text-base text-slate-900 dark:text-slate-100">${title}</h3>
                <p class="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">${message}</p>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#454545]">
              <button type="button" id="sgmDialogCancel" class="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                ${cancelText}
              </button>
              <button type="button" id="sgmDialogConfirm" class="px-4 py-2 rounded-lg text-xs font-bold ${btnCor} shadow-sm transition">
                ${confirmText}
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(backdrop);
        const btnConfirm = backdrop.querySelector('#sgmDialogConfirm');
        const btnCancel = backdrop.querySelector('#sgmDialogCancel');

        btnConfirm.focus();

        const fecharModal = (valor) => {
          document.removeEventListener('keydown', lidarEsc);
          backdrop.remove();
          resolve(valor);
        };

        const lidarEsc = (e) => {
          if (e.key === 'Escape') fecharModal(false);
        };

        document.addEventListener('keydown', lidarEsc);
        btnConfirm.addEventListener('click', () => fecharModal(true));
        btnCancel.addEventListener('click', () => fecharModal(false));
      });
    }

    prompt({ title = 'Entrada de Dados', message = 'Informe o valor desejado:', placeholder = '', defaultValue = '', inputType = 'text', confirmText = 'Confirmar', cancelText = 'Cancelar' } = {}) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'sgm-modal-backdrop';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');

        backdrop.innerHTML = `
          <div class="sgm-modal-card p-5 sm:p-6 space-y-4">
            <div>
              <h3 class="font-bold text-base text-slate-900 dark:text-slate-100">${title}</h3>
              <p class="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">${message}</p>
            </div>

            <div>
              <input type="${inputType}" id="sgmPromptInput" value="${defaultValue}" placeholder="${placeholder}" class="w-full bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#454545] rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100">
            </div>

            <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#454545]">
              <button type="button" id="sgmPromptCancel" class="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                ${cancelText}
              </button>
              <button type="button" id="sgmPromptConfirm" class="px-4 py-2 rounded-lg text-xs font-bold bg-blue-700 dark:bg-[#84167A] hover:bg-blue-800 dark:hover:bg-[#9B1D90] text-white shadow-sm transition">
                ${confirmText}
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(backdrop);
        const input = backdrop.querySelector('#sgmPromptInput');
        const btnConfirm = backdrop.querySelector('#sgmPromptConfirm');
        const btnCancel = backdrop.querySelector('#sgmPromptCancel');

        input.focus();
        input.select();

        const fecharModal = (valor) => {
          document.removeEventListener('keydown', lidarTeclas);
          backdrop.remove();
          resolve(valor);
        };

        const lidarTeclas = (e) => {
          if (e.key === 'Escape') fecharModal(null);
          if (e.key === 'Enter') fecharModal(input.value.trim());
        };

        document.addEventListener('keydown', lidarTeclas);
        btnConfirm.addEventListener('click', () => fecharModal(input.value.trim()));
        btnCancel.addEventListener('click', () => fecharModal(null));
      });
    }

    alert({ title = 'Aviso do Sistema', message = '', confirmText = 'Entendido' } = {}) {
      return this.confirm({ title, message, confirmText, cancelText: '' }).then(() => {});
    }
  }

  window.sgmDialog = new DialogManager();

  // ============================================================================
  // 4. GERENCIADOR DO MODO NOTURNO (DARK MODE)
  // ============================================================================
  function obterTemaAtual() {
    try {
      const salvo = localStorage.getItem(CHAVE_STORAGE);
      if (salvo === 'light') return 'light';
      return 'dark'; // Padrão oficial: Modo Noturno
    } catch (e) {
      return 'dark';
    }
  }

  function aplicarTema(tema) {
    const isDark = (tema !== 'light');
    const root = document.documentElement;

    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      try { localStorage.setItem(CHAVE_STORAGE, 'dark'); } catch (e) {}
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      try { localStorage.setItem(CHAVE_STORAGE, 'light'); } catch (e) {}
    }

    atualizarComponentesInterface(isDark);

    window.dispatchEvent(new CustomEvent('sgm-theme-changed', {
      detail: { tema: isDark ? 'dark' : 'light', isDark }
    }));
  }

  function alternarTema() {
    const temaAtual = obterTemaAtual();
    const novoTema = (temaAtual === 'dark') ? 'light' : 'dark';
    aplicarTema(novoTema);
  }

  function atualizarComponentesInterface(isDark) {
    const botoes = document.querySelectorAll('#btnToggleTheme, .btn-toggle-theme');

    botoes.forEach(btn => {
      const iconEl = btn.querySelector('#themeIcon, .theme-icon');
      const textEl = btn.querySelector('#themeText, .theme-text');

      if (isDark) {
        if (iconEl) iconEl.innerHTML = svg('moon', { size: 15, className: 'text-amber-400' });
        if (textEl) textEl.textContent = 'Modo Noturno';
        btn.setAttribute('title', 'Modo Noturno ativo. Clique para alternar para Modo Claro');
        btn.setAttribute('aria-label', 'Alternar para Modo Claro');
      } else {
        if (iconEl) iconEl.innerHTML = svg('sun', { size: 15, className: 'text-amber-500' });
        if (textEl) textEl.textContent = 'Modo Claro';
        btn.setAttribute('title', 'Modo Claro ativo. Clique para alternar para Modo Noturno');
        btn.setAttribute('aria-label', 'Alternar para Modo Noturno');
      }
    });
  }

  // Execução imediata
  aplicarTema(obterTemaAtual());

  const conectarBotoes = () => {
    atualizarComponentesInterface(obterTemaAtual() === 'dark');
    document.querySelectorAll('#btnToggleTheme, .btn-toggle-theme').forEach(btn => {
      btn.onclick = alternarTema;
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', conectarBotoes);
  } else {
    conectarBotoes();
  }

  window.sgmTheme = {
    aplicarTema,
    alternarTema,
    obterTemaAtual,
    isDark: () => document.documentElement.classList.contains('dark')
  };

  // ============================================================================
  // 5. FORMATADOR UNIVERSAL DE NOTAS ESCOLARES (0,0 A 10,0)
  // ============================================================================
  window.formatarNotaHistorico = function(valor) {
    if (valor === null || valor === undefined) return "";
    let v = String(valor).trim();
    if (v === "") return "";

    // Traços de séries não cursadas / ausência de nota
    if (/^[-–—]{1,4}$/.test(v)) return "---";

    // Conceitos alfabéticos puros (ex: A, B, C, D, E, AP, APR, REP, REC, NC, S/N)
    if (!/\d/.test(v)) {
      return v.toUpperCase();
    }

    // Se já contém vírgula ou ponto (ex: "5,5", "5.5", "10,0", "0.5")
    if (v.includes(",") || v.includes(".")) {
      const num = parseFloat(v.replace(",", "."));
      if (!isNaN(num)) {
        if (num >= 10.0) return "10,0";
        if (num <= 0.0) return "0,0";
        return num.toFixed(1).replace(".", ",");
      }
      return v;
    }

    // Zero isolado ou múltiplos zeros ("0", "00") -> "0,0"
    if (/^0+$/.test(v)) {
      return "0,0";
    }

    // "10" (nota máxima dez) ou "100" (cem) -> "10,0"
    if (v === "10" || v === "100") {
      return "10,0";
    }

    // 1 dígito único de 1 a 9 ("1" a "9") -> ex: "7" vira "7,0"
    if (/^[1-9]$/.test(v)) {
      return `${v},0`;
    }

    // 2 dígitos numéricos (ex: "55" -> "5,5", "14" -> "1,4", "25" -> "2,5", "12" -> "1,2", "01" -> "0,1")
    if (/^\d{2}$/.test(v)) {
      const intPart = parseInt(v[0], 10);
      const decPart = parseInt(v[1], 10);
      const valFinal = intPart + (decPart / 10);
      if (valFinal >= 10.0) return "10,0";
      return `${intPart},${decPart}`;
    }

    // 3 ou mais dígitos numéricos (ex: "105" -> limita a 10,0)
    const numGeral = parseFloat(v) / 10;
    if (!isNaN(numGeral)) {
      if (numGeral >= 10.0) return "10,0";
      if (numGeral <= 0.0) return "0,0";
      return numGeral.toFixed(1).replace(".", ",");
    }

    return v;
  };
})();
