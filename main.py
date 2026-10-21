"""
Servidor Principal FastAPI — SGM-Históricos
===========================================
Servidor HTTP assíncrono para o ecossistema municipal de arquivo passivo:
- Escuta em host="0.0.0.0", port=8000 para acesso simultâneo desktop, rede local e mobile;
- Setup Wizard e Modo Camaleão (Escola Municipal vs Secretaria - SME);
- CRUD completo de ex-alunos, matriz curricular histórica e homologação/lacre;
- Sessões de escaneamento sem fio com QR Code automático e IP local Wi-Fi;
- Porteiro de qualidade OpenCV em tempo real para uploads mobile e scanner USB WIA;
- Fila de transcrição de IA (Gemini 2.5 Flash) e tela de revisão split-screen;
- Roteador Multi-Drive de 30 GB e sincronização híbrida com Supabase.
"""

import os
import io
import json
import socket
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import database
import security_hmac
import config_manager
import image_processor
import scanner_service
import ocr_queue_worker
import drive_router
import sync_worker


logger = logging.getLogger("sgm_historicos.main")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
IMAGENS_WEBP_DIR = BASE_DIR / "data_local" / "imagens_webp"
IMAGENS_WEBP_DIR.mkdir(parents=True, exist_ok=True)


# ==============================================================================
# DETECÇÃO DE IP DA REDE LOCAL (WI-FI / ETHERNET)
# ==============================================================================

def obter_ip_rede_local() -> str:
    """
    Identifica o endereço IP da máquina na rede local Wi-Fi ou cabo
    para conectar o smartphone ao servidor sem necessidade de digitar IP manual.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ==============================================================================
# CICLO DE VIDA DA APLICAÇÃO (LIFESPAN)
# ==============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicialização: Banco de dados, pastas e workers de background
    logger.info("Iniciando SGM-Históricos (Offline-First)...")
    database.init_db()
    
    # Inicia os workers em segundo plano
    ocr_queue_worker.iniciar_worker_ocr()
    sync_worker.iniciar_sync_worker()
    
    ip_local = obter_ip_rede_local()
    logger.info(f"Servidor disponível localmente em http://127.0.0.1:8000 e na rede Wi-Fi em http://{ip_local}:8000")
    
    yield
    
    # Encerramento gracioso
    logger.info("Finalizando workers em segundo plano...")
    ocr_queue_worker.parar_worker_ocr()
    sync_worker.parar_sync_worker()
    logger.info("Servidor finalizado com sucesso.")


app = FastAPI(
    title="SGM-Históricos — Arquivo Passivo Municipal",
    description="Sistema Municipal de Acervo Passivo e Histórico Escolar",
    version="1.0.0",
    lifespan=lifespan
)

# Garante inicialização e migrações do banco de dados SQLite local
database.init_db()

# Habilita CORS total para permitir que celulares na mesma rede Wi-Fi enviem fotos
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Monta arquivos estáticos (CSS, JS, imagens)
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ==============================================================================
# MODELOS PYDANTIC PARA REQUISIÇÕES
# ==============================================================================

class AtivacaoEscolaRequest(BaseModel):
    escola_id: int
    codigo_ativacao: str
    operador_nome: Optional[str] = "Secretaria Escolar"

class AtivacaoSmeRequest(BaseModel):
    senha_mestra: str
    operador_nome: Optional[str] = "Administrador SME"

class ResetarConfigRequest(BaseModel):
    senha_mestra: str

class SalvarHistoricoCompletoRequest(BaseModel):
    aluno: Dict[str, Any]
    vida_escolar: List[Dict[str, Any]] = []
    notas_curriculares: List[Dict[str, Any]] = []
    operador: Optional[str] = ""

class IniciarSessaoScanRequest(BaseModel):
    escola_id: Optional[int] = None
    origem_captura: Optional[str] = "MOBILE_QR"

class AprovarRevisaoIARequest(BaseModel):
    aluno: Dict[str, Any]
    vida_escolar: List[Dict[str, Any]] = []
    notas_curriculares: List[Dict[str, Any]] = []
    operador: Optional[str] = "Revisor IA"

class DesbloquearFichaRequest(BaseModel):
    senha_mestra: str
    motivo: str
    operador: Optional[str] = "Administrador SME"


# ==============================================================================
# 1. ROTAS: SETUP WIZARD E MODO CAMALEÃO (CONFIG_MANAGER)
# ==============================================================================

@app.get("/api/config/status")
def obter_status_instalacao():
    """Retorna o estado de ativação da máquina (Virgem, Escola ou SME)."""
    return {
        "configurado": config_manager.config_manager.is_configurado(),
        "configuracao": config_manager.config_manager.obter_configuracao(),
        "ip_local": obter_ip_rede_local(),
        "porta": 8000
    }

@app.get("/api/config/catalogo-escolas")
def obter_catalogo_escolas():
    """Retorna as 8 Escolas Municipais oficiais para o assistente de ativação."""
    return config_manager.config_manager.listar_escolas_catalogo()

@app.post("/api/config/ativar-escola")
def ativar_modo_escola(dados: AtivacaoEscolaRequest):
    """Ativa a máquina no Perfil Unidade Escolar (Opção A)."""
    try:
        cfg = config_manager.config_manager.configurar_modo_escola(
            escola_id=dados.escola_id,
            codigo_ativacao=dados.codigo_ativacao,
            operador_nome=dados.operador_nome or "Secretaria Escolar"
        )
        database.registrar_auditoria(
            acao="ATIVAR_MODO_ESCOLA",
            escola_id=dados.escola_id,
            detalhes={"escola": cfg.get("escola_nome"), "operador": dados.operador_nome}
        )
        return {"sucesso": True, "configuracao": cfg, "mensagem": f"Máquina configurada para {cfg['escola_nome']}!"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/config/ativar-sme")
def ativar_modo_sme(dados: AtivacaoSmeRequest):
    """Ativa a máquina no Perfil Secretaria Municipal de Educação (Opção B)."""
    try:
        cfg = config_manager.config_manager.configurar_modo_sme(
            senha_mestra=dados.senha_mestra,
            operador_nome=dados.operador_nome or "Administrador SME"
        )
        database.registrar_auditoria(
            acao="ATIVAR_MODO_SME",
            detalhes={"operador": dados.operador_nome}
        )
        return {"sucesso": True, "configuracao": cfg, "mensagem": "Máquina configurada como Secretaria de Educação (SME)!"}
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.post("/api/config/resetar")
def resetar_configuracao(dados: ResetarConfigRequest):
    """Restaura o modo virgem mediante fornecimento da Senha Mestra."""
    try:
        config_manager.config_manager.resetar_configuracao(dados.senha_mestra)
        database.registrar_auditoria(acao="RESETAR_CONFIGURACAO_MAQUINA")
        return {"sucesso": True, "mensagem": "Configuração da máquina resetada. Reiniciando assistente de ativação."}
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))


# ==============================================================================
# 2. ROTAS: ESCOLAS E PAINEL ESTATÍSTICO (SECRETARIA E UNIDADES)
# ==============================================================================

@app.get("/api/escolas")
def listar_escolas_sistema(apenas_ativas: bool = Query(False)):
    """Retorna a lista de escolas ativas e extintas cadastradas no SQLite."""
    return database.listar_escolas(apenas_ativas=apenas_ativas)

@app.get("/api/escolas/{escola_id}")
def obter_detalhes_escola(escola_id: int):
    escola = database.obter_escola(escola_id)
    if not escola:
        raise HTTPException(status_code=404, detail="Escola não encontrada.")
    return escola

@app.post("/api/escolas/extintas")
def cadastrar_escola_extinta(dados: Dict[str, Any] = Body(...)):
    """Cadastra escola rural extinta/nucleada (acervo recolhido pela SME)."""
    if not config_manager.config_manager.eh_modo_sme():
        raise HTTPException(status_code=403, detail="Apenas a Secretaria (SME) pode cadastrar escolas extintas.")
    if not dados.get("nome_oficial"):
        raise HTTPException(status_code=400, detail="O nome oficial da escola extinta é obrigatório.")
    
    escola_criada = database.cadastrar_escola_extinta(dados)
    database.registrar_auditoria(
        acao="CADASTRAR_ESCOLA_EXTINTA",
        escola_id=escola_criada["id"],
        detalhes={"nome": escola_criada["nome_oficial"]}
    )
    return {"sucesso": True, "escola": escola_criada}

@app.put("/api/escolas/{escola_id}")
def atualizar_dados_escola(escola_id: int, dados: Dict[str, Any] = Body(...)):
    """Atualiza dados regulatórios ou gestores da escola."""
    if not config_manager.config_manager.pode_editar_escola(escola_id):
        raise HTTPException(status_code=403, detail="Esta máquina não tem permissão para editar os dados desta escola.")
    atualizada = database.atualizar_escola(escola_id, dados)
    return {"sucesso": True, "escola": atualizada}

@app.get("/api/estatisticas/painel")
def obter_estatisticas_painel():
    """Gera o painel de estatísticas de digitalização e acervo."""
    escolas = database.listar_escolas()
    alunos_todos, total_alunos = database.listar_alunos(limite=10000)
    
    total_lacrados = sum(1 for a in alunos_todos if a.get("status_ficha") == "LACRADO_HOMOLOGADO")
    total_digitados = sum(1 for a in alunos_todos if a.get("status_ficha") == "DIGITADO")
    total_ia_rascunho = sum(1 for a in alunos_todos if a.get("status_ficha") == "RASCUNHO_IA")
    
    # Contagem por escola
    por_escola = {}
    for e in escolas:
        eid = e["id"]
        por_escola[eid] = {
            "id": eid,
            "nome": e["nome_oficial"],
            "drive_particao": e["drive_particao"],
            "total": sum(1 for a in alunos_todos if a.get("escola_id") == eid),
            "lacrados": sum(1 for a in alunos_todos if a.get("escola_id") == eid and a.get("status_ficha") == "LACRADO_HOMOLOGADO")
        }

    sessoes_ocr_pendentes = len(database.listar_sessoes_ocr(status="AGUARDANDO_REVISAO"))
    sessoes_ocr_processando = len(database.listar_sessoes_ocr(status="PROCESSANDO_IA"))

    return {
        "total_alunos_passivo": total_alunos,
        "total_lacrados_homologados": total_lacrados,
        "total_digitados": total_digitados,
        "total_rascunhos_ia": total_ia_rascunho,
        "sessoes_aguardando_revisao": sessoes_ocr_pendentes,
        "sessoes_processando_ia": sessoes_ocr_processando,
        "detalhes_por_escola": list(por_escola.values()),
        "status_drives": drive_router.drive_router.status_conexoes(),
        "status_sincronizacao": sync_worker.obter_status_sincronizacao()
    }


# ==============================================================================
# 3. ROTAS: ALUNOS E HISTÓRICO ESCOLAR COMPLETO (CRUD E HMAC)
# ==============================================================================

@app.get("/api/alunos")
def listar_alunos_consulta(
    escola_id: Optional[int] = Query(None),
    busca: Optional[str] = Query(None),
    status_ficha: Optional[str] = Query(None),
    limite: int = Query(50),
    offset: int = Query(0)
):
    """Lista ex-alunos com busca multifatorial e paginação."""
    # Se configurado em modo Escola, a busca pública exibe todas, mas a edição é restrita
    alunos, total = database.listar_alunos(
        escola_id=escola_id,
        busca=busca,
        status_ficha=status_ficha,
        limite=limite,
        offset=offset
    )
    return {
        "total": total,
        "limite": limite,
        "offset": offset,
        "alunos": alunos
    }

@app.get("/api/alunos/{uuid_aluno}")
def obter_aluno_por_uuid(uuid_aluno: str):
    """Retorna dados civis com verificação anti-adulteração HMAC."""
    aluno = database.obter_aluno(uuid_aluno, verificar_hmac=True)
    if not aluno:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")
    return aluno

@app.get("/api/alunos/{uuid_aluno}/historico-completo")
def obter_historico_completo(uuid_aluno: str):
    """
    Retorna o Histórico Escolar consolidado: aluno, escola, séries, notas
    e laudo de integridade criptográfica HMAC-SHA256.
    """
    historico = database.obter_historico_completo(uuid_aluno, verificar_hmac=True)
    if not historico:
        raise HTTPException(status_code=404, detail="Histórico escolar não encontrado.")
    return historico

@app.post("/api/alunos/historico-completo")
def salvar_historico_completo_endpoint(payload: SalvarHistoricoCompletoRequest):
    """
    Persistência atômica do Histórico Completo: aluno + vida escolar + notas.
    Calcula HMAC, atualiza SQLite e dispara sincronização em segundo plano.
    """
    escola_alvo = payload.aluno.get("escola_id")
    if not config_manager.config_manager.pode_editar_escola(escola_alvo):
        raise HTTPException(
            status_code=403,
            detail="Operação bloqueada: Esta máquina está configurada para outra escola municipal."
        )

    res = database.salvar_historico_completo(
        aluno_dados=payload.aluno,
        vida_escolar_itens=payload.vida_escolar,
        notas_itens=payload.notas_curriculares,
        operador=payload.operador or "Operador SGM"
    )

    # Dispara sincronização com o Supabase em segundo plano
    sync_worker.disparar_sincronizacao_imediata()

    return {
        "sucesso": True,
        "aluno_uuid": res["aluno"]["uuid"],
        "codigo_autenticidade": res["aluno"]["codigo_autenticidade"],
        "mensagem": "Histórico Escolar salvo e assinado com sucesso com HMAC-SHA256!"
    }

@app.delete("/api/alunos/{uuid_aluno}")
def excluir_aluno(uuid_aluno: str, operador: str = Query("Operador")):
    """Exclui aluno e registros vinculados em cascata."""
    aluno = database.obter_aluno(uuid_aluno)
    if not aluno:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    if not config_manager.config_manager.pode_editar_escola(aluno["escola_id"]):
        raise HTTPException(status_code=403, detail="Sem permissão para excluir registros desta escola.")

    if aluno.get("status_ficha") == "LACRADO_HOMOLOGADO" and not config_manager.config_manager.eh_modo_sme():
        raise HTTPException(status_code=400, detail="Esta ficha está homologada/lacrada e só pode ser excluída pela SME.")

    sucesso = database.excluir_aluno(uuid_aluno, operador=operador)
    return {"sucesso": sucesso, "mensagem": "Registro de ex-aluno excluído com sucesso."}

@app.post("/api/alunos/{uuid_aluno}/homologar-lacrar")
def homologar_lacrar_ficha(uuid_aluno: str, operador: str = Query("Secretário(a)")):
    """Homologa e lacra a ficha contra edições acidentais."""
    aluno = database.obter_aluno(uuid_aluno)
    if not aluno:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    if not config_manager.config_manager.pode_editar_escola(aluno["escola_id"]):
        raise HTTPException(status_code=403, detail="Sem permissão para homologar fichas desta escola.")

    up = database.atualizar_status_ficha(uuid_aluno, "LACRADO_HOMOLOGADO", operador=operador)
    database.registrar_auditoria(
        acao="HOMOLOGAR_LACRAR_FICHA",
        escola_id=aluno["escola_id"],
        aluno_uuid=uuid_aluno,
        detalhes={"operador": operador}
    )
    sync_worker.disparar_sincronizacao_imediata()
    return {"sucesso": True, "status": "LACRADO_HOMOLOGADO", "mensagem": "Ficha homologada e lacrada oficialmente!"}

@app.post("/api/alunos/{uuid_aluno}/desbloquear")
def desbloquear_ficha_lacrada(uuid_aluno: str, payload: DesbloquearFichaRequest):
    """Desbloqueia uma ficha lacrada mediante autorização e justificativa auditada."""
    if not config_manager.config_manager.verificar_senha_mestra(payload.senha_mestra):
        raise HTTPException(status_code=401, detail="Senha Mestra incorreta. Apenas a SME pode desbloquear fichas lacradas.")

    aluno = database.obter_aluno(uuid_aluno)
    if not aluno:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")

    up = database.atualizar_status_ficha(uuid_aluno, "DIGITADO", operador=payload.operador)
    database.registrar_auditoria(
        acao="DESBLOQUEAR_FICHA_LACRADA",
        escola_id=aluno["escola_id"],
        aluno_uuid=uuid_aluno,
        detalhes={"motivo": payload.motivo, "operador": payload.operador}
    )
    return {"sucesso": True, "status": "DIGITADO", "mensagem": "Ficha desbloqueada para revisão."}

@app.get("/api/alunos/verificar/{codigo_autenticidade}")
def verificar_autenticidade_documento(codigo_autenticidade: str):
    """Consulta pública e rápida de autenticidade (para leitura via QR Code no histórico impresso)."""
    aluno = database.obter_aluno_por_codigo(codigo_autenticidade, verificar_hmac=True)
    if not aluno:
        raise HTTPException(status_code=404, detail="Código de autenticidade não encontrado neste município.")

    escola = database.obter_escola(aluno["escola_id"])
    return {
        "autentico": aluno["hmac_valido"],
        "codigo": aluno["codigo_autenticidade"],
        "nome_aluno": aluno["nome_completo"],
        "escola": escola["nome_oficial"] if escola else "Escola Municipal",
        "regime_ensino": aluno["regime_ensino"],
        "status_ficha": aluno["status_ficha"],
        "data_emissao_utc": aluno["atualizado_em"],
        "aviso_segurança": "Documento íntegro e assinado digitalmente pelo SGM-Históricos." if aluno["hmac_valido"] else "ALERTA: Adulteração detectada no registro original!"
    }


# ==============================================================================
# 4. ROTAS: SESSÕES DE DIGITALIZAÇÃO, QR CODE E MOBILE SCANNER
# ==============================================================================

@app.post("/api/scan/iniciar-sessao")
def iniciar_sessao_digitalizacao(dados: IniciarSessaoScanRequest):
    """
    Cria uma sessão de digitalização para um ex-aluno e gera o link e QR Code
    apontando para o IP da rede local Wi-Fi.
    """
    escola_id = dados.escola_id or config_manager.config_manager.obter_escola_id() or 1
    sessao = database.criar_sessao_ocr(escola_id=escola_id, origem_captura=dados.origem_captura or "MOBILE_QR")
    
    ip_local = obter_ip_rede_local()
    sessao_id = sessao["sessao_id"]
    mobile_url = f"http://{ip_local}:8000/mobile/scan/{sessao_id}"
    
    # Gera QR Code Base64
    import qrcode
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(mobile_url)
    qr.make(fit=True)
    img_qr = qr.make_image(fill_color="black", back_color="white")
    
    buf = io.BytesIO()
    img_qr.save(buf, format="PNG")
    import base64
    qr_b64 = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"

    return {
        "sucesso": True,
        "sessao_id": sessao_id,
        "escola_id": escola_id,
        "mobile_url": mobile_url,
        "qr_code_base64": qr_b64,
        "ip_local": ip_local
    }

@app.get("/api/scan/{sessao_id}/qrcode")
def obter_qrcode_imagem(sessao_id: str):
    """Retorna o PNG bruto do QR Code de conexão sem fio."""
    ip_local = obter_ip_rede_local()
    mobile_url = f"http://{ip_local}:8000/mobile/scan/{sessao_id}"
    
    import qrcode
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(mobile_url)
    qr.make(fit=True)
    img_qr = qr.make_image(fill_color="black", back_color="white")
    
    buf = io.BytesIO()
    img_qr.save(buf, format="PNG")
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="image/png")

@app.get("/mobile/scan/{sessao_id}")
def servir_pagina_mobile_scan(sessao_id: str):
    """Serve a interface mobile ultra-leve para a câmera do celular."""
    caminho_html = STATIC_DIR / "mobile_scan.html"
    if not caminho_html.exists():
        raise HTTPException(status_code=404, detail="Interface mobile_scan.html não encontrada.")
    return FileResponse(str(caminho_html), media_type="text/html")

@app.post("/api/scan/{sessao_id}/upload-pagina")
async def upload_pagina_mobile(sessao_id: str, arquivo: UploadFile = File(...)):
    """
    Recebe a foto enviada pelo celular, submete instantaneamente ao Porteiro de
    Qualidade OpenCV (anti-tremido e iluminação), aplica CLAHE e comprime para WebP.
    """
    sessao = database.obter_sessao_ocr(sessao_id)
    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão de escaneamento inválida ou expirada.")

    conteudo_bytes = await arquivo.read()
    if not conteudo_bytes:
        raise HTTPException(status_code=400, detail="Arquivo vazio recebido.")

    try:
        paginas_atuais = json.loads(sessao.get("paginas_locais_json") or "[]")
        numero_pagina = len(paginas_atuais) + 1

        resultado_proc = image_processor.processar_pagina_documento(
            origem=conteudo_bytes,
            sessao_id=sessao_id,
            numero_pagina=numero_pagina,
            verificar_qualidade=True
        )

        database.adicionar_pagina_ocr(sessao_id, resultado_proc["caminho_webp"])

        return {
            "sucesso": True,
            "pagina_numero": numero_pagina,
            "total_paginas": numero_pagina,
            "score_nitidez": resultado_proc["score_nitidez"],
            "tamanho_kb": resultado_proc["tamanho_kb"],
            "caminho_preview": f"/api/scan/imagem-preview?caminho={Path(resultado_proc['caminho_webp']).name}",
            "mensagem": f"Página {numero_pagina} aprovada com sucesso pelo Porteiro OpenCV!"
        }

    except image_processor.QualidadeInsuficienteError as qerr:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=qerr.motivo
        )
    except Exception as e:
        logger.error(f"Erro no processamento da página: {e}")
        raise HTTPException(status_code=500, detail=f"Erro interno no processamento da foto: {e}")

@app.post("/api/scan/{sessao_id}/scanner-pc")
def capturar_via_scanner_usb(sessao_id: str):
    """Aciona o scanner de mesa USB conectado ao computador via WIA."""
    res = scanner_service.digitalizar_pagina_wia(sessao_id=sessao_id)
    if not res.get("sucesso"):
        raise HTTPException(status_code=400, detail=res.get("mensagem"))
    return res

@app.post("/api/scan/{sessao_id}/finalizar")
def finalizar_sessao_scan(sessao_id: str):
    """
    Conclui o envelope de captura daquele aluno e o coloca em 'PENDENTE_IA'
    para o worker transcrever com o Gemini 2.5 Flash.
    """
    sessao = database.obter_sessao_ocr(sessao_id)
    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")

    paginas = json.loads(sessao.get("paginas_locais_json") or "[]")
    if not paginas:
        raise HTTPException(status_code=400, detail="Nenhuma página aprovada nesta sessão.")

    up = database.atualizar_status_ocr(sessao_id, "PENDENTE_IA")
    return {
        "sucesso": True,
        "sessao_id": sessao_id,
        "status": "PENDENTE_IA",
        "total_paginas": len(paginas),
        "mensagem": "Envelope enviado com sucesso para a fila de Inteligência Artificial!"
    }

@app.get("/api/scan/{sessao_id}/status")
def obter_status_sessao_scan(sessao_id: str):
    """Consulta o status da sessão e páginas capturadas."""
    sessao = database.obter_sessao_ocr(sessao_id)
    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")

    paginas = json.loads(sessao.get("paginas_locais_json") or "[]")
    return {
        "sessao_id": sessao["sessao_id"],
        "status": sessao["status"],
        "total_paginas": len(paginas),
        "paginas": paginas,
        "json_extraido_ia": sessao.get("json_extraido_ia"),
        "ultimo_erro": sessao.get("ultimo_erro")
    }

@app.get("/api/scan/imagem-preview")
def obter_preview_imagem_webp(caminho: str = Query(...)):
    """Retorna a imagem WebP para visualização na tela do PC ou miniatura mobile."""
    nome_seguro = Path(caminho).name
    caminho_real = IMAGENS_WEBP_DIR / nome_seguro
    if not caminho_real.exists():
        # Tenta pelo caminho completo fornecido se for seguro
        if Path(caminho).exists() and str(BASE_DIR) in str(Path(caminho).resolve()):
            caminho_real = Path(caminho)
        else:
            raise HTTPException(status_code=404, detail="Imagem não encontrada.")
    return FileResponse(str(caminho_real), media_type="image/webp")


# ==============================================================================
# 5. ROTAS: FILA DE REVISÃO IA (SPLIT-SCREEN)
# ==============================================================================

@app.get("/api/ocr/fila")
def listar_fila_ocr_revisao():
    """Lista as sessões prontas para a tela de revisão Split-Screen."""
    aguardando = database.listar_sessoes_ocr(status="AGUARDANDO_REVISAO")
    processando = database.listar_sessoes_ocr(status="PROCESSANDO_IA")
    pendentes = database.listar_sessoes_ocr(status="PENDENTE_IA")
    erros = database.listar_sessoes_ocr(status="ERRO_IA")
    
    return {
        "aguardando_revisao": aguardando,
        "processando_ia": processando,
        "pendentes_ia": pendentes,
        "erros_ia": erros,
        "total_para_revisar": len(aguardando)
    }

@app.get("/api/ocr/sessao/{sessao_id}")
def obter_dados_revisao_split(sessao_id: str):
    """Retorna os dados da sessão e o JSON estruturado para a tela dividida."""
    sessao = database.obter_sessao_ocr(sessao_id)
    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")

    paginas = json.loads(sessao.get("paginas_locais_json") or "[]")
    json_ia = None
    if sessao.get("json_extraido_ia"):
        try:
            json_ia = json.loads(sessao["json_extraido_ia"])
        except Exception:
            json_ia = None

    return {
        "sessao_id": sessao["sessao_id"],
        "escola_id": sessao["escola_id"],
        "status": sessao["status"],
        "paginas": paginas,
        "dados_ia": json_ia
    }

@app.post("/api/ocr/sessao/{sessao_id}/aprovar-e-salvar")
def aprovar_e_salvar_revisao(sessao_id: str, payload: AprovarRevisaoIARequest):
    """
    Aprova a revisão humana da tela dividida, grava os dados oficiais nas tabelas
    definitivas com HMAC e marca a sessão como 'CONCLUIDO'.
    """
    res = database.salvar_historico_completo(
        aluno_dados=payload.aluno,
        vida_escolar_itens=payload.vida_escolar,
        notas_itens=payload.notas_curriculares,
        operador=payload.operador or "Revisor Split-Screen"
    )

    database.atualizar_status_ocr(sessao_id, "CONCLUIDO")
    sync_worker.disparar_sincronizacao_imediata()

    return {
        "sucesso": True,
        "aluno_uuid": res["aluno"]["uuid"],
        "codigo_autenticidade": res["aluno"]["codigo_autenticidade"],
        "mensagem": "Histórico escolar revisado, aprovado e registrado oficialmente!"
    }


# ==============================================================================
# 6. ROTAS: SINCRONIZAÇÃO E MULTI-DRIVE DE 30 GB
# ==============================================================================

@app.get("/api/sync/status")
def status_sincronizacao():
    return sync_worker.obter_status_sincronizacao()

@app.post("/api/sync/executar")
def executar_sincronizacao_manual():
    """Gatilho manual: varre a outbox e sincroniza com o Supabase."""
    return sync_worker.executar_sincronizacao_completa()

@app.get("/api/drive/status")
def status_multi_drive():
    return drive_router.drive_router.status_conexoes()

@app.post("/api/backup/gerar")
def gerar_backup_criptografado(escola_id: Optional[int] = Query(None)):
    """Gera cópia de segurança .db.enc com Fernet e faz upload no Google Drive."""
    return drive_router.drive_router.gerar_e_enviar_backup(escola_id=escola_id)


# ==============================================================================
# 7. ROTAS: AUDITORIA E PÁGINAS PRINCIPAIS
# ==============================================================================

@app.get("/api/auditoria")
def listar_auditoria(escola_id: Optional[int] = Query(None), limite: int = Query(100)):
    return database.listar_auditoria(escola_id=escola_id, limite=limite)

@app.get("/")
def raiz_aplicacao():
    """Serve a aplicação desktop SPA se existir, ou mensagem inicial."""
    index_html = STATIC_DIR / "index.html"
    if index_html.exists():
        return FileResponse(str(index_html))
    return {
        "sistema": "SGM-Históricos — Acervo Passivo Municipal",
        "status": "Online",
        "ip_local": obter_ip_rede_local(),
        "porta": 8000,
        "documentacao_api": "/docs"
    }

@app.get("/impressao/{uuid_aluno}")
def pagina_impressao_oficial(uuid_aluno: str):
    """Serve a página de impressão A4 do histórico escolar."""
    template_html = STATIC_DIR / "impressao.html"
    if not template_html.exists():
        template_html = STATIC_DIR / "impressao_a4.html"
    if template_html.exists():
        return FileResponse(str(template_html))
    raise HTTPException(status_code=404, detail="Template de impressão não encontrado.")
