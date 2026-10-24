"""
SGM-Históricos — Sistema Municipal de Acervo Passivo e Histórico Escolar
app_window.py — Inicializador Desktop com PyWebView e Servidor Uvicorn em Thread

Executa o backend FastAPI na porta 8000 e abre a interface nativa do Microsoft Edge WebView2,
oferecendo ao funcionário municipal uma experiência de aplicativo desktop Windows limpa,
sem barras de endereço ou botões de navegador.
"""

import sys
import os
import time
import threading
import logging
import urllib.request
import webbrowser
import subprocess
from pathlib import Path

# Configuração de Logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (Desktop) %(message)s"
)
logger = logging.getLogger("app_window")

# Garante o diretório de trabalho na raiz do projeto
BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

HOST = "0.0.0.0"
PORT = 8000
URL_LOCAL = f"http://127.0.0.1:{PORT}"


class UvicornServerThread(threading.Thread):
    """Executa o servidor FastAPI / Uvicorn em uma thread desacoplada."""
    def __init__(self, host: str = HOST, port: int = PORT):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.server = None

    def run(self):
        import uvicorn
        config = uvicorn.Config(
            "main:app",
            host=self.host,
            port=self.port,
            log_level="warning",
            access_log=False,
            workers=1,
            loop="asyncio"
        )
        self.server = uvicorn.Server(config)
        logger.info(f"Iniciando servidor Uvicorn em {self.host}:{self.port}...")
        self.server.run()

    def stop(self):
        if self.server:
            logger.info("Encerrando servidor Uvicorn...")
            self.server.should_exit = True


def aguardar_servidor_online(timeout_segundos: int = 25) -> bool:
    """Aguarda até que a rota de status responda com HTTP 200."""
    url_health = f"{URL_LOCAL}/api/config/status"
    inicio = time.time()
    
    while time.time() - inicio < timeout_segundos:
        try:
            with urllib.request.urlopen(url_health, timeout=1.5) as resp:
                if resp.status == 200:
                    logger.info("Servidor FastAPI online e pronto!")
                    return True
        except Exception:
            time.sleep(0.3)
            
    logger.warning("Tempo limite de espera pelo servidor atingido.")
    return False


def abrir_em_navegador_fallback():
    """Fallback caso o PyWebView não consiga inicializar a janela nativa."""
    logger.info("Abrindo aplicação via navegador Edge em modo App...")
    cmd_edge = f'start msedge --start-maximized --app="{URL_LOCAL}"'
    try:
        subprocess.Popen(cmd_edge, shell=True)
    except Exception:
        webbrowser.open(URL_LOCAL)


def main():
    print("=" * 65)
    print("  SGM-Históricos — Sistema Municipal de Acervo Passivo")
    print("  Inicializando ambiente desktop e servidor local...")
    print("=" * 65)

    # 1. Inicia o servidor FastAPI em segundo plano
    server_thread = UvicornServerThread()
    server_thread.start()

    # 2. Aguarda a inicialização do FastAPI
    if not aguardar_servidor_online():
        print("Erro: Não foi possível estabelecer conexão com o backend local.")
        sys.exit(1)

    # 3. Tenta abrir a Janela Nativa Desktop usando PyWebView (Edge WebView2)
    janela_criada = False
    try:
        import webview

        logger.info("Inicializando janela nativa WebView2...")
        
        janela = webview.create_window(
            title="SGM-Históricos — Sistema Municipal de Acervo Passivo",
            url=URL_LOCAL,
            width=1280,
            height=820,
            min_size=(1024, 700),
            maximized=True,
            text_select=True,
            zoomable=True,
            confirm_close=False
        )

        # Inicia a execução do loop de eventos da interface
        webview.start(gui="edgechromium", debug=False)
        janela_criada = True

    except Exception as e:
        logger.warning(f"PyWebView indisponível ou falhou ao criar janela nativa: {e}")
        janela_criada = False

    # 4. Fallback: Se o WebView falhar (ex: terminal headless ou restrição de usuário)
    if not janela_criada:
        abrir_em_navegador_fallback()
        print(f"\nSistema disponível em: {URL_LOCAL}")
        print("Pressione Ctrl + C no terminal para encerrar o programa.\n")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    # 5. Encerramento limpo
    logger.info("Fechando aplicação e encerrando processos...")
    server_thread.stop()
    sys.exit(0)


if __name__ == "__main__":
    main()
