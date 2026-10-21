"""
Módulo de Segurança e Integridade Criptográfica (HMAC-SHA256)
============================================================
Protege os registros sensíveis do acervo escolar passivo contra adulteração
indevida por meio de editores SQLite externos (ex: DB Browser for SQLite,
DBeaver ou scripts diretos).

Cada registro gravado pelo SGM-Históricos recebe uma assinatura HMAC-SHA256
calculada sobre seus campos críticos concatenados de forma canônica.
Na leitura de históricos para emissão, impressão ou visualização oficial,
as assinaturas são recalculadas e verificadas com comparação em tempo constante.
"""

import hmac
import hashlib
import os
import unicodedata
from typing import Any, Dict, List, Tuple, Optional


# Chave interna mestra do sistema (Pepper criptográfico)
# Pode ser sobrescrita via variável de ambiente SGM_HMAC_SECRET em produção
SGM_HMAC_SECRET = os.getenv(
    "SGM_HMAC_SECRET",
    "SGM_PASSIVO_SECRET_PEPPER_2026_HMAC_SHA256_INTEGRITY_KEY_#v1"
).encode("utf-8")

DELIMITADOR_CANONICO = "||"


class ViolacaoIntegridadeError(Exception):
    """Exceção levantada quando um registro do SQLite foi adulterado externamente."""
    pass


def _normalizar(valor: Any) -> str:
    """
    Normaliza qualquer valor para string canônica estável:
    - None torna-se string vazia;
    - Strings sofrem strip e normalização Unicode NFC;
    - Números e booleanos são convertidos estavelmente.
    """
    if valor is None:
        return ""
    if isinstance(valor, bool):
        return "1" if valor else "0"
    texto = str(valor).strip()
    return unicodedata.normalize("NFC", texto)


def _calcular_hmac_texto(payload: str) -> str:
    """Calcula o digest HMAC-SHA256 em hexadecimal para o texto fornecido."""
    return hmac.new(
        SGM_HMAC_SECRET,
        payload.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


# ==============================================================================
# ASSINATURAS E VALIDAÇÃO PARA: ALUNOS
# ==============================================================================

CAMPOS_CRITICOS_ALUNO = [
    "uuid",
    "escola_id",
    "nome_completo",
    "data_nascimento",
    "rg_numero",
    "cpf",
    "regime_ensino",
    "codigo_autenticidade"
]


def construir_payload_aluno(dados: Dict[str, Any]) -> str:
    """
    Constrói a representação canônica dos campos críticos do aluno.
    Exemplo: uuid||escola_id||nome_completo||...
    """
    partes = [_normalizar(dados.get(campo)) for campo in CAMPOS_CRITICOS_ALUNO]
    return DELIMITADOR_CANONICO.join(partes)


def gerar_hmac_aluno(dados: Dict[str, Any]) -> str:
    """Gera a assinatura HMAC-SHA256 oficial para o registro do aluno."""
    payload = construir_payload_aluno(dados)
    return _calcular_hmac_texto(payload)


def validar_hmac_aluno(dados: Dict[str, Any]) -> bool:
    """
    Verifica se a assinatura armazenada em 'assinatura_hmac' é idêntica
    à assinatura recalculada sobre os dados atuais do aluno.
    Utiliza hmac.compare_digest para prevenir ataques de tempo (timing attacks).
    """
    assinatura_gravada = _normalizar(dados.get("assinatura_hmac"))
    if not assinatura_gravada:
        return False
    assinatura_esperada = gerar_hmac_aluno(dados)
    return hmac.compare_digest(assinatura_gravada, assinatura_esperada)


# ==============================================================================
# ASSINATURAS E VALIDAÇÃO PARA: NOTAS CURRICULARES
# ==============================================================================

CAMPOS_CRITICOS_NOTA = [
    "uuid",
    "aluno_uuid",
    "ordem_coluna",
    "categoria",
    "ordem_disciplina",
    "disciplina_nome",
    "nota_ou_conceito",
    "carga_horaria_disciplina"
]


def construir_payload_nota(dados: Dict[str, Any]) -> str:
    """Constrói a representação canônica dos campos críticos da nota curricular."""
    partes = [_normalizar(dados.get(campo)) for campo in CAMPOS_CRITICOS_NOTA]
    return DELIMITADOR_CANONICO.join(partes)


def gerar_hmac_nota(dados: Dict[str, Any]) -> str:
    """Gera a assinatura HMAC-SHA256 oficial para a nota curricular."""
    payload = construir_payload_nota(dados)
    return _calcular_hmac_texto(payload)


def validar_hmac_nota(dados: Dict[str, Any]) -> bool:
    """Verifica a integridade criptográfica de uma nota curricular."""
    assinatura_gravada = _normalizar(dados.get("assinatura_hmac"))
    if not assinatura_gravada:
        return False
    assinatura_esperada = gerar_hmac_nota(dados)
    return hmac.compare_digest(assinatura_gravada, assinatura_esperada)


# ==============================================================================
# ASSINATURAS E VALIDAÇÃO PARA: VIDA ESCOLAR (SÉRIES / ANOS)
# ==============================================================================

CAMPOS_CRITICOS_VIDA = [
    "uuid",
    "aluno_uuid",
    "ordem_coluna",
    "label_serie",
    "ano_letivo",
    "escola_nome",
    "resultado_final"
]


def construir_payload_vida_escolar(dados: Dict[str, Any]) -> str:
    """Constrói a representação canônica dos campos críticos de vida escolar."""
    partes = [_normalizar(dados.get(campo)) for campo in CAMPOS_CRITICOS_VIDA]
    return DELIMITADOR_CANONICO.join(partes)


def gerar_hmac_vida_escolar(dados: Dict[str, Any]) -> str:
    """Gera a assinatura HMAC-SHA256 oficial para o registro de vida escolar."""
    payload = construir_payload_vida_escolar(dados)
    return _calcular_hmac_texto(payload)


def validar_hmac_vida_escolar(dados: Dict[str, Any]) -> bool:
    """Verifica a integridade criptográfica de uma etapa da vida escolar."""
    assinatura_gravada = _normalizar(dados.get("assinatura_hmac"))
    if not assinatura_gravada:
        return False
    assinatura_esperada = gerar_hmac_vida_escolar(dados)
    return hmac.compare_digest(assinatura_gravada, assinatura_esperada)


# ==============================================================================
# VERIFICAÇÃO COMPLETA DE INTEGRIDADE DO HISTÓRICO ESCOLAR
# ==============================================================================

def verificar_integridade_historico(
    aluno: Dict[str, Any],
    notas: List[Dict[str, Any]],
    vidas: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Realiza uma varredura completa de integridade em todos os registros que compõem
    o Histórico Escolar oficial.

    Retorna um dicionário detalhado:
    {
        "integro": True/False,
        "aluno_valido": True/False,
        "total_notas": int,
        "notas_invalidas": [uuid1, uuid2, ...],
        "total_vidas": int,
        "vidas_invalidas": [uuid1, uuid2, ...],
        "motivos": ["Descrição dos problemas encontrados"]
    }
    """
    motivos: List[str] = []
    
    # 1. Validação do Aluno
    aluno_valido = validar_hmac_aluno(aluno)
    if not aluno_valido:
        motivos.append(
            f"Assinatura do aluno {aluno.get('uuid')} ({aluno.get('nome_completo')}) "
            "não confere com os dados registrados. Possível alteração externa direta no SQLite."
        )

    # 2. Validação das Notas Curriculares
    notas_invalidas: List[str] = []
    for n in notas:
        if not validar_hmac_nota(n):
            uid = n.get("uuid", "desconhecido")
            disc = n.get("disciplina_nome", "desconhecida")
            notas_invalidas.append(uid)
            motivos.append(f"Violação de HMAC na disciplina '{disc}' (UUID {uid}).")

    # 3. Validação das Etapas da Vida Escolar (se fornecidas e contendo assinatura)
    vidas_invalidas: List[str] = []
    if vidas:
        for v in vidas:
            # Se possuir o campo de assinatura hmac, valida
            if v.get("assinatura_hmac"):
                if not validar_hmac_vida_escolar(v):
                    uid = v.get("uuid", "desconhecido")
                    serie = v.get("label_serie", "desconhecida")
                    vidas_invalidas.append(uid)
                    motivos.append(f"Violação de HMAC na série '{serie}' (UUID {uid}).")

    integro = (aluno_valido and len(notas_invalidas) == 0 and len(vidas_invalidas) == 0)

    return {
        "integro": integro,
        "aluno_valido": aluno_valido,
        "total_notas": len(notas),
        "notas_invalidas": notas_invalidas,
        "total_vidas": len(vidas) if vidas else 0,
        "vidas_invalidas": vidas_invalidas,
        "motivos": motivos
    }
