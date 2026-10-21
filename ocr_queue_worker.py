"""
Módulo de Fila Assíncrona Offline e Transcrição por IA (Gemini 2.5 Flash)
========================================================================
Implementa a fila assíncrona offline de transcrição de históricos escolares
e integração oficial com a API Google Gemini conforme Seção 7 do SPEC.md:

1. Processamento em Segundo Plano e Modo Offline-First:
   - Os envelopes de digitalização ficam salvos localmente com status 'PENDENTE_IA'.
   - O worker monitora a fila e despacha para processamento quando houver internet e chave API.
2. Chamada Multimodal Única:
   - Todas as páginas escaneadas do ex-aluno (frente, verso e anexos) são enviadas
     juntas em uma única chamada multimodal para o modelo 'gemini-2.5-flash'.
3. Saída Estruturada com Pydantic (HistoricoExtraidoSchema):
   - Converte imagens manuscritas ou datilografadas em dados civis, séries cursadas
     e matriz de notas, marcando 'baixa_confianca: bool' em rasuras, carimbos ou dúvidas.
4. Controle de Taxa e Respeito à Cota Gratuita:
   - Limite estrito de 12 requisições por minuto (intervalo de 5s entre chamadas).
   - Retry automático com exponential backoff para tratamento de HTTP 429 ou instabilidades.
"""

import os
import json
import time
import uuid
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field

import database


logger = logging.getLogger("sgm_historicos.ocr_worker")

# Modelo oficial do Gemini para visão multimodal e transcrição de documentos
MODELO_GEMINI = "gemini-3.8-flash"

# Limite estrito: 12 chamadas por minuto = 1 chamada a cada 5 segundos
INTERVALO_MINIMO_REQUISICAO_SEGUNDOS = 5.0
MAX_TENTATIVAS_IA = 4


# ==============================================================================
# ESQUEMAS PYDANTIC DE EXTRAÇÃO ESTRUTURADA (SEÇÃO 7.2 DO SPEC)
# ==============================================================================

class CampoExtraido(BaseModel):
    """Célula ou dado com valor textual e flag de confiabilidade visual."""
    valor: Optional[str] = Field(
        default="",
        description="Texto ou valor extraído do documento histórico. Se ausente, retorne string vazia."
    )
    baixa_confianca: bool = Field(
        default=False,
        description="True se houver rasura, carimbo sobre a escrita, borrão, desbotamento ou grafia duvidosa."
    )


class DadosCivisExtraidos(BaseModel):
    """Informações civis e de identificação do ex-aluno."""
    nome_completo: CampoExtraido = Field(description="Nome civil completo do ex-aluno")
    data_nascimento: CampoExtraido = Field(description="Data de nascimento (DD/MM/AAAA ou conforme documento)")
    naturalidade_municipio: CampoExtraido = Field(description="Município de nascimento")
    naturalidade_uf: CampoExtraido = Field(description="Sigla do estado de nascimento (ex: BA, SP)")
    nacionalidade: CampoExtraido = Field(description="Nacionalidade (geralmente Brasileira)")
    filiacao_1: CampoExtraido = Field(description="Nome da mãe ou filiação primária")
    filiacao_2: CampoExtraido = Field(description="Nome do pai ou filiação secundária")
    rg_numero: CampoExtraido = Field(description="Número da cédula de identidade RG")
    rg_orgao_uf: CampoExtraido = Field(description="Órgão emissor e UF do RG (ex: SSP/BA)")
    cpf: CampoExtraido = Field(description="Número de inscrição no CPF (se houver)")
    codigo_inep_aluno: CampoExtraido = Field(description="Código INEP ou matrícula do aluno")
    certidao_tipo: CampoExtraido = Field(description="Tipo de registro: 'Nascimento' ou 'Casamento'")
    certidao_termo: CampoExtraido = Field(description="Número do termo da certidão")
    certidao_livro: CampoExtraido = Field(description="Livro da certidão")
    certidao_folha: CampoExtraido = Field(description="Folha da certidão")
    certidao_cartorio: CampoExtraido = Field(description="Nome ou número do cartório de registro civil")
    certidao_municipio_uf: CampoExtraido = Field(description="Município e UF do cartório")
    arquivo_ano_referencia: CampoExtraido = Field(description="Ano de conclusão ou última matrícula")


class SerieVidaEscolarExtraida(BaseModel):
    """Dados de uma série ou ano letivo específico cursado."""
    ordem_coluna: int = Field(description="Ordem sequencial da coluna (1 a 9)")
    label_serie: CampoExtraido = Field(description="Nome da série/ano (ex: '1ª Série', '8ª Série', '1º Ano')")
    ano_letivo: CampoExtraido = Field(description="Ano letivo cursado (ex: '1987', '1993')")
    escola_nome: CampoExtraido = Field(description="Nome da escola onde cursou a referida série")
    escola_municipio_uf: CampoExtraido = Field(description="Município e UF do estabelecimento escolar")
    dias_letivos: CampoExtraido = Field(description="Total de dias letivos (ex: '180', '200')")
    carga_horaria_total: CampoExtraido = Field(description="Carga horária total anual em horas")
    frequencia_percentual: CampoExtraido = Field(description="Frequência global percentual (ex: '85%')")
    resultado_final: CampoExtraido = Field(
        description="Resultado final: 'Aprovado', 'Reprovado', 'Promovido', 'Transferido', 'Desistente' ou 'Não Cursado'"
    )


class NotaDisciplinaExtraida(BaseModel):
    """Nota ou conceito de uma disciplina em uma série específica."""
    ordem_coluna: int = Field(description="Coluna vinculada à série correspondente (1 a 9)")
    categoria: str = Field(description="'BASE_COMUM' ou 'DIVERSIFICADA'")
    ordem_disciplina: int = Field(description="Ordem sequencial da disciplina na grade")
    disciplina_nome: CampoExtraido = Field(
        description="Nome da disciplina (ex: Língua Portuguesa, Matemática, Estudos Sociais, OSPB, EMC)"
    )
    nota_ou_conceito: CampoExtraido = Field(
        description="Nota obtida (ex: '7,5', '80', 'A', 'AP') ou '---' se a série não foi cursada"
    )
    carga_horaria_disciplina: CampoExtraido = Field(description="Carga horária da matéria em horas")


class HistoricoExtraidoSchema(BaseModel):
    """Esquema completo unificado do Histórico Escolar emitido pela IA."""
    regime_ensino: str = Field(
        description="Regime educacional do documento: '8_ANOS' (1ª a 8ª Série), '9_ANOS' (1º ao 9º Ano) ou 'EJA_ETAPAS'"
    )
    dados_civis: DadosCivisExtraidos
    series_cursadas: List[SerieVidaEscolarExtraida] = Field(
        description="Lista de séries/anos cursadas identificadas nas colunas da folha"
    )
    notas_curriculares: List[NotaDisciplinaExtraida] = Field(
        description="Matriz completa de disciplinas e respectivas notas/conceitos por série"
    )
    observacoes_historico: CampoExtraido = Field(
        description="Observações gerais, leis de equivalência (ex: Lei 5.692/71, Lei 9.394/96), ressalvas"
    )


# ==============================================================================
# PROMPT DE SISTEMA ESPECIALIZADO EM ARQUIVOS HISTÓRICOS BRASILEIROS
# ==============================================================================

SYSTEM_PROMPT_HISTORICO = """
Você é um especialista em paleografia e transcrição de documentos escolares públicos brasileiros
dos séculos XX e XXI (períodos de 1960 a 2026), atuando na digitalização do Acervo Passivo
Municipal de Educação.

Sua tarefa é analisar as imagens das páginas do histórico escolar do ex-aluno (frente, verso e anexos)
e extrair com máxima fidelidade todas as informações para o esquema JSON estruturado solicitado.

DIRETRIZES FUNDAMENTAIS DE TRANSCRIÇÃO:
1. REGIME DE ENSINO:
   - '8_ANOS': Típico do Ensino de 1º Grau antigo (1ª Série à 8ª Série, sob as Leis 5.692/71 e anteriores).
   - '9_ANOS': Ensino Fundamental contemporâneo (1º Ano ao 9º Ano, pós-2006).
   - 'EJA_ETAPAS': Educação de Jovens e Adultos (Fases, Etapas ou Exames Supletivos).

2. DISCIPLINAS HISTÓRICAS E CONTEMPORÂNEAS:
   - Respeite rigorosamente a nomenclatura original escrita no papel (ex: 'Estudos Sociais',
     'Educação Moral e Cívica', 'OSPB', 'Programas de Saúde', 'Ciências Físicas e Biológicas',
     'Educação Artística', 'Práticas Agrícolas', 'Língua Portuguesa', 'Matemática').

3. SINALIZAÇÃO DE BAIXA CONFIANÇA (baixa_confianca = true):
   - Você DEVE marcar 'baixa_confianca: true' sempre que houver:
     * Rasura ou carimbo sobreposto a um número ou letra;
     * Letra cursiva com traçado ambíguo (ex: dúvida entre '3', '5' ou '8', ou entre '6' e '0');
     * Borrão de tinta, umidade ou papel desbotado pelo tempo;
     * Nome civil grafado com caracteres de difícil distinção.
   - Isso alertará o funcionário humano para revisão detalhada na tela de conferência.

4. SÉRIES NÃO CURSADAS OU TRANSFERÊNCIAS:
   - Se uma série/coluna não foi cursada naquela escola, preencha o resultado como 'Não Cursado'
     e preencha as notas das disciplinas correspondentes com o traço padrão: '---'.
"""


# ==============================================================================
# CLIENTE GEMINI COM RATE LIMITING E RETRY
# ==============================================================================

class GeminiClientWorker:
    """
    Cliente gerenciador das requisições ao Google Gemini 2.5 Flash,
    respeitando a cota gratuita e limites de taxa (12 req/min).
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._ultima_requisicao_ts: float = 0.0

    def obter_api_key(self) -> Optional[str]:
        """Recupera a chave de API do Gemini em variáveis de ambiente, .env ou arquivo de configuração local."""
        if "GEMINI_API_KEY" in os.environ and not os.environ["GEMINI_API_KEY"]:
            return None

        chave = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if chave:
            return chave.strip()

        # 1. Tenta carregar do .env local
        env_file = Path(__file__).resolve().parent / ".env"
        if env_file.exists():
            try:
                for linha in env_file.read_text(encoding="utf-8").splitlines():
                    linha = linha.strip()
                    if linha.startswith("GEMINI_API_KEY="):
                        return linha.split("=", 1)[1].strip().strip('"').strip("'")
            except Exception:
                pass

        # 2. Tenta carregar de data_local/config_instalacao.json
        cfg_file = Path(__file__).resolve().parent / "data_local" / "config_instalacao.json"
        if cfg_file.exists():
            try:
                import json
                dados_cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
                if dados_cfg.get("gemini_api_key"):
                    return dados_cfg["gemini_api_key"].strip()
            except Exception:
                pass

        # 3. Se não encontrada em nenhuma fonte
        return None

    def _esperar_taxa_limite(self) -> None:
        """Garante o espaçamento mínimo de 5 segundos entre requisições (máx 12/min)."""
        with self._lock:
            agora = time.time()
            tempo_desde_ultima = agora - self._ultima_requisicao_ts
            if tempo_desde_ultima < INTERVALO_MINIMO_REQUISICAO_SEGUNDOS:
                espera = INTERVALO_MINIMO_REQUISICAO_SEQUISICAO = INTERVALO_MINIMO_REQUISICAO_SEGUNDOS - tempo_desde_ultima
                time.sleep(espera)
            self._ultima_requisicao_ts = time.time()

    def transcrever_envelope_multimodal(
        self,
        caminhos_paginas_webp: List[Union[str, Path]]
    ) -> HistoricoExtraidoSchema:
        """
        Envia todas as páginas WebP do envelope juntas em uma única chamada multimodal
        utilizando response_schema via Pydantic.
        """
        api_key = self.obter_api_key()
        if not api_key:
            raise ValueError(
                "Chave de API do Gemini não configurada. Defina a variável GEMINI_API_KEY no ambiente."
            )

        if not caminhos_paginas_webp:
            raise ValueError("O envelope não possui páginas WebP para transcrever.")

        # Import oficial do SDK google-genai
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # Monta os conteúdos multimodais (Prompt + Imagens WebP)
        conteudos = [
            "Transcreva com máxima precisão este Histórico Escolar completo composto pelas páginas a seguir:"
        ]

        for idx, caminho in enumerate(caminhos_paginas_webp, 1):
            p = Path(caminho)
            if not p.exists():
                raise FileNotFoundError(f"Página WebP não encontrada em disco: {p}")

            with open(p, "rb") as f:
                dados_bytes = f.read()

            part_img = types.Part.from_bytes(
                data=dados_bytes,
                mime_type="image/webp"
            )
            conteudos.append(f"\n--- [PÁGINA {idx} DE {len(caminhos_paginas_webp)} DO DOCUMENTO] ---")
            conteudos.append(part_img)

        # Configuração com saída estritamente estruturada pelo Pydantic Schema
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=HistoricoExtraidoSchema,
            temperature=0.1,
            system_instruction=SYSTEM_PROMPT_HISTORICO
        )

        # Execução com controle de taxa e retry exponencial
        max_tentativas = MAX_TENTATIVAS_IA
        atraso_backoff = 5.0
        modelos_candidatos = [MODELO_GEMINI, "gemini-flash-latest", "gemini-2.5-flash-lite"]
        modelo_idx = 0

        for tentativa in range(1, max_tentativas + 1):
            try:
                self._esperar_taxa_limite()
                modelo_atual = modelos_candidatos[min(modelo_idx, len(modelos_candidatos) - 1)]
                resposta = client.models.generate_content(
                    model=modelo_atual,
                    contents=conteudos,
                    config=config
                )

                # Parsing seguro para o Schema Pydantic
                texto_json = resposta.text
                if not texto_json:
                    raise ValueError("Gemini retornou resposta vazia.")

                return HistoricoExtraidoSchema.model_validate_json(texto_json)

            except Exception as exc:
                erro_str = str(exc)
                logger.warning(
                    f"Tentativa {tentativa}/{max_tentativas} falhou para o Gemini ({modelos_candidatos[min(modelo_idx, len(modelos_candidatos) - 1)]}): {erro_str}"
                )

                if "404" in erro_str or "NOT_FOUND" in erro_str:
                    modelo_idx += 1

                # Se atingiu o limite de tentativas, propaga a exceção
                if tentativa == max_tentativas:
                    raise

                # Se for Rate Limit (HTTP 429), aplica exponential backoff
                if "429" in erro_str or "RESOURCE_EXHAUSTED" in erro_str or "quota" in erro_str.lower():
                    time.sleep(atraso_backoff)
                    atraso_backoff *= 2.0
                else:
                    time.sleep(3.0)

        raise RuntimeError("Falha inesperada no laço de requisição do Gemini.")


# Instância global do cliente
gemini_worker = GeminiClientWorker()


# ==============================================================================
# PROCESSAMENTO DE SESSÕES DA FILA (fila_ocr)
# ==============================================================================

def processar_sessao_ocr(
    sessao_id: str,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Processa uma sessão específica que esteja em 'PENDENTE_IA' ou solicitada manualmente.
    Transcreve as páginas via Gemini 2.5 Flash, atualiza o JSON extraído e coloca
    em status 'AGUARDANDO_REVISAO'.
    """
    sessao = database.obter_sessao_ocr(sessao_id, caminho_db=caminho_db)
    if not sessao:
        return {"sucesso": False, "mensagem": f"Sessão {sessao_id} não encontrada."}

    # Extrai a lista de caminhos locais das imagens WebP
    try:
        paginas_locais = json.loads(sessao.get("paginas_locais_json") or "[]")
    except Exception:
        paginas_locais = []

    if not paginas_locais:
        database.atualizar_status_ocr(
            sessao_id=sessao_id,
            status="ERRO_IA",
            erro="Nenhuma página aprovada encontrada nesta sessão para envio à IA.",
            caminho_db=caminho_db
        )
        return {"sucesso": False, "mensagem": "Nenhuma página na sessão."}

    # Verifica existência de chave de API
    api_key = gemini_worker.obter_api_key()
    if not api_key:
        database.atualizar_status_ocr(
            sessao_id=sessao_id,
            status="PENDENTE_IA",
            erro="Aguardando configuração da GEMINI_API_KEY no ambiente.",
            caminho_db=caminho_db
        )
        return {
            "sucesso": False,
            "status": "PENDENTE_IA",
            "mensagem": "GEMINI_API_KEY não definida. O envelope permanecerá em PENDENTE_IA para processamento posterior."
        }

    # Atualiza status para PROCESSANDO_IA
    database.atualizar_status_ocr(
        sessao_id=sessao_id,
        status="PROCESSANDO_IA",
        incrementar_tentativa=True,
        caminho_db=caminho_db
    )

    try:
        # Executa a chamada multimodal única
        resultado_schema = gemini_worker.transcrever_envelope_multimodal(paginas_locais)
        json_serializado = resultado_schema.model_dump_json(indent=2)

        # Transcrição concluída: envelope pronto para a Tela Dividida de Revisão
        sessao_atualizada = database.atualizar_status_ocr(
            sessao_id=sessao_id,
            status="AGUARDANDO_REVISAO",
            json_extraido=json_serializado,
            erro=None,
            caminho_db=caminho_db
        )

        return {
            "sucesso": True,
            "sessao_id": sessao_id,
            "status": "AGUARDANDO_REVISAO",
            "aluno_nome": resultado_schema.dados_civis.nome_completo.valor,
            "regime": resultado_schema.regime_ensino,
            "total_series": len(resultado_schema.series_cursadas),
            "total_notas": len(resultado_schema.notas_curriculares),
            "mensagem": "Transcrição do histórico escolar realizada com sucesso!"
        }

    except Exception as exc:
        msg_erro = str(exc)
        logger.error(f"Erro no processamento IA da sessão {sessao_id}: {msg_erro}")

        # Verifica se ainda pode tentar novamente
        sessao_atual = database.obter_sessao_ocr(sessao_id, caminho_db=caminho_db)
        tentativas = sessao_atual.get("tentativas_ia", 0) if sessao_atual else 1

        novo_status = "ERRO_IA" if tentativas >= MAX_TENTATIVAS_IA else "PENDENTE_IA"
        database.atualizar_status_ocr(
            sessao_id=sessao_id,
            status=novo_status,
            erro=msg_erro,
            caminho_db=caminho_db
        )

        return {
            "sucesso": False,
            "sessao_id": sessao_id,
            "status": novo_status,
            "mensagem": f"Falha na IA: {msg_erro}"
        }


def processar_proximo_pendente(caminho_db: Optional[Union[str, Path]] = None) -> Optional[Dict[str, Any]]:
    """Busca o próximo envelope em status 'PENDENTE_IA' e o processa."""
    pendentes = database.listar_sessoes_ocr(status="PENDENTE_IA", limite=1, caminho_db=caminho_db)
    if not pendentes:
        return None
    return processar_sessao_ocr(pendentes[0]["sessao_id"], caminho_db=caminho_db)


# ==============================================================================
# THREAD DE FILA ASSÍNCRONA EM BACKGROUND
# ==============================================================================

class OcrQueueWorkerThread(threading.Thread):
    """
    Thread em segundo plano que monitora a fila SQLite e processa envelopes
    pendentes respeitando taxas de limite e tolerância a períodos sem internet.
    """

    def __init__(self, intervalo_varredura_segundos: float = 6.0, caminho_db: Optional[Union[str, Path]] = None):
        super().__init__(daemon=True, name="SGM_OcrQueueWorker")
        self.intervalo = intervalo_varredura_segundos
        self.caminho_db = caminho_db
        self.stop_event = threading.Event()

    def run(self) -> None:
        logger.info("Worker assíncrono de OCR/IA iniciado.")
        while not self.stop_event.is_set():
            try:
                # Processa se houver pendentes
                resultado = processar_proximo_pendente(caminho_db=self.caminho_db)
                if resultado and resultado.get("sucesso"):
                    # Se processou um com sucesso, pausa pelo intervalo mínimo antes de checar outro
                    self.stop_event.wait(INTERVALO_MINIMO_REQUISICAO_SEGUNDOS)
                else:
                    # Se não havia itens ou falhou, aguarda o intervalo de varredura
                    self.stop_event.wait(self.intervalo)
            except Exception as e:
                logger.error(f"Exceção no ciclo do worker OCR: {e}")
                self.stop_event.wait(self.intervalo)

        logger.info("Worker assíncrono de OCR/IA finalizado.")

    def parar(self) -> None:
        """Sinaliza para a thread interromper a execução graciosa."""
        self.stop_event.set()


# Instância do worker em background gerenciada pela aplicação
_worker_instancia: Optional[OcrQueueWorkerThread] = None


def iniciar_worker_ocr(caminho_db: Optional[Union[str, Path]] = None) -> OcrQueueWorkerThread:
    """Inicia a thread de background da fila OCR se não estiver rodando."""
    global _worker_instancia
    if _worker_instancia is None or not _worker_instancia.is_alive():
        _worker_instancia = OcrQueueWorkerThread(caminho_db=caminho_db)
        _worker_instancia.start()
    return _worker_instancia


def parar_worker_ocr() -> None:
    """Interrompe a thread de background da fila OCR."""
    global _worker_instancia
    if _worker_instancia is not None and _worker_instancia.is_alive():
        _worker_instancia.parar()
        _worker_instancia.join(timeout=10.0)
        _worker_instancia = None
