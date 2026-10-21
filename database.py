"""
Módulo de Banco de Dados Local SQLite (SGM-Históricos)
======================================================
Implementa o banco de dados SQLite local em './data_local/acervo_local.db'
com suporte a UUIDv4 em todas as tabelas de negócio, chaves estrangeiras ativas,
modo WAL (Write-Ahead Logging) para alta concorrência e integridade HMAC-SHA256.

Tabelas Implementadas (Seção 5 do SPEC.md):
  1. escolas (Pré-populada com as 8 Escolas Municipais: 1 a 4 no DRIVE_A, 5 a 8 no DRIVE_B)
  2. alunos (Registros civis e localização física no arquivo passivo/morto)
  3. vida_escolar (Matriz de séries/anos cursados, cargas horárias e resultados)
  4. notas_curriculares (Notas/conceitos por disciplina e série com assinatura HMAC)
  5. fila_ocr (Envelopes de digitalização, páginas e extrações por IA Gemini)
  6. auditoria_logs (Rastreabilidade completa de todas as ações no sistema)
"""

import sqlite3
import json
import uuid
import secrets
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple, Union

import security_hmac


# Caminho padrão do banco de dados local
DB_DIR = Path(__file__).resolve().parent / "data_local"
DB_PATH = DB_DIR / "acervo_local.db"


def obter_caminho_db(caminho_customizado: Optional[Union[str, Path]] = None) -> Path:
    """Retorna o caminho do banco de dados, assegurando a criação da pasta pai."""
    caminho = Path(caminho_customizado) if caminho_customizado else DB_PATH
    caminho.parent.mkdir(parents=True, exist_ok=True)
    return caminho


@contextmanager
def get_db(caminho_db: Optional[Union[str, Path]] = None):
    """
    Context manager para conexões SQLite.
    Habilita Foreign Keys, WAL mode e row_factory baseada em nomes de colunas.
    Garante commit automático em caso de sucesso e rollback em erro.
    """
    path = obter_caminho_db(caminho_db)
    conn = sqlite3.connect(str(path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    """Converte um sqlite3.Row em dicionário Python padrão."""
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    """Converte uma lista de sqlite3.Row em lista de dicionários."""
    return [dict(r) for r in rows]


# ==============================================================================
# ESQUEMA DE CRIAÇÃO DAS TABELAS (DDL)
# ==============================================================================

DDL_ESCOLAS = """
CREATE TABLE IF NOT EXISTS escolas (
    id INTEGER PRIMARY KEY,
    nome_oficial TEXT NOT NULL,
    codigo_inep TEXT,
    endereco TEXT,
    bairro TEXT,
    municipio TEXT DEFAULT 'JANDAÍRA',
    uf TEXT DEFAULT 'RN',
    municipio_uf TEXT DEFAULT 'Jandaíra - RN',
    diretor_nome TEXT,
    diretor_registro TEXT,
    secretario_nome TEXT,
    secretario_registro TEXT,
    extinta INTEGER DEFAULT 0,
    observacao_acervo_extinta TEXT,
    drive_particao TEXT NOT NULL CHECK(drive_particao IN ('DRIVE_A', 'DRIVE_B')),
    brasao_base64 TEXT
);
"""

DDL_ALUNOS = """
CREATE TABLE IF NOT EXISTS alunos (
    uuid TEXT PRIMARY KEY,
    escola_id INTEGER NOT NULL,
    nome_completo TEXT NOT NULL,
    matricula TEXT,
    data_nascimento TEXT,
    naturalidade_municipio TEXT,
    naturalidade_uf TEXT,
    nacionalidade TEXT DEFAULT 'BRASILEIRA',
    filiacao_1 TEXT,
    filiacao_2 TEXT,
    cpf TEXT,
    rg_numero TEXT,
    rg_orgao_uf TEXT,
    certidao_tipo TEXT,
    certidao_termo TEXT,
    certidao_livro TEXT,
    certidao_folha TEXT,
    certidao_cartorio TEXT,
    certidao_municipio_uf TEXT,
    regime_ensino TEXT DEFAULT '9_ANOS',
    observacoes_historico TEXT,
    status_ficha TEXT DEFAULT 'RASCUNHO_IA',
    codigo_autenticidade TEXT UNIQUE,
    paginas_webp_json TEXT DEFAULT '[]',
    assinatura_hmac TEXT,
    atualizado_em TEXT NOT NULL,
    sincronizado INTEGER DEFAULT 0,
    FOREIGN KEY (escola_id) REFERENCES escolas(id)
);
"""

DDL_VIDA_ESCOLAR = """
CREATE TABLE IF NOT EXISTS vida_escolar (
    uuid TEXT PRIMARY KEY,
    aluno_uuid TEXT NOT NULL,
    ordem_coluna INTEGER NOT NULL,
    label_serie TEXT NOT NULL,
    ano_letivo TEXT,
    escola_nome TEXT,
    escola_municipio_uf TEXT,
    dias_letivos TEXT,
    carga_horaria_total TEXT,
    frequencia_percentual TEXT,
    resultado_final TEXT,
    atualizado_em TEXT NOT NULL,
    sincronizado INTEGER DEFAULT 0,
    FOREIGN KEY (aluno_uuid) REFERENCES alunos(uuid) ON DELETE CASCADE
);
"""

DDL_NOTAS_CURRICULARES = """
CREATE TABLE IF NOT EXISTS notas_curriculares (
    uuid TEXT PRIMARY KEY,
    aluno_uuid TEXT NOT NULL,
    ordem_coluna INTEGER NOT NULL,
    categoria TEXT NOT NULL CHECK(categoria IN ('BASE_COMUM', 'DIVERSIFICADA')),
    ordem_disciplina INTEGER NOT NULL,
    disciplina_nome TEXT NOT NULL,
    nota_ou_conceito TEXT,
    carga_horaria_disciplina TEXT,
    assinatura_hmac TEXT,
    atualizado_em TEXT NOT NULL,
    sincronizado INTEGER DEFAULT 0,
    FOREIGN KEY (aluno_uuid) REFERENCES alunos(uuid) ON DELETE CASCADE
);
"""

DDL_FILA_OCR = """
CREATE TABLE IF NOT EXISTS fila_ocr (
    sessao_id TEXT PRIMARY KEY,
    escola_id INTEGER,
    status TEXT DEFAULT 'CAPTURANDO' CHECK(status IN ('CAPTURANDO', 'PENDENTE_IA', 'PROCESSANDO_IA', 'AGUARDANDO_REVISAO', 'CONCLUIDO', 'ERRO_IA', 'REJEITADO_INVALIDO')),
    origem_captura TEXT CHECK(origem_captura IN ('MOBILE_QR', 'SCANNER_PC')),
    paginas_locais_json TEXT DEFAULT '[]',
    json_extraido_ia TEXT,
    tentativas_ia INTEGER DEFAULT 0,
    ultimo_erro TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
);
"""

DDL_AUDITORIA_LOGS = """
CREATE TABLE IF NOT EXISTS auditoria_logs (
    uuid TEXT PRIMARY KEY,
    escola_id INTEGER,
    aluno_uuid TEXT,
    acao TEXT NOT NULL,
    detalhes_antes_depois TEXT,
    criado_em TEXT NOT NULL,
    sincronizado INTEGER DEFAULT 0
);
"""

INDICES_SQL = """
CREATE INDEX IF NOT EXISTS idx_alunos_escola ON alunos(escola_id);
CREATE INDEX IF NOT EXISTS idx_alunos_nome ON alunos(nome_completo);
CREATE INDEX IF NOT EXISTS idx_alunos_autenticidade ON alunos(codigo_autenticidade);
CREATE INDEX IF NOT EXISTS idx_alunos_sincronizado ON alunos(sincronizado);
CREATE INDEX IF NOT EXISTS idx_vida_escolar_aluno ON vida_escolar(aluno_uuid);
CREATE INDEX IF NOT EXISTS idx_notas_aluno ON notas_curriculares(aluno_uuid);
CREATE INDEX IF NOT EXISTS idx_fila_ocr_status ON fila_ocr(status);
CREATE INDEX IF NOT EXISTS idx_auditoria_aluno ON auditoria_logs(aluno_uuid);
CREATE INDEX IF NOT EXISTS idx_auditoria_escola ON auditoria_logs(escola_id);
"""

# ==============================================================================
# PRÉ-CADASTRAMENTO DAS 8 ESCOLAS MUNICIPAIS (DRIVE_A e DRIVE_B)
# ==============================================================================

ESCOLAS_INICIAIS = [
    {
        "id": 1,
        "nome_oficial": "Escola Municipal de Ensino Fundamental de Jandaíra",
        "codigo_inep": "24001001",
        "endereco": "Rua Principal, 100",
        "bairro": "Centro",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Diretor(a) Escolar",
        "diretor_registro": "DIR-001/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-001/RN",
        "extinta": 0,
        "observacao_acervo_extinta": None,
        "drive_particao": "DRIVE_A"
    },
    {
        "id": 2,
        "nome_oficial": "Escola Municipal Monteiro Lobato",
        "codigo_inep": "24001002",
        "endereco": "Avenida Central, 250",
        "bairro": "Alto da Colina",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Diretor(a) Escolar",
        "diretor_registro": "DIR-002/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-002/RN",
        "extinta": 0,
        "observacao_acervo_extinta": None,
        "drive_particao": "DRIVE_A"
    },
    {
        "id": 3,
        "nome_oficial": "Escola Municipal Professora Maria de Lourdes",
        "codigo_inep": "24001003",
        "endereco": "Rua do Saber, 45",
        "bairro": "Belo Horizonte",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Diretor(a) Escolar",
        "diretor_registro": "DIR-003/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-003/RN",
        "extinta": 0,
        "observacao_acervo_extinta": None,
        "drive_particao": "DRIVE_A"
    },
    {
        "id": 4,
        "nome_oficial": "Escola Municipal Rural São José",
        "codigo_inep": "24001004",
        "endereco": "Comunidade São José, s/n",
        "bairro": "Zona Rural",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Diretor(a) Escolar",
        "diretor_registro": "DIR-004/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-004/RN",
        "extinta": 0,
        "observacao_acervo_extinta": None,
        "drive_particao": "DRIVE_A"
    },
    {
        "id": 5,
        "nome_oficial": "Escola Municipal Santa Luzia",
        "codigo_inep": "24001005",
        "endereco": "Assentamento Santa Luzia, s/n",
        "bairro": "Zona Rural",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Diretor(a) Escolar",
        "diretor_registro": "DIR-005/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-005/RN",
        "extinta": 0,
        "observacao_acervo_extinta": None,
        "drive_particao": "DRIVE_B"
    },
    {
        "id": 6,
        "nome_oficial": "Escola Municipal Padre João Maria",
        "codigo_inep": "24001006",
        "endereco": "Rua da Paz, 78",
        "bairro": "Centro",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Diretor(a) Escolar",
        "diretor_registro": "DIR-006/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-006/RN",
        "extinta": 0,
        "observacao_acervo_extinta": None,
        "drive_particao": "DRIVE_B"
    },
    {
        "id": 7,
        "nome_oficial": "Escola Municipal Boa Vista (Extinta)",
        "codigo_inep": "24001007",
        "endereco": "Comunidade Boa Vista",
        "bairro": "Zona Rural",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Responsável SME",
        "diretor_registro": "DIR-SME/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-SME/RN",
        "extinta": 1,
        "observacao_acervo_extinta": "Acervo sob custódia da SMEJ-Jandaíra/RN.",
        "drive_particao": "DRIVE_B"
    },
    {
        "id": 8,
        "nome_oficial": "Escola Reunida Rural Tubibal (Extinta)",
        "codigo_inep": "24001008",
        "endereco": "Comunidade Tubibal",
        "bairro": "Zona Rural",
        "municipio": "JANDAÍRA",
        "uf": "RN",
        "municipio_uf": "Jandaíra - RN",
        "diretor_nome": "Responsável SME",
        "diretor_registro": "DIR-SME/RN",
        "secretario_nome": "Responsável pela Informação",
        "secretario_registro": "SEC-SME/RN",
        "extinta": 1,
        "observacao_acervo_extinta": "Acervo sob custódia e escrituração da SMEJ-Jandaíra/RN.",
        "drive_particao": "DRIVE_B"
    }
]


def init_db(caminho_db: Optional[Union[str, Path]] = None) -> Path:
    """
    Inicializa o banco de dados SQLite local, criando todas as 6 tabelas,
    índices de performance e garantindo que as 8 Escolas Municipais estejam
    devidamente pré-cadastradas no catálogo.
    """
    path = obter_caminho_db(caminho_db)
    with get_db(path) as conn:
        # 1. Criação das Tabelas
        conn.execute(DDL_ESCOLAS)
        conn.execute(DDL_ALUNOS)
        conn.execute(DDL_VIDA_ESCOLAR)
        conn.execute(DDL_NOTAS_CURRICULARES)
        conn.execute(DDL_FILA_OCR)
        conn.execute(DDL_AUDITORIA_LOGS)
        
        # 2. Criação dos Índices
        conn.executescript(INDICES_SQL)

        # 3. Migração segura de colunas novas se a tabela já existia
        colunas_escolas = [c["name"] for c in conn.execute("PRAGMA table_info(escolas)").fetchall()]
        if "bairro" not in colunas_escolas:
            conn.execute("ALTER TABLE escolas ADD COLUMN bairro TEXT")
        if "municipio" not in colunas_escolas:
            conn.execute("ALTER TABLE escolas ADD COLUMN municipio TEXT DEFAULT 'JANDAÍRA'")
        if "uf" not in colunas_escolas:
            conn.execute("ALTER TABLE escolas ADD COLUMN uf TEXT DEFAULT 'RN'")

        colunas_alunos = [c["name"] for c in conn.execute("PRAGMA table_info(alunos)").fetchall()]
        if "matricula" not in colunas_alunos:
            conn.execute("ALTER TABLE alunos ADD COLUMN matricula TEXT")

        # Migração da tabela fila_ocr para suportar REJEITADO_INVALIDO no CHECK
        schema_ocr = conn.execute("SELECT sql FROM sqlite_master WHERE name='fila_ocr'").fetchone()
        if schema_ocr and "REJEITADO_INVALIDO" not in schema_ocr[0]:
            conn.execute("ALTER TABLE fila_ocr RENAME TO fila_ocr_migracao_temp")
            conn.execute(DDL_FILA_OCR)
            conn.execute("""
                INSERT INTO fila_ocr (
                    sessao_id, escola_id, status, origem_captura, paginas_locais_json,
                    json_extraido_ia, tentativas_ia, ultimo_erro, criado_em, atualizado_em
                )
                SELECT
                    sessao_id, escola_id, status, origem_captura, paginas_locais_json,
                    json_extraido_ia, tentativas_ia, ultimo_erro, criado_em, atualizado_em
                FROM fila_ocr_migracao_temp
            """)
            conn.execute("DROP TABLE fila_ocr_migracao_temp")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_fila_ocr_status ON fila_ocr(status)")
        
        # 4. Pré-cadastro e atualização das Escolas Municipais Oficiais
        for esc in ESCOLAS_INICIAIS:
            conn.execute(
                """
                INSERT OR IGNORE INTO escolas (
                    id, nome_oficial, codigo_inep, endereco, bairro, municipio, uf, municipio_uf,
                    diretor_nome, diretor_registro, secretario_nome, secretario_registro, extinta,
                    observacao_acervo_extinta, drive_particao, brasao_base64
                ) VALUES (
                    :id, :nome_oficial, :codigo_inep, :endereco, :bairro, :municipio, :uf, :municipio_uf,
                    :diretor_nome, :diretor_registro, :secretario_nome, :secretario_registro, :extinta,
                    :observacao_acervo_extinta, :drive_particao, NULL
                )
                """,
                esc
            )
            # Atualiza dados institucionais limpos (bairro, município, uf, endereço)
            conn.execute(
                """
                UPDATE escolas SET
                    nome_oficial = :nome_oficial,
                    codigo_inep = :codigo_inep,
                    endereco = :endereco,
                    bairro = :bairro,
                    municipio = :municipio,
                    uf = :uf,
                    municipio_uf = :municipio_uf,
                    drive_particao = :drive_particao
                WHERE id = :id AND extinta = 0
                """,
                esc
            )
    return path


# ==============================================================================
# FUNÇÕES UTILITÁRIAS
# ==============================================================================

def data_hora_utc_iso() -> str:
    """Retorna timestamp ISO 8601 UTC corrente."""
    return datetime.now(timezone.utc).isoformat()


def novo_uuid() -> str:
    """Gera um identificador único universal UUIDv4 em string."""
    return str(uuid.uuid4())


def gerar_codigo_autenticidade(ano: int = 2026, caminho_db: Optional[Union[str, Path]] = None) -> str:
    """
    Gera um código de autenticidade no formato oficial 'VER-2026-X89F'
    e garante que seja único no banco de dados.
    """
    caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem I, O, 0, 1 para evitar ambiguidade
    tentativas = 0
    while tentativas < 50:
        sufixo = "".join(secrets.choice(caracteres) for _ in range(4))
        codigo = f"VER-{ano}-{sufixo}"
        with get_db(caminho_db) as conn:
            cur = conn.execute("SELECT 1 FROM alunos WHERE codigo_autenticidade = ?", (codigo,))
            if not cur.fetchone():
                return codigo
        tentativas += 1
    return f"VER-{ano}-{secrets.token_hex(3).upper()}"


# ==============================================================================
# CRUD: AUDITORIA LOGS
# ==============================================================================

def registrar_auditoria(
    acao: str,
    escola_id: Optional[int] = None,
    aluno_uuid: Optional[str] = None,
    detalhes: Any = None,
    operador: str = "",
    conn: Optional[sqlite3.Connection] = None,
    caminho_db: Optional[Union[str, Path]] = None
) -> str:
    """Registra uma entrada de auditoria imutável no sistema."""
    uid = novo_uuid()
    agora = data_hora_utc_iso()
    
    detalhes_dict = {}
    if isinstance(detalhes, dict):
        detalhes_dict = dict(detalhes)
    elif detalhes is not None:
        detalhes_dict = {"detalhe": str(detalhes)}
    if operador:
        detalhes_dict["operador"] = operador
        
    detalhes_json = json.dumps(detalhes_dict, ensure_ascii=False)

    sql = """
    INSERT INTO auditoria_logs (uuid, escola_id, aluno_uuid, acao, detalhes_antes_depois, criado_em, sincronizado)
    VALUES (?, ?, ?, ?, ?, ?, 0)
    """

    if conn is not None:
        conn.execute(sql, (uid, escola_id, aluno_uuid, acao, detalhes_json, agora))
    else:
        with get_db(caminho_db) as c:
            c.execute(sql, (uid, escola_id, aluno_uuid, acao, detalhes_json, agora))
    return uid


def listar_auditoria(
    escola_id: Optional[int] = None,
    aluno_uuid: Optional[str] = None,
    limite: int = 100,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """Consulta o histórico de logs de auditoria com filtros opcionais."""
    query = "SELECT * FROM auditoria_logs WHERE 1=1"
    params: List[Any] = []
    if escola_id is not None:
        query += " AND escola_id = ?"
        params.append(escola_id)
    if aluno_uuid is not None:
        query += " AND aluno_uuid = ?"
        params.append(aluno_uuid)
    query += " ORDER BY criado_em DESC LIMIT ?"
    params.append(limite)

    with get_db(caminho_db) as conn:
        rows = conn.execute(query, params).fetchall()
        return rows_to_list(rows)


# ==============================================================================
# CRUD: ESCOLAS
# ==============================================================================

def listar_escolas(
    apenas_ativas: bool = False,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """Lista todas as escolas cadastradas (ativas e/ou extintas)."""
    with get_db(caminho_db) as conn:
        if apenas_ativas:
            rows = conn.execute(
                "SELECT * FROM escolas WHERE extinta = 0 ORDER BY id ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM escolas ORDER BY extinta ASC, id ASC"
            ).fetchall()
        return rows_to_list(rows)


def obter_escola(
    escola_id: int,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Obtém os dados completos de uma escola por ID."""
    with get_db(caminho_db) as conn:
        row = conn.execute("SELECT * FROM escolas WHERE id = ?", (escola_id,)).fetchone()
        return row_to_dict(row)


def cadastrar_escola_extinta(
    dados: Dict[str, Any],
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Cadastra uma nova escola extinta/nucleada (acervo recolhido pela SME).
    Atribui automaticamente o próximo ID disponível (ID >= 9) e define 'DRIVE_B'.
    """
    with get_db(caminho_db) as conn:
        max_id_row = conn.execute("SELECT MAX(id) as max_id FROM escolas").fetchone()
        proximo_id = max(9, (max_id_row["max_id"] or 8) + 1)
        
        dados_salvar = {
            "id": proximo_id,
            "nome_oficial": dados["nome_oficial"],
            "codigo_inep": dados.get("codigo_inep", ""),
            "endereco": dados.get("endereco", ""),
            "bairro": dados.get("bairro", "Zona Rural"),
            "municipio": dados.get("municipio", "JANDAÍRA"),
            "uf": dados.get("uf", "RN"),
            "municipio_uf": dados.get("municipio_uf", "Jandaíra - RN"),
            "diretor_nome": dados.get("diretor_nome", ""),
            "diretor_registro": dados.get("diretor_registro", ""),
            "secretario_nome": dados.get("secretario_nome", ""),
            "secretario_registro": dados.get("secretario_registro", ""),
            "extinta": 1,
            "observacao_acervo_extinta": dados.get("observacao_acervo_extinta", "Acervo histórico recolhido pela SME"),
            "drive_particao": "DRIVE_B",
            "brasao_base64": dados.get("brasao_base64")
        }

        conn.execute(
            """
            INSERT INTO escolas (
                id, nome_oficial, codigo_inep, endereco, bairro, municipio, uf, municipio_uf,
                diretor_nome, diretor_registro, secretario_nome, secretario_registro, extinta,
                observacao_acervo_extinta, drive_particao, brasao_base64
            ) VALUES (
                :id, :nome_oficial, :codigo_inep, :endereco, :bairro, :municipio, :uf, :municipio_uf,
                :diretor_nome, :diretor_registro, :secretario_nome, :secretario_registro, :extinta,
                :observacao_acervo_extinta, :drive_particao, :brasao_base64
            )
            """,
            dados_salvar
        )
        return dados_salvar


def atualizar_escola(
    escola_id: int,
    dados: Dict[str, Any],
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Atualiza diretores, endereço e dados institucionais de uma escola."""
    campos_permitidos = [
        "nome_oficial", "codigo_inep", "endereco", "bairro", "municipio", "uf",
        "municipio_uf", "diretor_nome", "diretor_registro",
        "secretario_nome", "secretario_registro", "brasao_base64",
        "observacao_acervo_extinta"
    ]
    sets = []
    params: List[Any] = []
    for k in campos_permitidos:
        if k in dados:
            sets.append(f"{k} = ?")
            params.append(dados[k])

    if not sets:
        return obter_escola(escola_id, caminho_db)

    params.append(escola_id)
    with get_db(caminho_db) as conn:
        conn.execute(f"UPDATE escolas SET {', '.join(sets)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM escolas WHERE id = ?", (escola_id,)).fetchone()
        return row_to_dict(row)


# ==============================================================================
# CRUD: ALUNOS (ARQUIVO PASSIVO)
# ==============================================================================

CAMPOS_TABELA_ALUNOS = [
    "uuid", "escola_id", "nome_completo", "matricula", "data_nascimento",
    "naturalidade_municipio", "naturalidade_uf", "nacionalidade",
    "filiacao_1", "filiacao_2", "rg_numero", "rg_orgao_uf", "cpf",
    "certidao_tipo", "certidao_termo", "certidao_livro",
    "certidao_folha", "certidao_cartorio", "certidao_municipio_uf",
    "regime_ensino", "observacoes_historico", "status_ficha",
    "codigo_autenticidade", "paginas_webp_json", "assinatura_hmac",
    "atualizado_em", "sincronizado"
]


def criar_aluno(
    dados: Dict[str, Any],
    calcular_hmac: bool = True,
    operador: str = "",
    conn: Optional[sqlite3.Connection] = None,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Cria um novo ex-aluno no acervo passivo com UUIDv4, código de autenticidade
    único e assinatura digital HMAC-SHA256 anti-adulteração externa.
    """
    registro = dict(dados)
    if not registro.get("uuid"):
        registro["uuid"] = novo_uuid()
    if not registro.get("codigo_autenticidade"):
        registro["codigo_autenticidade"] = gerar_codigo_autenticidade(caminho_db=caminho_db)
    
    registro["atualizado_em"] = data_hora_utc_iso()
    registro["sincronizado"] = 0
    registro.setdefault("nacionalidade", "Brasileira")
    registro.setdefault("regime_ensino", "8_ANOS")
    registro.setdefault("status_ficha", "RASCUNHO_IA")
    
    if isinstance(registro.get("paginas_webp_json"), (list, dict)):
        registro["paginas_webp_json"] = json.dumps(registro["paginas_webp_json"], ensure_ascii=False)
    elif not registro.get("paginas_webp_json"):
        registro["paginas_webp_json"] = "[]"

    if calcular_hmac:
        registro["assinatura_hmac"] = security_hmac.gerar_hmac_aluno(registro)

    cols = [c for c in CAMPOS_TABELA_ALUNOS if c in registro]
    placeholders = [f":{c}" for c in cols]
    sql = f"INSERT INTO alunos ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"

    if conn is not None:
        conn.execute(sql, registro)
        registrar_auditoria(
            acao="CRIAR_ALUNO",
            escola_id=registro.get("escola_id"),
            aluno_uuid=registro["uuid"],
            detalhes={"nome": registro.get("nome_completo"), "codigo": registro.get("codigo_autenticidade")},
            operador=operador,
            conn=conn
        )
    else:
        with get_db(caminho_db) as c:
            c.execute(sql, registro)
            registrar_auditoria(
                acao="CRIAR_ALUNO",
                escola_id=registro.get("escola_id"),
                aluno_uuid=registro["uuid"],
                detalhes={"nome": registro.get("nome_completo"), "codigo": registro.get("codigo_autenticidade")},
                operador=operador,
                conn=c
            )

    return registro


def obter_aluno(
    aluno_uuid: str,
    verificar_hmac: bool = True,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """
    Obtém o aluno por UUID.
    Verifica a assinatura HMAC para detectar adulterações externas no SQLite.
    Adiciona o campo booleano 'hmac_valido' e 'violacao_detectada' ao resultado.
    """
    with get_db(caminho_db) as conn:
        row = conn.execute("SELECT * FROM alunos WHERE uuid = ?", (aluno_uuid,)).fetchone()
        aluno = row_to_dict(row)
        if not aluno:
            return None

        if verificar_hmac:
            valido = security_hmac.validar_hmac_aluno(aluno)
            aluno["hmac_valido"] = valido
            aluno["violacao_detectada"] = not valido
        else:
            aluno["hmac_valido"] = True
            aluno["violacao_detectada"] = False

        return aluno


def obter_aluno_por_codigo(
    codigo_autenticidade: str,
    verificar_hmac: bool = True,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Obtém aluno pelo Código de Autenticidade (Ex: VER-2026-X89F)."""
    with get_db(caminho_db) as conn:
        row = conn.execute(
            "SELECT * FROM alunos WHERE codigo_autenticidade = ?",
            (codigo_autenticidade.strip(),)
        ).fetchone()
        aluno = row_to_dict(row)
        if not aluno:
            return None

        if verificar_hmac:
            valido = security_hmac.validar_hmac_aluno(aluno)
            aluno["hmac_valido"] = valido
            aluno["violacao_detectada"] = not valido
        else:
            aluno["hmac_valido"] = True
            aluno["violacao_detectada"] = False

        return aluno


def atualizar_aluno(
    aluno_uuid: str,
    dados: Dict[str, Any],
    calcular_hmac: bool = True,
    operador: str = "",
    conn: Optional[sqlite3.Connection] = None,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """
    Atualiza os dados de um aluno, recalculando seu HMAC e atualizando timestamps.
    Registra a auditoria detalhada da alteração.
    """
    def _executar(c: sqlite3.Connection):
        atual = row_to_dict(c.execute("SELECT * FROM alunos WHERE uuid = ?", (aluno_uuid,)).fetchone())
        if not atual:
            return None

        registro = {**atual, **dados}
        registro["uuid"] = aluno_uuid
        registro["atualizado_em"] = data_hora_utc_iso()
        registro["sincronizado"] = 0

        if isinstance(registro.get("paginas_webp_json"), (list, dict)):
            registro["paginas_webp_json"] = json.dumps(registro["paginas_webp_json"], ensure_ascii=False)

        if calcular_hmac:
            registro["assinatura_hmac"] = security_hmac.gerar_hmac_aluno(registro)

        cols_up = [c for c in CAMPOS_TABELA_ALUNOS if c != "uuid" and c in registro]
        sets = [f"{c} = :{c}" for c in cols_up]
        sql = f"UPDATE alunos SET {', '.join(sets)} WHERE uuid = :uuid"
        c.execute(sql, registro)

        registrar_auditoria(
            acao="ATUALIZAR_ALUNO",
            escola_id=registro.get("escola_id"),
            aluno_uuid=aluno_uuid,
            detalhes={"alteracoes": [k for k in dados.keys() if k != "uuid"]},
            operador=operador,
            conn=c
        )
        return registro

    if conn is not None:
        return _executar(conn)
    else:
        with get_db(caminho_db) as c:
            return _executar(c)


def excluir_aluno(
    aluno_uuid: str,
    operador: str = "",
    caminho_db: Optional[Union[str, Path]] = None
) -> bool:
    """Exclui um aluno e em cascata sua vida escolar e notas."""
    with get_db(caminho_db) as conn:
        aluno = row_to_dict(conn.execute("SELECT * FROM alunos WHERE uuid = ?", (aluno_uuid,)).fetchone())
        if not aluno:
            return False

        registrar_auditoria(
            acao="EXCLUIR_ALUNO",
            escola_id=aluno.get("escola_id"),
            aluno_uuid=aluno_uuid,
            detalhes={"nome": aluno.get("nome_completo"), "codigo": aluno.get("codigo_autenticidade")},
            operador=operador,
            conn=conn
        )
        conn.execute("DELETE FROM alunos WHERE uuid = ?", (aluno_uuid,))
        return True


def listar_alunos(
    escola_id: Optional[int] = None,
    busca: Optional[str] = None,
    status_ficha: Optional[str] = None,
    limite: int = 100,
    offset: int = 0,
    caminho_db: Optional[Union[str, Path]] = None
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Lista alunos com paginação e busca multifatorial:
    nome_completo, cpf, rg_numero, codigo_autenticidade.
    Retorna tupla: (lista_alunos, total_contagem).
    """
    where_clauses = ["1=1"]
    params: List[Any] = []

    if escola_id is not None:
        where_clauses.append("a.escola_id = ?")
        params.append(escola_id)

    if status_ficha:
        where_clauses.append("a.status_ficha = ?")
        params.append(status_ficha)

    if busca and busca.strip():
        termo = f"%{busca.strip()}%"
        where_clauses.append(
            """(
                a.nome_completo LIKE ? OR
                a.cpf LIKE ? OR
                a.rg_numero LIKE ? OR
                a.codigo_autenticidade LIKE ?
            )"""
        )
        params.extend([termo, termo, termo, termo])

    where_sql = " AND ".join(where_clauses)

    with get_db(caminho_db) as conn:
        count_sql = f"SELECT COUNT(*) as total FROM alunos a WHERE {where_sql}"
        total = conn.execute(count_sql, params).fetchone()["total"]

        query_sql = f"""
        SELECT a.*, e.nome_oficial as escola_nome
        FROM alunos a
        LEFT JOIN escolas e ON a.escola_id = e.id
        WHERE {where_sql}
        ORDER BY a.atualizado_em DESC
        LIMIT ? OFFSET ?
        """
        rows = conn.execute(query_sql, params + [limite, offset]).fetchall()
        return rows_to_list(rows), total


def atualizar_status_ficha(
    aluno_uuid: str,
    novo_status: str,
    operador: str = "",
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Altera o status da ficha ('RASCUNHO_IA', 'DIGITADO', 'LACRADO_HOMOLOGADO')."""
    return atualizar_aluno(
        aluno_uuid=aluno_uuid,
        dados={"status_ficha": novo_status},
        operador=operador,
        caminho_db=caminho_db
    )


# ==============================================================================
# CRUD: VIDA ESCOLAR (SÉRIES / ANOS)
# ==============================================================================

CAMPOS_TABELA_VIDA = [
    "uuid", "aluno_uuid", "ordem_coluna", "label_serie",
    "ano_letivo", "escola_nome", "escola_municipio_uf",
    "dias_letivos", "carga_horaria_total", "frequencia_percentual",
    "resultado_final", "atualizado_em", "sincronizado"
]


def salvar_vida_escolar_lote(
    aluno_uuid: str,
    itens: List[Dict[str, Any]],
    conn: Optional[sqlite3.Connection] = None,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """
    Substitui atomicamente toda a vida escolar do aluno pelo lote fornecido.
    Gera UUIDv4 para cada registro se necessário e atualiza timestamps.
    """
    def _executar(c: sqlite3.Connection):
        c.execute("DELETE FROM vida_escolar WHERE aluno_uuid = ?", (aluno_uuid,))
        agora = data_hora_utc_iso()
        salvos = []

        sql = """
        INSERT INTO vida_escolar (
            uuid, aluno_uuid, ordem_coluna, label_serie, ano_letivo,
            escola_nome, escola_municipio_uf, dias_letivos, carga_horaria_total,
            frequencia_percentual, resultado_final, atualizado_em, sincronizado
        ) VALUES (
            :uuid, :aluno_uuid, :ordem_coluna, :label_serie, :ano_letivo,
            :escola_nome, :escola_municipio_uf, :dias_letivos, :carga_horaria_total,
            :frequencia_percentual, :resultado_final, :atualizado_em, 0
        )
        """

        for item in itens:
            registro = {
                "uuid": item.get("uuid") or novo_uuid(),
                "aluno_uuid": aluno_uuid,
                "ordem_coluna": item.get("ordem_coluna", 1),
                "label_serie": item.get("label_serie", ""),
                "ano_letivo": item.get("ano_letivo"),
                "escola_nome": item.get("escola_nome"),
                "escola_municipio_uf": item.get("escola_municipio_uf"),
                "dias_letivos": item.get("dias_letivos"),
                "carga_horaria_total": item.get("carga_horaria_total"),
                "frequencia_percentual": item.get("frequencia_percentual"),
                "resultado_final": item.get("resultado_final"),
                "atualizado_em": agora,
                "sincronizado": 0
            }
            c.execute(sql, registro)
            salvos.append(registro)
        return salvos

    if conn is not None:
        return _executar(conn)
    else:
        with get_db(caminho_db) as c:
            return _executar(c)


def listar_vida_escolar(
    aluno_uuid: str,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """Lista as séries/anos cursados ordenados pela coluna (1 a 9)."""
    with get_db(caminho_db) as conn:
        rows = conn.execute(
            "SELECT * FROM vida_escolar WHERE aluno_uuid = ? ORDER BY ordem_coluna ASC",
            (aluno_uuid,)
        ).fetchall()
        return rows_to_list(rows)


# ==============================================================================
# CRUD: NOTAS CURRICULARES (MATRIZ DE DISCIPLINAS)
# ==============================================================================

CAMPOS_TABELA_NOTAS = [
    "uuid", "aluno_uuid", "ordem_coluna", "categoria",
    "ordem_disciplina", "disciplina_nome", "nota_ou_conceito",
    "carga_horaria_disciplina", "assinatura_hmac",
    "atualizado_em", "sincronizado"
]


def salvar_notas_curriculares_lote(
    aluno_uuid: str,
    notas: List[Dict[str, Any]],
    calcular_hmac: bool = True,
    conn: Optional[sqlite3.Connection] = None,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """
    Substitui em lote as notas curriculares do aluno.
    Gera UUIDv4 e assina criptograficamente cada nota com HMAC-SHA256.
    """
    def _executar(c: sqlite3.Connection):
        c.execute("DELETE FROM notas_curriculares WHERE aluno_uuid = ?", (aluno_uuid,))
        agora = data_hora_utc_iso()
        salvos = []

        sql = """
        INSERT INTO notas_curriculares (
            uuid, aluno_uuid, ordem_coluna, categoria, ordem_disciplina,
            disciplina_nome, nota_ou_conceito, carga_horaria_disciplina,
            assinatura_hmac, atualizado_em, sincronizado
        ) VALUES (
            :uuid, :aluno_uuid, :ordem_coluna, :categoria, :ordem_disciplina,
            :disciplina_nome, :nota_ou_conceito, :carga_horaria_disciplina,
            :assinatura_hmac, :atualizado_em, 0
        )
        """

        for n in notas:
            registro = {
                "uuid": n.get("uuid") or novo_uuid(),
                "aluno_uuid": aluno_uuid,
                "ordem_coluna": n.get("ordem_coluna", 1),
                "categoria": n.get("categoria", "BASE_COMUM"),
                "ordem_disciplina": n.get("ordem_disciplina", 1),
                "disciplina_nome": n.get("disciplina_nome", ""),
                "nota_ou_conceito": n.get("nota_ou_conceito"),
                "carga_horaria_disciplina": n.get("carga_horaria_disciplina"),
                "assinatura_hmac": n.get("assinatura_hmac", ""),
                "atualizado_em": agora,
                "sincronizado": 0
            }
            
            if calcular_hmac:
                registro["assinatura_hmac"] = security_hmac.gerar_hmac_nota(registro)

            c.execute(sql, registro)
            salvos.append(registro)
        return salvos

    if conn is not None:
        return _executar(conn)
    else:
        with get_db(caminho_db) as c:
            return _executar(c)


def listar_notas_curriculares(
    aluno_uuid: str,
    verificar_hmac: bool = True,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """
    Lista todas as notas do aluno ordenadas por categoria, ordem da disciplina e série.
    Valida a assinatura HMAC de cada registro.
    """
    with get_db(caminho_db) as conn:
        rows = conn.execute(
            """
            SELECT * FROM notas_curriculares
            WHERE aluno_uuid = ?
            ORDER BY
                CASE WHEN categoria = 'BASE_COMUM' THEN 1 ELSE 2 END,
                ordem_disciplina ASC,
                ordem_coluna ASC
            """,
            (aluno_uuid,)
        ).fetchall()
        notas = rows_to_list(rows)

        if verificar_hmac:
            for n in notas:
                n["hmac_valido"] = security_hmac.validar_hmac_nota(n)
        else:
            for n in notas:
                n["hmac_valido"] = True

        return notas


# ==============================================================================
# TRANSAÇÃO COMPLETA: HISTÓRICO ESCOLAR COMPLETO
# ==============================================================================

def salvar_historico_completo(
    aluno_dados: Dict[str, Any],
    vida_escolar_itens: List[Dict[str, Any]],
    notas_itens: List[Dict[str, Any]],
    operador: str = "",
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Persiste de forma 100% atômica o Histórico Escolar completo:
    aluno + séries de vida escolar + matriz de notas curriculares.
    Calcula HMACs, atualiza timestamps e registra auditoria.
    """
    with get_db(caminho_db) as conn:
        # 1. Aluno (Cria ou Atualiza)
        aluno_uid = aluno_dados.get("uuid")
        if aluno_uid and conn.execute("SELECT 1 FROM alunos WHERE uuid = ?", (aluno_uid,)).fetchone():
            aluno = atualizar_aluno(
                aluno_uuid=aluno_uid,
                dados=aluno_dados,
                calcular_hmac=True,
                operador=operador,
                conn=conn
            )
        else:
            aluno = criar_aluno(
                dados=aluno_dados,
                calcular_hmac=True,
                operador=operador,
                conn=conn
            )
            aluno_uid = aluno["uuid"]

        # 2. Vida Escolar
        vida = salvar_vida_escolar_lote(
            aluno_uuid=aluno_uid,
            itens=vida_escolar_itens,
            conn=conn
        )

        # 3. Notas Curriculares
        notas = salvar_notas_curriculares_lote(
            aluno_uuid=aluno_uid,
            notas=notas_itens,
            calcular_hmac=True,
            conn=conn
        )

        registrar_auditoria(
            acao="SALVAR_HISTORICO_COMPLETO",
            escola_id=aluno.get("escola_id"),
            aluno_uuid=aluno_uid,
            detalhes={
                "series_count": len(vida),
                "notas_count": len(notas),
                "status": aluno.get("status_ficha")
            },
            operador=operador,
            conn=conn
        )

        return {
            "aluno": aluno,
            "vida_escolar": vida,
            "notas_curriculares": notas
        }


def obter_historico_completo(
    aluno_uuid: str,
    verificar_hmac: bool = True,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """
    Retorna o Histórico Escolar consolidado com todas as tabelas relacionadas
    e relatório completo de verificação de integridade HMAC.
    """
    aluno = obter_aluno(aluno_uuid, verificar_hmac=verificar_hmac, caminho_db=caminho_db)
    if not aluno:
        return None

    escola = obter_escola(aluno["escola_id"], caminho_db=caminho_db)
    vida = listar_vida_escolar(aluno_uuid, caminho_db=caminho_db)
    notas = listar_notas_curriculares(aluno_uuid, verificar_hmac=verificar_hmac, caminho_db=caminho_db)

    integridade = security_hmac.verificar_integridade_historico(
        aluno=aluno,
        notas=notas,
        vidas=vida
    )

    return {
        "aluno": aluno,
        "escola": escola,
        "vida_escolar": vida,
        "notas_curriculares": notas,
        "integridade": integridade
    }


# ==============================================================================
# CRUD: FILA OCR (DIGITALIZAÇÃO E PROCESSAMENTO IA)
# ==============================================================================

CAMPOS_TABELA_FILA_OCR = [
    "sessao_id", "escola_id", "status", "origem_captura",
    "paginas_locais_json", "json_extraido_ia", "tentativas_ia",
    "ultimo_erro", "criado_em", "atualizado_em"
]


def criar_sessao_ocr(
    escola_id: Optional[int] = None,
    origem_captura: str = "MOBILE_QR",
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """Cria uma nova sessão de envelope para captura de múltiplas páginas de histórico."""
    sessao_id = novo_uuid()
    agora = data_hora_utc_iso()
    dados = {
        "sessao_id": sessao_id,
        "escola_id": escola_id,
        "status": "CAPTURANDO",
        "origem_captura": origem_captura,
        "paginas_locais_json": "[]",
        "json_extraido_ia": None,
        "tentativas_ia": 0,
        "ultimo_erro": None,
        "criado_em": agora,
        "atualizado_em": agora
    }

    sql = """
    INSERT INTO fila_ocr (
        sessao_id, escola_id, status, origem_captura, paginas_locais_json,
        json_extraido_ia, tentativas_ia, ultimo_erro, criado_em, atualizado_em
    ) VALUES (
        :sessao_id, :escola_id, :status, :origem_captura, :paginas_locais_json,
        :json_extraido_ia, :tentativas_ia, :ultimo_erro, :criado_em, :atualizado_em
    )
    """
    with get_db(caminho_db) as conn:
        conn.execute(sql, dados)
    return dados


def obter_sessao_ocr(
    sessao_id: str,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Recupera os detalhes de uma sessão de captura e fila de OCR."""
    with get_db(caminho_db) as conn:
        row = conn.execute("SELECT * FROM fila_ocr WHERE sessao_id = ?", (sessao_id,)).fetchone()
        return row_to_dict(row)


def adicionar_pagina_ocr(
    sessao_id: str,
    caminho_pagina_webp: str,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Adiciona o caminho de uma nova página aprovada pelo Porteiro de Imagem."""
    with get_db(caminho_db) as conn:
        sessao = row_to_dict(conn.execute("SELECT * FROM fila_ocr WHERE sessao_id = ?", (sessao_id,)).fetchone())
        if not sessao:
            return None

        try:
            paginas = json.loads(sessao.get("paginas_locais_json") or "[]")
        except Exception:
            paginas = []

        if caminho_pagina_webp not in paginas:
            paginas.append(caminho_pagina_webp)

        agora = data_hora_utc_iso()
        conn.execute(
            """
            UPDATE fila_ocr SET
                paginas_locais_json = ?,
                atualizado_em = ?
            WHERE sessao_id = ?
            """,
            (json.dumps(paginas, ensure_ascii=False), agora, sessao_id)
        )
        sessao["paginas_locais_json"] = json.dumps(paginas, ensure_ascii=False)
        sessao["atualizado_em"] = agora
        return sessao


def atualizar_status_ocr(
    sessao_id: str,
    status: str,
    json_extraido: Optional[str] = None,
    erro: Optional[str] = None,
    incrementar_tentativa: bool = False,
    caminho_db: Optional[Union[str, Path]] = None
) -> Optional[Dict[str, Any]]:
    """Atualiza o estado da sessão de OCR no pipeline assíncrono."""
    with get_db(caminho_db) as conn:
        sessao = row_to_dict(conn.execute("SELECT * FROM fila_ocr WHERE sessao_id = ?", (sessao_id,)).fetchone())
        if not sessao:
            return None

        agora = data_hora_utc_iso()
        tentativas = sessao.get("tentativas_ia", 0) + (1 if incrementar_tentativa else 0)

        conn.execute(
            """
            UPDATE fila_ocr SET
                status = ?,
                json_extraido_ia = COALESCE(?, json_extraido_ia),
                ultimo_erro = ?,
                tentativas_ia = ?,
                atualizado_em = ?
            WHERE sessao_id = ?
            """,
            (status, json_extraido, erro, tentativas, agora, sessao_id)
        )
        row = conn.execute("SELECT * FROM fila_ocr WHERE sessao_id = ?", (sessao_id,)).fetchone()
        return row_to_dict(row)


def listar_sessoes_ocr(
    escola_id: Optional[int] = None,
    status: Optional[str] = None,
    limite: int = 50,
    caminho_db: Optional[Union[str, Path]] = None
) -> List[Dict[str, Any]]:
    """Lista sessões de OCR para acompanhamento em abas de trabalho."""
    where = ["1=1"]
    params: List[Any] = []
    if escola_id is not None:
        where.append("escola_id = ?")
        params.append(escola_id)
    if status is not None:
        where.append("status = ?")
        params.append(status)

    sql = f"SELECT * FROM fila_ocr WHERE {' AND '.join(where)} ORDER BY atualizado_em DESC LIMIT ?"
    params.append(limite)

    with get_db(caminho_db) as conn:
        rows = conn.execute(sql, params).fetchall()
        return rows_to_list(rows)


# ==============================================================================
# ROTINAS DE SINCRONIZAÇÃO OUTBOX (OFFLINE-FIRST)
# ==============================================================================

def obter_pendentes_sincronizacao(
    limite_por_tabela: int = 100,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Retorna todos os registros pendentes de envio à nuvem Supabase (sincronizado = 0).
    """
    with get_db(caminho_db) as conn:
        alunos = rows_to_list(
            conn.execute(
                "SELECT * FROM alunos WHERE sincronizado = 0 ORDER BY atualizado_em ASC LIMIT ?",
                (limite_por_tabela,)
            ).fetchall()
        )
        vidas = rows_to_list(
            conn.execute(
                "SELECT * FROM vida_escolar WHERE sincronizado = 0 ORDER BY atualizado_em ASC LIMIT ?",
                (limite_por_tabela,)
            ).fetchall()
        )
        notas = rows_to_list(
            conn.execute(
                "SELECT * FROM notas_curriculares WHERE sincronizado = 0 ORDER BY atualizado_em ASC LIMIT ?",
                (limite_por_tabela,)
            ).fetchall()
        )
        logs = rows_to_list(
            conn.execute(
                "SELECT * FROM auditoria_logs WHERE sincronizado = 0 ORDER BY criado_em ASC LIMIT ?",
                (limite_por_tabela,)
            ).fetchall()
        )

        return {
            "alunos": alunos,
            "vida_escolar": vidas,
            "notas_curriculares": notas,
            "auditoria_logs": logs
        }


def marcar_registros_sincronizados(
    tabela: str,
    uuids: List[str],
    caminho_db: Optional[Union[str, Path]] = None
) -> int:
    """Marca registros especificados como sincronizados (sincronizado = 1)."""
    tabelas_validas = ["alunos", "vida_escolar", "notas_curriculares", "auditoria_logs"]
    if tabela not in tabelas_validas or not uuids:
        return 0

    placeholders = ",".join(["?"] * len(uuids))
    sql = f"UPDATE {tabela} SET sincronizado = 1 WHERE uuid IN ({placeholders})"

    with get_db(caminho_db) as conn:
        cur = conn.execute(sql, uuids)
        return cur.rowcount


# Inicialização automática padrão ao carregar o módulo
if not DB_PATH.exists():
    init_db()
