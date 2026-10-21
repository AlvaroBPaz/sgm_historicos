/**
 * SGM-Históricos — theme.js
 * Gerenciador Oficial do Modo Noturno (Dark Mode) Desktop
 * 
 * Funcionalidades:
 * - Persistência no localStorage ('sgm_theme');
 * - Inicialização no Modo Noturno por padrão (caso não exista preferência salva);
 * - Alternância instantânea via botão no topo da tela com ícone Lua/Sol;
 * - Suporte a múltiplos botões de alternância e sincronização de abas.
 */

(function () {
  const CHAVE_STORAGE = 'sgm_theme';

  /**
   * Obtém o tema ativo configurado.
   * Se nenhuma chave estiver salva, retorna 'dark' por padrão.
   */
  function obterTemaAtual() {
    try {
      const salvo = localStorage.getItem(CHAVE_STORAGE);
      if (salvo === 'light') return 'light';
      return 'dark'; // Padrão é Modo Noturno
    } catch (e) {
      return 'dark';
    }
  }

  /**
   * Aplica o tema na tag <html> e atualiza os botões da interface.
   * @param {'dark'|'light'} tema 
   */
  function aplicarTema(tema) {
    const isDark = (tema !== 'light');
    const root = document.documentElement;

    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      try {
        localStorage.setItem(CHAVE_STORAGE, 'dark');
      } catch (e) {}
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      try {
        localStorage.setItem(CHAVE_STORAGE, 'light');
      } catch (e) {}
    }

    atualizarComponentesInterface(isDark);

    // Dispara evento customizado para componentes reativos
    window.dispatchEvent(new CustomEvent('sgm-theme-changed', {
      detail: { tema: isDark ? 'dark' : 'light', isDark }
    }));
  }

  /**
   * Alterna entre Modo Noturno e Modo Claro.
   */
  function alternarTema() {
    const temaAtual = obterTemaAtual();
    const novoTema = (temaAtual === 'dark') ? 'light' : 'dark';
    aplicarTema(novoTema);
  }

  /**
   * Atualiza ícones e textos dos botões de alternância de tema no topo da tela.
   * @param {boolean} isDark 
   */
  function atualizarComponentesInterface(isDark) {
    const botoes = document.querySelectorAll('#btnToggleTheme, .btn-toggle-theme');
    
    botoes.forEach(btn => {
      const iconEl = btn.querySelector('#themeIcon, .theme-icon');
      const textEl = btn.querySelector('#themeText, .theme-text');

      if (isDark) {
        if (iconEl) iconEl.textContent = '🌙';
        if (textEl) textEl.textContent = 'Modo Noturno';
        btn.setAttribute('title', 'Modo Noturno ativo. Clique para alternar para Modo Claro');
        btn.setAttribute('aria-label', 'Alternar para Modo Claro');
      } else {
        if (iconEl) iconEl.textContent = '☀️';
        if (textEl) textEl.textContent = 'Modo Claro';
        btn.setAttribute('title', 'Modo Claro ativo. Clique para alternar para Modo Noturno');
        btn.setAttribute('aria-label', 'Alternar para Modo Noturno');
      }
    });
  }

  // Executa imediatamente no carregamento do arquivo
  const temaInicial = obterTemaAtual();
  aplicarTema(temaInicial);

  // Conecta ouvintes quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      atualizarComponentesInterface(obterTemaAtual() === 'dark');
      
      const botoes = document.querySelectorAll('#btnToggleTheme, .btn-toggle-theme');
      botoes.forEach(btn => {
        btn.addEventListener('click', alternarTema);
      });
    });
  } else {
    atualizarComponentesInterface(obterTemaAtual() === 'dark');
    const botoes = document.querySelectorAll('#btnToggleTheme, .btn-toggle-theme');
    botoes.forEach(btn => {
      btn.addEventListener('click', alternarTema);
    });
  }

  // Expõe utilitários globalmente
  window.sgmTheme = {
    aplicarTema,
    alternarTema,
    obterTemaAtual,
    isDark: () => document.documentElement.classList.contains('dark')
  };
})();
