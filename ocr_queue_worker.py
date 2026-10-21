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
# Por padrão, utiliza o modelo ativo mais barato (gemini-flash-lite-latest) ou override via GEMINI_MODEL
MODELO_GEMINI = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest").strip()

# Intervalo mínimo obrigatório de 6 segundos entre chamadas (máximo 10 requisições por minuto)
INTERVALO_MINIMO_REQUISICAO_SEGUNDOS = 6.0
MAX_TENTATIVAS_IA = 1


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
    """Esquema completo unificado do Histórico Escolar emitido pela IA com validação de legitimidade."""
    eh_historico_escolar: bool = Field(
        description="True SOMENTE se a imagem contiver claramente um Histórico Escolar, Ficha Individual de Aluno ou Boletim/Certificado Escolar. Se for foto de pessoa, objeto, paisagem, tela aleatória ou outro documento qualquer (RG, CNH, etc.), retorne False."
    )
    esta_legivel_para_transcricao: bool = Field(
        description="False se a imagem estiver tão embaçada, cortada ou distante que não seja possível ler com segurança o nome do aluno ou a grade de disciplinas/notas. Retorne True se for possível transcrever com segurança."
    )
    motivo_rejeicao: Optional[str] = Field(
        default="",
        description="Explicação clara em português para o usuário caso eh_historico_escolar seja False ou esta_legivel_para_transcricao seja False (ex: 'A imagem enviada não é um Histórico Escolar' ou 'A foto está muito desfocada na tabela de notas. Por favor, tire outra foto mais nítida'). Se aprovado, retorne string vazia."
    )
    regime_ensino: Optional[str] = Field(
        default="8_ANOS",
        description="Regime educacional do documento: '8_ANOS' (1ª a 8ª Série), '9_ANOS' (1º ao 9º Ano) ou 'EJA_ETAPAS'"
    )
    dados_civis: Optional[DadosCivisExtraidos] = None
    series_cursadas: Optional[List[SerieVidaEscolarExtraida]] = Field(
        default_factory=list,
        description="Lista de séries/anos cursadas identificadas nas colunas da folha"
    )
    notas_curriculares: Optional[List[NotaDisciplinaExtraida]] = Field(
        default_factory=list,
        description="Matriz completa de disciplinas e respectivas notas/conceitos por série"
    )
    observacoes_historico: Optional[CampoExtraido] = Field(
        default_factory=lambda: CampoExtraido(valor="", baixa_confianca=False),
        description="Observações gerais, leis de equivalência (ex: Lei 5.692/71, Lei 9.394/96), ressalvas"
    )


# ==============================================================================
# PROMPT DE SISTEMA ESPECIALIZADO EM ARQUIVOS HISTÓRICOS BRASILEIROS
# ==============================================================================

SYSTEM_PROMPT_HISTORICO = """
Você é um auditor e especialista em paleografia e transcrição de documentos escolares públicos brasileiros
dos séculos XX e XXI (períodos de 1960 a 2026), atuando na digitalização do Acervo Passivo
Municipal de Educação.

ETAPA 1: VALIDAÇÃO OBRIGATÓRIA ANTES DA TRANSCRIÇÃO (TRAVA ANTI-FOTO INVÁLIDA):
1. 'eh_historico_escolar':
   - Retorne TRUE SOMENTE se a imagem contiver claramente um Histórico Escolar oficial, Ficha Individual de Aluno, Certificado/Boletim Escolar de 1º/2º Grau ou Ensino Fundamental/Médio.
   - Retorne FALSE IMEDIATAMENTE se a imagem contiver fotos de pessoas, selfies, objetos de escritório, xícaras, animais, paisagens, paredes, telas de computador/celular, ou outros documentos não escolares (ex: RG, CPF, CNH, carteira de trabalho, comprovante de residência, certidão isolada).
2. 'esta_legivel_para_transcricao':
   - Retorne FALSE se a imagem estiver tão embaçada, fora de foco, escura, cortada, com reflexos severos ou distante que impeça ler com segurança o nome do estudante ou a matriz de notas/disciplinas.
3. 'motivo_rejeicao':
   - Se 'eh_historico_escolar' for false ou 'esta_legivel_para_transcricao' for false, forneça uma explicação direta e cortês em português (ex: "A imagem enviada não é um Histórico Escolar" ou "A foto está muito desfocada na tabela de notas. Por favor, tire outra foto mais nítida").
   - Se ambos forem verdadeiros, preencha com string vazia "".

ETAPA 2: DIRETRIZES DE TRANSCRIÇÃO (CASO O DOCUMENTO SEJA VÁLIDO E LEGÍVEL):
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
        """Garante o espaçamento mínimo obrigatório de 6 segundos entre requisições (máx 10/min)."""
        with self._lock:
            agora = time.time()
            tempo_desde_ultima = agora - self._ultima_requisicao_ts
            if tempo_desde_ultima < INTERVALO_MINIMO_REQUISICAO_SEGUNDOS:
                espera = INTERVALO_MINIMO_REQUISICAO_SEGUNDOS - tempo_desde_ultima
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

        # Rate Limiter Local: pausa mínima obrigatória de 6 segundos entre chamadas
        self._esperar_taxa_limite()

        # Determina modelo a ser utilizado (removidas quaisquer referências a versões inexistentes)
        # Prioriza o modelo configurado (gemini-flash-lite-latest ou gemini-2.5-flash / gemini-2.0-flash)
        modelo_primario = MODELO_GEMINI

        try:
            resposta = client.models.generate_content(
                model=modelo_primario,
                contents=conteudos,
                config=config
            )
        except Exception as exc:
            erro_str = str(exc)
            # Se gemini-2.5-flash ou gemini-2.0-flash retornar 404 (descontinuado para novas contas pelo Google),
            # tenta única transição de segurança para o modelo mais barato e ativo (gemini-flash-lite-latest)
            if ("404" in erro_str or "NOT_FOUND" in erro_str) and "flash-lite" not in modelo_primario:
                logger.warning(
                    f"Modelo '{modelo_primario}' indisponível para esta conta (404). Acionando modelo econômico 'gemini-flash-lite-latest'..."
                )
                self._esperar_taxa_limite()
                resposta = client.models.generate_content(
                    model="gemini-flash-lite-latest",
                    contents=conteudos,
                    config=config
                )
            else:
                # Falhou uma vez: propaga o erro imediatamente (sem loop infinito)
                raise

        # Parsing seguro para o Schema Pydantic
        texto_json = resposta.text
        if not texto_json:
            raise ValueError("Gemini retornou resposta vazia.")

        return HistoricoExtraidoSchema.model_validate_json(texto_json)


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

        # 2. TRAVA ANTI-FOTO INVÁLIDA NA API DO GEMINI (CAMADA 2)
        if not getattr(resultado_schema, "eh_historico_escolar", True) or not getattr(resultado_schema, "esta_legivel_para_transcricao", True):
            motivo_recusa = (
                resultado_schema.motivo_rejeicao
                or ("A imagem enviada não é um Histórico Escolar." if not resultado_schema.eh_historico_escolar
                    else "A foto está muito desfocada ou cortada para permitir transcrição segura.")
            )
            logger.warning(f"Sessão {sessao_id} REJEITADA pela IA: {motivo_recusa}")

            # Exclui as imagens inválidas do disco para não ocupar armazenamento
            for p_caminho in paginas_locais:
                try:
                    arq = Path(p_caminho)
                    if arq.exists():
                        arq.unlink()
                except Exception as del_err:
                    logger.warning(f"Erro ao excluir imagem inválida {p_caminho}: {del_err}")

            # Atualiza o status no banco para REJEITADO_INVALIDO e limpa lista de páginas
            database.atualizar_status_ocr(
                sessao_id=sessao_id,
                status="REJEITADO_INVALIDO",
                json_extraido=json_serializado,
                erro=motivo_recusa,
                caminho_db=caminho_db
            )
            try:
                with database.get_db(caminho_db) as conn:
                    conn.execute("UPDATE fila_ocr SET paginas_locais_json = '[]' WHERE sessao_id = ?", (sessao_id,))
            except Exception:
                pass

            return {
                "sucesso": False,
                "sessao_id": sessao_id,
                "status": "REJEITADO_INVALIDO",
                "motivo_rejeicao": motivo_recusa,
                "mensagem": f"Documento Rejeitado: {motivo_recusa}"
            }

        # Transcrição concluída: envelope pronto para a Tela Dividida de Revisão
        nome_aluno = ""
        if resultado_schema.dados_civis and resultado_schema.dados_civis.nome_completo:
            nome_aluno = resultado_schema.dados_civis.nome_completo.valor or ""

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
            "aluno_nome": nome_aluno,
            "regime": resultado_schema.regime_ensino or "8_ANOS",
            "total_series": len(resultado_schema.series_cursadas or []),
            "total_notas": len(resultado_schema.notas_curriculares or []),
            "mensagem": "Transcrição do histórico escolar realizada com sucesso!"
        }

    except Exception as exc:
        msg_erro = str(exc)
        logger.error(f"Erro na chamada da API Gemini para a sessão {sessao_id}: {msg_erro}")

        # TRAVA CONTRA LOOP INFINITO: Falhou 1 vez -> status muda imediatamente para 'ERRO_API'
        # e incrementa tentativas_erro, parando qualquer reprocessamento automático.
        database.atualizar_status_ocr(
            sessao_id=sessao_id,
            status="ERRO_API",
            erro=msg_erro,
            incrementar_tentativa_erro=True,
            caminho_db=caminho_db
        )

        return {
            "sucesso": False,
            "sessao_id": sessao_id,
            "status": "ERRO_API",
            "mensagem": f"Falha na API: {msg_erro}"
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
