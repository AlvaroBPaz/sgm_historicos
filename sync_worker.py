"""
Módulo de Sincronização Híbrida Offline-First (Supabase Outbox Worker)
=====================================================================
Implementa o padrão Offline-First com gatilho duplo de sincronização
conforme Seção 8.1 do SPEC.md:

1. Gatilho Imediato (Reativo):
   - Disparado assincronamente em segundo plano logo após aprovar/salvar um aluno.
2. Gatilho Agendado (Ciclo de 2 horas) e Manual:
   - Thread contínua que executa a cada 2 horas e botão 'Sincronizar Agora' no frontend.
3. Fluxo Bidirecional (Push e Pull):
   - Push: Varre registros locais com 'sincronizado = 0' e faz upsert no Supabase.
   - Pull: Baixa registros inseridos/atualizados por um 2º computador na mesma escola.
   - Chaves UUIDv4 previnem qualquer colisão de IDs entre computadores simultâneos.
4. Resiliência Offline:
   - Se a escola estiver sem internet ou o Supabase não estiver configurado,
     a aplicação opera normalmente com SQLite local.
"""

import os
import time
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import database
import config_manager


logger = logging.getLogger("sgm_historicos.sync_worker")

# Intervalo padrão: 2 horas em segundos (7.200s)
INTERVALO_CICLO_PADRAO = 7200.0


# ==============================================================================
# CLIENTE SUPABASE OFFLINE-FIRST
# ==============================================================================

class SupabaseSyncClient:
    """
    Gerenciador da conexão com o Supabase (PostgreSQL na Nuvem)
    com tratamento transparente de offline.
    """

    def __init__(self):
        self._cliente = None
        self._lock = threading.Lock()

    def obter_credenciais(self) -> Tuple[Optional[str], Optional[str]]:
        """Recupera URL e Chave do Supabase em variáveis de ambiente ou config local."""
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not url or not key:
            cfg = config_manager.config_manager.obter_configuracao()
            url = url or cfg.get("supabase_url")
            key = key or cfg.get("supabase_key")

        return url, key

    def is_configurado(self) -> bool:
        """Indica se as credenciais do Supabase foram fornecidas."""
        url, key = self.obter_credenciais()
        return bool(url and key)

    def conectar(self) -> Optional[Any]:
        """Inicializa o cliente oficial supabase-py se houver credenciais."""
        if not self.is_configurado():
            return None

        with self._lock:
            if self._cliente is not None:
                return self._cliente

            url, key = self.obter_credenciais()
            try:
                from supabase import create_client, Client
                self._cliente = create_client(url, key)
                return self._cliente
            except Exception as e:
                logger.warning(f"Não foi possível inicializar cliente Supabase: {e}")
                return None


supabase_client = SupabaseSyncClient()


# ==============================================================================
# ROTINAS DE SINCRONIZAÇÃO (PUSH E PULL)
# ==============================================================================

def executar_push_outbox(
    cliente_supabase: Any,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, int]:
    """
    Envia para o Supabase todos os registros locais pendentes (sincronizado = 0).
    Ao confirmar a gravação na nuvem, marca localmente com sincronizado = 1.
    """
    pendentes = database.obter_pendentes_sincronizacao(limite_por_tabela=100, caminho_db=caminho_db)
    total_enviados = {
        "alunos": 0,
        "vida_escolar": 0,
        "notas_curriculares": 0,
        "auditoria_logs": 0
    }

    # 1. Alunos
    if pendentes["alunos"]:
        uuids_alunos = []
        for aluno in pendentes["alunos"]:
            try:
                # Remove o campo auxiliar 'sincronizado' antes do upsert no Supabase
                dados_remoto = {k: v for k, v in aluno.items() if k != "sincronizado"}
                cliente_supabase.table("alunos").upsert(dados_remoto).execute()
                uuids_alunos.append(aluno["uuid"])
            except Exception as e:
                logger.error(f"Erro ao sincronizar aluno {aluno.get('uuid')}: {e}")
                break
        if uuids_alunos:
            database.marcar_registros_sincronizados("alunos", uuids_alunos, caminho_db=caminho_db)
            total_enviados["alunos"] = len(uuids_alunos)

    # 2. Vida Escolar
    if pendentes["vida_escolar"]:
        uuids_vida = []
        for vida in pendentes["vida_escolar"]:
            try:
                dados_remoto = {k: v for k, v in vida.items() if k != "sincronizado"}
                cliente_supabase.table("vida_escolar").upsert(dados_remoto).execute()
                uuids_vida.append(vida["uuid"])
            except Exception as e:
                logger.error(f"Erro ao sincronizar vida escolar {vida.get('uuid')}: {e}")
                break
        if uuids_vida:
            database.marcar_registros_sincronizados("vida_escolar", uuids_vida, caminho_db=caminho_db)
            total_enviados["vida_escolar"] = len(uuids_vida)

    # 3. Notas Curriculares
    if pendentes["notas_curriculares"]:
        uuids_notas = []
        for nota in pendentes["notas_curriculares"]:
            try:
                dados_remoto = {k: v for k, v in nota.items() if k != "sincronizado"}
                cliente_supabase.table("notas_curriculares").upsert(dados_remoto).execute()
                uuids_notas.append(nota["uuid"])
            except Exception as e:
                logger.error(f"Erro ao sincronizar nota {nota.get('uuid')}: {e}")
                break
        if uuids_notas:
            database.marcar_registros_sincronizados("notas_curriculares", uuids_notas, caminho_db=caminho_db)
            total_enviados["notas_curriculares"] = len(uuids_notas)

    # 4. Logs de Auditoria
    if pendentes["auditoria_logs"]:
        uuids_logs = []
        for log in pendentes["auditoria_logs"]:
            try:
                dados_remoto = {k: v for k, v in log.items() if k != "sincronizado"}
                cliente_supabase.table("auditoria_logs").upsert(dados_remoto).execute()
                uuids_logs.append(log["uuid"])
            except Exception as e:
                logger.error(f"Erro ao sincronizar log de auditoria {log.get('uuid')}: {e}")
                break
        if uuids_logs:
            database.marcar_registros_sincronizados("auditoria_logs", uuids_logs, caminho_db=caminho_db)
            total_enviados["auditoria_logs"] = len(uuids_logs)

    return total_enviados


def executar_pull_inbound(
    cliente_supabase: Any,
    escola_id: Optional[int] = None,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, int]:
    """
    Busca novos registros inseridos ou atualizados no Supabase por outro
    computador da mesma escola e atualiza o SQLite local.
    """
    baixados = {
        "alunos": 0,
        "vida_escolar": 0,
        "notas_curriculares": 0
    }

    try:
        # Consulta alunos na nuvem
        query = cliente_supabase.table("alunos").select("*")
        if escola_id:
            query = query.eq("escola_id", escola_id)
        resposta = query.order("atualizado_em", desc=True).limit(50).execute()
        alunos_nuvem = resposta.data or []

        for aluno_remoto in alunos_nuvem:
            uid = aluno_remoto.get("uuid")
            if not uid:
                continue

            aluno_local = database.obter_aluno(uid, verificar_hmac=False, caminho_db=caminho_db)
            if not aluno_local:
                # Aluno novo criado por outro PC: insere no SQLite
                database.criar_aluno(aluno_remoto, calcular_hmac=False, caminho_db=caminho_db)
                database.marcar_registros_sincronizados("alunos", [uid], caminho_db=caminho_db)
                baixados["alunos"] += 1
            else:
                # Compara timestamp de atualização
                ts_remoto = aluno_remoto.get("atualizado_em", "")
                ts_local = aluno_local.get("atualizado_em", "")
                if ts_remoto > ts_local:
                    database.atualizar_aluno(uid, aluno_remoto, calcular_hmac=False, caminho_db=caminho_db)
                    database.marcar_registros_sincronizados("alunos", [uid], caminho_db=caminho_db)
                    baixados["alunos"] += 1

    except Exception as e:
        logger.warning(f"Erro durante pull de alunos do Supabase: {e}")

    return baixados


def executar_sincronizacao_completa(
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Executa o ciclo completo de sincronização (Push Outbox + Pull Inbound).
    Totalmente seguro contra indisponibilidade de internet ou ausência de chaves.
    """
    if not supabase_client.is_configurado():
        pendentes = database.obter_pendentes_sincronizacao(caminho_db=caminho_db)
        total_p = sum(len(v) for v in pendentes.values())
        return {
            "sucesso": True,
            "offline": True,
            "mensagem": f"Operando em modo local. {total_p} registro(s) pendente(s) de envio quando o Supabase for configurado.",
            "enviados": {"alunos": 0, "vida_escolar": 0, "notas_curriculares": 0, "auditoria_logs": 0},
            "baixados": {"alunos": 0, "vida_escolar": 0, "notas_curriculares": 0},
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    cli = supabase_client.conectar()
    if not cli:
        return {
            "sucesso": False,
            "offline": True,
            "mensagem": "Falha na conexão com a API do Supabase. Trabalho mantido localmente sem perda de dados.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    try:
        escola_id = config_manager.config_manager.obter_escola_id()
        enviados = executar_push_outbox(cli, caminho_db=caminho_db)
        baixados = executar_pull_inbound(cli, escola_id=escola_id, caminho_db=caminho_db)

        total_env = sum(enviados.values())
        total_rec = sum(baixados.values())

        return {
            "sucesso": True,
            "offline": False,
            "mensagem": f"Sincronização concluída com sucesso! ({total_env} enviados, {total_rec} recebidos)",
            "enviados": enviados,
            "baixados": baixados,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as exc:
        logger.warning(f"Exceção durante ciclo de sincronização: {exc}")
        return {
            "sucesso": False,
            "offline": True,
            "mensagem": f"Erro de comunicação com Supabase: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# ==============================================================================
# GATILHO IMEDIATO (REATIVO) EM THREAD DEDICADA
# ==============================================================================

def disparar_sincronizacao_imediata(caminho_db: Optional[Union[str, Path]] = None) -> None:
    """
    Gatilho reativo: dispara sincronização em thread de background imediatamente
    após o operador salvar ou homologar uma ficha, sem bloquear a resposta HTTP.
    """
    def _tarefa():
        time.sleep(0.5)  # Pequeno atraso para liberação do lock da transação SQLite
        executar_sincronizacao_completa(caminho_db=caminho_db)

    t = threading.Thread(target=_tarefa, daemon=True, name="SGM_SyncImediato")
    t.start()


# ==============================================================================
# WORKER AGENDADO EM BACKGROUND (A CADA 2 HORAS)
# ==============================================================================

class SyncWorkerThread(threading.Thread):
    """
    Thread de segundo plano que roda continuamente na máquina local,
    executando o ciclo de sincronização a cada 2 horas.
    """

    def __init__(
        self,
        intervalo_segundos: float = INTERVALO_CICLO_PADRAO,
        caminho_db: Optional[Union[str, Path]] = None
    ):
        super().__init__(daemon=True, name="SGM_SyncWorker2h")
        self.intervalo = intervalo_segundos
        self.caminho_db = caminho_db
        self.stop_event = threading.Event()
        self.ultimo_resultado: Optional[Dict[str, Any]] = None

    def run(self) -> None:
        logger.info(f"SyncWorker iniciado (Ciclo agendado de {self.intervalo/3600:.1f} horas).")
        # Pequena pausa inicial de 10s após inicialização da aplicação
        self.stop_event.wait(10.0)

        while not self.stop_event.is_set():
            try:
                res = executar_sincronizacao_completa(caminho_db=self.caminho_db)
                self.ultimo_resultado = res
                logger.info(f"Ciclo periódico de sincronização: {res.get('mensagem')}")
            except Exception as e:
                logger.error(f"Erro no ciclo do SyncWorker: {e}")

            # Aguarda o intervalo de 2 horas ou encerramento
            self.stop_event.wait(self.intervalo)

        logger.info("SyncWorker finalizado com sucesso.")

    def parar(self) -> None:
        """Encerra a thread de segundo plano graciosamente."""
        self.stop_event.set()


# Instância singleton padrão do worker de sincronização
_sync_worker_instancia: Optional[SyncWorkerThread] = None


def iniciar_sync_worker(
    intervalo_segundos: float = INTERVALO_CICLO_PADRAO,
    caminho_db: Optional[Union[str, Path]] = None
) -> SyncWorkerThread:
    """Inicia a thread agendada de 2 horas do SyncWorker."""
    global _sync_worker_instancia
    if _sync_worker_instancia is None or not _sync_worker_instancia.is_alive():
        _sync_worker_instancia = SyncWorkerThread(intervalo_segundos, caminho_db=caminho_db)
        _sync_worker_instancia.start()
    return _sync_worker_instancia


def parar_sync_worker() -> None:
    """Interrompe a thread de sincronização."""
    global _sync_worker_instancia
    if _sync_worker_instancia is not None and _sync_worker_instancia.is_alive():
        _sync_worker_instancia.parar()
        _sync_worker_instancia.join(timeout=5.0)
        _sync_worker_instancia = None


def obter_status_sincronizacao(caminho_db: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    """Retorna o estado da fila outbox e diagnóstico da nuvem."""
    pendentes = database.obter_pendentes_sincronizacao(caminho_db=caminho_db)
    return {
        "supabase_configurado": supabase_client.is_configurado(),
        "total_pendentes_outbox": {
            "alunos": len(pendentes["alunos"]),
            "vida_escolar": len(pendentes["vida_escolar"]),
            "notas_curriculares": len(pendentes["notas_curriculares"]),
            "auditoria_logs": len(pendentes["auditoria_logs"]),
            "total_geral": sum(len(v) for v in pendentes.values())
        },
        "ultimo_resultado": _sync_worker_instancia.ultimo_resultado if _sync_worker_instancia else None
    }
