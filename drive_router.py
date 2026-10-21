"""
Módulo Roteador Multi-Drive (Google Drive API v3) e Backups Criptografados
========================================================================
Implementa a gestão de armazenamento em nuvem e cofre de imagens conforme
Seção 8.2 do SPEC.md:

1. Roteamento Multi-Drive de 30 GB (2 contas gratuitas de 15 GB cada):
   - 'DRIVE_A' (credentials_drive_a.json): Imagens .webp e backups .db.enc das Escolas 1 a 4.
   - 'DRIVE_B' (credentials_drive_b.json): Imagens .webp e backups .db.enc das Escolas 5 a 8 e SME.
   - Perfil 'SECRETARIA' (SME): Acesso simultâneo e irrestrito aos dois drives.
2. Backups Locais e Criptografia com Fernet:
   - Gera cópias consistentes do banco SQLite local e criptografa com AES-CBC (Fernet).
   - Produz arquivos '.db.enc' com verificação de integridade SHA-256.
3. Resiliência e Operação 100% Offline:
   - Se as credenciais ainda não estiverem configuradas ou não houver internet,
     o sistema continua operando normalmente, mantendo os backups e imagens
     seguros em disco local ('./data_local/backups_locais/' e './data_local/imagens_webp/').
"""

import os
import io
import json
import base64
import hashlib
import logging
import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

import config_manager


logger = logging.getLogger("sgm_historicos.drive_router")

# Caminhos padrão locais
BASE_DIR = Path(__file__).resolve().parent
DATA_LOCAL = BASE_DIR / "data_local"
DIR_BACKUPS_LOCAIS = DATA_LOCAL / "backups_locais"
DIR_BACKUPS_LOCAIS.mkdir(parents=True, exist_ok=True)

ARQUIVO_CREDS_DRIVE_A = BASE_DIR / "credentials_drive_a.json"
ARQUIVO_CREDS_DRIVE_B = BASE_DIR / "credentials_drive_b.json"

# Pepper padrão para derivação da chave Fernet de backup
PEPPER_BACKUP_SGM = os.getenv(
    "SGM_BACKUP_PEPPER",
    "SGM_PASSIVO_MUNICIPAL_BACKUP_ENCRYPTION_KEY_2026_FERNET_PEPPER"
)


# ==============================================================================
# CRIPTOGRAFIA FERNET PARA BACKUPS (.db.enc)
# ==============================================================================

def obter_chave_fernet(salt: bytes = b"SGM_BACKUP_SALT_2026") -> bytes:
    """
    Deriva uma chave criptográfica Fernet de 32 bytes compatível com AES-128
    utilizando PBKDF2-HMAC-SHA256 com 100.000 iterações.
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    chave_derivada = kdf.derive(PEPPER_BACKUP_SGM.encode("utf-8"))
    return base64.urlsafe_b64encode(chave_derivada)


def criptografar_backup_sqlite(
    caminho_db: Union[str, Path],
    caminho_saida_enc: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Criptografa o arquivo SQLite local utilizando Fernet e gera o arquivo .db.enc.
    Retorna metadados de auditoria e hash SHA-256 do arquivo original e criptografado.
    """
    db_path = Path(caminho_db)
    if not db_path.exists():
        raise FileNotFoundError(f"Arquivo de banco de dados não encontrado: {db_path}")

    with open(db_path, "rb") as f:
        dados_originais = f.read()

    sha256_original = hashlib.sha256(dados_originais).hexdigest()
    tamanho_original = len(dados_originais)

    cipher = Fernet(obter_chave_fernet())
    dados_criptografados = cipher.encrypt(dados_originais)
    sha256_enc = hashlib.sha256(dados_criptografados).hexdigest()

    if caminho_saida_enc:
        out_path = Path(caminho_saida_enc)
    else:
        timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = DIR_BACKUPS_LOCAIS / f"backup_acervo_{timestamp_str}.db.enc"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(dados_criptografados)

    return {
        "sucesso": True,
        "caminho_enc": str(out_path),
        "nome_arquivo": out_path.name,
        "tamanho_bytes": len(dados_criptografados),
        "tamanho_kb": round(len(dados_criptografados) / 1024.0, 1),
        "sha256_original": sha256_original,
        "sha256_enc": sha256_enc,
        "criado_em": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }


def descriptografar_backup_sqlite(
    caminho_enc: Union[str, Path],
    caminho_saida_db: Union[str, Path]
) -> Dict[str, Any]:
    """
    Restaura um backup .db.enc descriptografando com Fernet para arquivo .db íntegro.
    """
    enc_path = Path(caminho_enc)
    if not enc_path.exists():
        raise FileNotFoundError(f"Arquivo criptografado não encontrado: {enc_path}")

    with open(enc_path, "rb") as f:
        dados_criptografados = f.read()

    cipher = Fernet(obter_chave_fernet())
    dados_descriptografados = cipher.decrypt(dados_criptografados)

    out_db = Path(caminho_saida_db)
    out_db.parent.mkdir(parents=True, exist_ok=True)
    with open(out_db, "wb") as f:
        f.write(dados_descriptografados)

    return {
        "sucesso": True,
        "caminho_db": str(out_db),
        "tamanho_bytes": len(dados_descriptografados),
        "sha256": hashlib.sha256(dados_descriptografados).hexdigest()
    }


# ==============================================================================
# CLIENTE GOOGLE DRIVE API V3 POR PARTIÇÃO
# ==============================================================================

class GoogleDrivePartitionClient:
    """
    Cliente para uma conta específica do Google Drive (Drive A ou Drive B)
    utilizando Service Account do Google APIs.
    """

    def __init__(self, nome_particao: str, caminho_credenciais: Path):
        self.nome_particao = nome_particao  # "DRIVE_A" ou "DRIVE_B"
        self.caminho_credenciais = caminho_credenciais
        self._servico = None

    def is_configurado(self) -> bool:
        """Indica se o arquivo de credenciais da partição existe em disco."""
        return self.caminho_credenciais.exists()

    def conectar(self) -> Optional[Any]:
        """Inicializa e retorna o serviço Google Drive v3 com credenciais Service Account."""
        if not self.is_configurado():
            return None
        if self._servico is not None:
            return self._servico

        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            escopos = ["https://www.googleapis.com/auth/drive.file"]
            creds = service_account.Credentials.from_service_account_file(
                str(self.caminho_credenciais),
                scopes=escopos
            )
            self._servico = build("drive", "v3", credentials=creds, cache_discovery=False)
            return self._servico
        except Exception as exc:
            logger.warning(f"Não foi possível conectar ao {self.nome_particao}: {exc}")
            return None

    def obter_ou_criar_pasta(self, nome_pasta: str, pasta_pai_id: Optional[str] = None) -> Optional[str]:
        """Localiza ou cria uma pasta no Google Drive pelo nome."""
        servico = self.conectar()
        if not servico:
            return None

        try:
            q = f"mimeType = 'application/vnd.google-apps.folder' and name = '{nome_pasta}' and trashed = false"
            if pasta_pai_id:
                q += f" and '{pasta_pai_id}' in parents"

            resposta = servico.files().list(q=q, fields="files(id, name)").execute()
            arquivos = resposta.get("files", [])
            if arquivos:
                return arquivos[0]["id"]

            metadados = {
                "name": nome_pasta,
                "mimeType": "application/vnd.google-apps.folder"
            }
            if pasta_pai_id:
                metadados["parents"] = [pasta_pai_id]

            pasta = servico.files().create(body=metadados, fields="id").execute()
            return pasta.get("id")
        except Exception as e:
            logger.error(f"Erro ao obter/criar pasta '{nome_pasta}' no {self.nome_particao}: {e}")
            return None

    def enviar_arquivo(
        self,
        caminho_local: Union[str, Path],
        nome_remoto: Optional[str] = None,
        pasta_remota_nome: str = "sgm_passivo",
        mime_type: str = "application/octet-stream"
    ) -> Dict[str, Any]:
        """
        Faz upload de um arquivo para a partição do Drive.
        Se offline ou sem credenciais, retorna status offline com sucesso local.
        """
        local_p = Path(caminho_local)
        if not local_p.exists():
            return {"sucesso": False, "mensagem": f"Arquivo local não encontrado: {local_p}"}

        nome_final = nome_remoto or local_p.name

        if not self.is_configurado():
            return {
                "sucesso": False,
                "offline": True,
                "particao": self.nome_particao,
                "arquivo_local": str(local_p),
                "mensagem": f"Credenciais do {self.nome_particao} ({self.caminho_credenciais.name}) ausentes. Operando em modo offline."
            }

        servico = self.conectar()
        if not servico:
            return {
                "sucesso": False,
                "offline": True,
                "particao": self.nome_particao,
                "arquivo_local": str(local_p),
                "mensagem": f"Falha de conexão com a API Google Drive no {self.nome_particao}. Modo offline mantido."
            }

        try:
            from googleapiclient.http import MediaFileUpload

            pasta_id = self.obter_ou_criar_pasta(pasta_remota_nome)
            metadados = {"name": nome_final}
            if pasta_id:
                metadados["parents"] = [pasta_id]

            media = MediaFileUpload(str(local_p), mimetype=mime_type, resumable=True)
            arquivo_drive = servico.files().create(
                body=metadados,
                media_body=media,
                fields="id, name, webViewLink, size"
            ).execute()

            return {
                "sucesso": True,
                "offline": False,
                "particao": self.nome_particao,
                "file_id": arquivo_drive.get("id"),
                "nome_remoto": arquivo_drive.get("name"),
                "link_visualizacao": arquivo_drive.get("webViewLink"),
                "tamanho_bytes": local_p.stat().st_size
            }
        except Exception as exc:
            logger.warning(f"Erro no envio para {self.nome_particao}: {exc}")
            return {
                "sucesso": False,
                "offline": True,
                "particao": self.nome_particao,
                "mensagem": f"Erro de comunicação com o Google Drive: {exc}"
            }


# ==============================================================================
# ROTEADOR MULTI-DRIVE DE 30 GB (DRIVE_A e DRIVE_B)
# ==============================================================================

class MultiDriveRouter:
    """
    Roteador que despacha uploads e consultas para a partição correta:
      - Escolas 1 a 4 -> DRIVE_A
      - Escolas 5 a 8 e SME -> DRIVE_B
      - Perfil SME -> Acesso e restauração em ambos os Drives
    """

    def __init__(self):
        self.drive_a = GoogleDrivePartitionClient("DRIVE_A", ARQUIVO_CREDS_DRIVE_A)
        self.drive_b = GoogleDrivePartitionClient("DRIVE_B", ARQUIVO_CREDS_DRIVE_B)

    def obter_particao_para_escola(self, escola_id: Optional[int]) -> str:
        """Retorna 'DRIVE_A' para escolas 1 a 4 e 'DRIVE_B' para 5 a 8 ou SME."""
        if escola_id is not None and 1 <= int(escola_id) <= 4:
            return "DRIVE_A"
        return "DRIVE_B"

    def obter_cliente_para_escola(self, escola_id: Optional[int]) -> GoogleDrivePartitionClient:
        """Retorna a instância do cliente da partição designada para a escola."""
        particao = self.obter_particao_para_escola(escola_id)
        return self.drive_a if particao == "DRIVE_A" else self.drive_b

    def status_conexoes(self) -> Dict[str, Any]:
        """Retorna diagnóstico completo do estado das credenciais dos dois Drives."""
        return {
            "DRIVE_A": {
                "escolas_atendidas": "Escolas 1, 2, 3 e 4",
                "credenciais_presentes": self.drive_a.is_configurado(),
                "arquivo_credenciais": str(self.drive_a.caminho_credenciais.name),
                "online": self.drive_a.conectar() is not None
            },
            "DRIVE_B": {
                "escolas_atendidas": "Escolas 5, 6, 7, 8 e SME (Extintas)",
                "credenciais_presentes": self.drive_b.is_configurado(),
                "arquivo_credenciais": str(self.drive_b.caminho_credenciais.name),
                "online": self.drive_b.conectar() is not None
            }
        }

    def enviar_pagina_webp(
        self,
        caminho_webp: Union[str, Path],
        escola_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Envia uma página WebP escaneada para a partição correta de 15 GB.
        Armazena na subpasta remota da respectiva escola.
        """
        cliente = self.obter_cliente_para_escola(escola_id)
        subpasta = f"escola_{escola_id}_imagens" if escola_id else "sme_extintas_imagens"

        return cliente.enviar_arquivo(
            caminho_local=caminho_webp,
            pasta_remota_nome=subpasta,
            mime_type="image/webp"
        )

    def gerar_e_enviar_backup(
        self,
        escola_id: Optional[int] = None,
        caminho_db: Optional[Union[str, Path]] = None
    ) -> Dict[str, Any]:
        """
        Cria snapshot local do SQLite criptografado com Fernet (.db.enc)
        e despacha para o Google Drive correspondente.
        Se perfil for SME, replica o backup em ambas as partições para redundância máxima.
        """
        db_origem = Path(caminho_db) if caminho_db else (DATA_LOCAL / "acervo_local.db")
        if not db_origem.exists():
            return {"sucesso": False, "mensagem": f"Banco de dados não encontrado: {db_origem}"}

        # 1. Criptografia Fernet Local
        res_cripto = criptografar_backup_sqlite(db_origem)
        caminho_enc = res_cripto["caminho_enc"]

        # 2. Despacho na Nuvem
        eh_sme = config_manager.config_manager.eh_modo_sme()
        envios = []

        if eh_sme:
            # SME envia para os dois Drives (A e B)
            res_a = self.drive_a.enviar_arquivo(
                caminho_local=caminho_enc,
                pasta_remota_nome="backups_acervo_sgm",
                mime_type="application/octet-stream"
            )
            res_b = self.drive_b.enviar_arquivo(
                caminho_local=caminho_enc,
                pasta_remota_nome="backups_acervo_sgm",
                mime_type="application/octet-stream"
            )
            envios = [res_a, res_b]
        else:
            cliente = self.obter_cliente_para_escola(escola_id)
            res = cliente.enviar_arquivo(
                caminho_local=caminho_enc,
                pasta_remota_nome="backups_acervo_sgm",
                mime_type="application/octet-stream"
            )
            envios = [res]

        return {
            "sucesso": True,
            "backup_local": res_cripto,
            "particoes_envio": envios,
            "mensagem": f"Backup criptografado gerado: {Path(caminho_enc).name} ({res_cripto['tamanho_kb']} KB)"
        }


# Instância singleton padrão do Roteador Multi-Drive
drive_router = MultiDriveRouter()
