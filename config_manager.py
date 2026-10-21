"""
Módulo Gerenciador de Instalação e Modo Camaleão
===============================================
Controla o perfil de operação desta máquina local do SGM-Históricos:
  - Perfil 'ESCOLA': Operação restrita a uma das 8 Escolas Municipais.
    Permite criação e edição exclusivamente para a escola configurada,
    e consulta somente-leitura aos alunos das demais unidades.
  - Perfil 'SME': Operação global como Secretaria Municipal de Educação.
    Acesso e edição irrestritos a todas as 8 escolas e às escolas
    extintas/nucleadas (acervo recolhido pela SME).

A configuração é persistida em './data_local/config_instalacao.json'.

SENHA MESTRA PADRÃO INICIAL DA SME:
  SME@Admin2026
(Verificada via hash criptográfico SHA-256 com salt)
"""

import json
import os
import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# Senha Mestra Padrão Documentada para Primeiro Uso da SME
SENHA_MESTRA_PADRAO = "SME@Admin2026"
SALT_MESTRA_SME = "SGM_CHAMELEON_SALT_2026_SME_PASSIVO"

# Metadados e Códigos de Ativação Oficiais das 8 Escolas Municipais
CATALOGO_ESCOLAS_INICIAIS = [
    {
        "id": 1,
        "nome_oficial": "Escola Municipal Monteiro Lobato",
        "codigo_inep": "29001001",
        "codigo_ativacao": "ESC01-2026",
        "drive_particao": "DRIVE_A",
        "endereco": "Rua das Flores, 100 - Centro",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Decreto Municipal nº 102/1982",
        "ato_autorizacao": "Portaria CEE nº 450/1983",
        "diretor_nome": "Maria Helena de Castro",
        "diretor_registro": "DIR-0492/BA",
        "secretario_nome": "Carlos Alberto Santos",
        "secretario_registro": "SEC-1082/BA"
    },
    {
        "id": 2,
        "nome_oficial": "Escola Municipal Castro Alves",
        "codigo_inep": "29001002",
        "codigo_ativacao": "ESC02-2026",
        "drive_particao": "DRIVE_A",
        "endereco": "Avenida Brasil, 250 - Bairro Novo",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Lei Municipal nº 345/1975",
        "ato_autorizacao": "Resolução CME nº 012/1976",
        "diretor_nome": "Ana Paula Rodrigues",
        "diretor_registro": "DIR-0511/BA",
        "secretario_nome": "Renata Souza Lima",
        "secretario_registro": "SEC-1105/BA"
    },
    {
        "id": 3,
        "nome_oficial": "Escola Municipal Rui Barbosa",
        "codigo_inep": "29001003",
        "codigo_ativacao": "ESC03-2026",
        "drive_particao": "DRIVE_A",
        "endereco": "Praça da Matriz, s/n - Centro Histórico",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Decreto Municipal nº 088/1968",
        "ato_autorizacao": "Portaria SEC nº 123/1970",
        "diretor_nome": "Joaquim Silveira Bueno",
        "diretor_registro": "DIR-0389/BA",
        "secretario_nome": "Luciana Mendes Prado",
        "secretario_registro": "SEC-0988/BA"
    },
    {
        "id": 4,
        "nome_oficial": "Escola Municipal Santos Dumont",
        "codigo_inep": "29001004",
        "codigo_ativacao": "ESC04-2026",
        "drive_particao": "DRIVE_A",
        "endereco": "Rua dos Bandeirantes, 412 - Aeroporto",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Decreto Municipal nº 214/1988",
        "ato_autorizacao": "Portaria CEE nº 512/1989",
        "diretor_nome": "Patrícia Viana Correia",
        "diretor_registro": "DIR-0622/BA",
        "secretario_nome": "Juliana Ferreira Mota",
        "secretario_registro": "SEC-1219/BA"
    },
    {
        "id": 5,
        "nome_oficial": "Escola Municipal Princesa Isabel",
        "codigo_inep": "29001005",
        "codigo_ativacao": "ESC05-2026",
        "drive_particao": "DRIVE_B",
        "endereco": "Avenida Sete de Setembro, 89 - Liberdade",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Lei Municipal nº 499/1991",
        "ato_autorizacao": "Resolução CME nº 045/1992",
        "diretor_nome": "Sandra Maria Albuquerque",
        "diretor_registro": "DIR-0701/BA",
        "secretario_nome": "Marcos Vinicius Dias",
        "secretario_registro": "SEC-1304/BA"
    },
    {
        "id": 6,
        "nome_oficial": "Escola Municipal Tiradentes",
        "codigo_inep": "29001006",
        "codigo_ativacao": "ESC06-2026",
        "drive_particao": "DRIVE_B",
        "endereco": "Rua Minas Gerais, 301 - Bela Vista",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Decreto Municipal nº 140/1980",
        "ato_autorizacao": "Portaria CEE nº 310/1981",
        "diretor_nome": "Fernando de Oliveira Cruz",
        "diretor_registro": "DIR-0455/BA",
        "secretario_nome": "Beatriz Ramos Fontes",
        "secretario_registro": "SEC-1044/BA"
    },
    {
        "id": 7,
        "nome_oficial": "Escola Municipal Machado de Assis",
        "codigo_inep": "29001007",
        "codigo_ativacao": "ESC07-2026",
        "drive_particao": "DRIVE_B",
        "endereco": "Rua Rui Barbosa, 150 - Vila Esperança",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Lei Municipal nº 580/1995",
        "ato_autorizacao": "Portaria CEE nº 620/1996",
        "diretor_nome": "Geraldo Magela Pires",
        "diretor_registro": "DIR-0780/BA",
        "secretario_nome": "Aline Costa Carvalho",
        "secretario_registro": "SEC-1412/BA"
    },
    {
        "id": 8,
        "nome_oficial": "Escola Municipal Cecília Meireles",
        "codigo_inep": "29001008",
        "codigo_ativacao": "ESC08-2026",
        "drive_particao": "DRIVE_B",
        "endereco": "Alameda dos Poetas, 75 - Jardim das Rosas",
        "municipio_uf": "Município Sede - BA",
        "ato_criacao": "Decreto Municipal nº 305/1999",
        "ato_autorizacao": "Portaria CEE nº 710/2000",
        "diretor_nome": "Vera Lúcia Guimarães",
        "diretor_registro": "DIR-0820/BA",
        "secretario_nome": "Cláudia Regina Barros",
        "secretario_registro": "SEC-1490/BA"
    }
]


def calcular_hash_senha_mestra(senha: str, salt: str = SALT_MESTRA_SME) -> str:
    """Calcula o hash seguro SHA-256 com salt para a Senha Mestra."""
    texto_combinado = f"{salt}:{senha.strip()}"
    return hashlib.sha256(texto_combinado.encode("utf-8")).hexdigest()


HASH_MESTRA_PADRAO = calcular_hash_senha_mestra(SENHA_MESTRA_PADRAO)


class ConfigManager:
    """
    Gerenciador singleton do estado de instalação local (Modo Camaleão).
    """

    def __init__(self, caminho_arquivo: Optional[Path | str] = None):
        if caminho_arquivo:
            self.caminho_arquivo = Path(caminho_arquivo)
        else:
            base_dir = Path(__file__).resolve().parent
            self.caminho_arquivo = base_dir / "data_local" / "config_instalacao.json"
        
        self.diretorio_data = self.caminho_arquivo.parent
        self._assegurar_diretorio()

    def _assegurar_diretorio(self) -> None:
        """Garante a existência do diretório './data_local' e subpastas de trabalho."""
        self.diretorio_data.mkdir(parents=True, exist_ok=True)
        (self.diretorio_data / "scans_temp").mkdir(exist_ok=True)
        (self.diretorio_data / "imagens_webp").mkdir(exist_ok=True)

    def is_configurado(self) -> bool:
        """
        Retorna True se o arquivo de configuração existe e contém
        um perfil devidamente ativado ('ESCOLA' ou 'SME').
        """
        if not self.caminho_arquivo.exists():
            return False
        try:
            with open(self.caminho_arquivo, "r", encoding="utf-8") as f:
                dados = json.load(f)
            return bool(dados.get("configurado") is True and dados.get("modo") in ["ESCOLA", "SME"])
        except Exception:
            return False

    def obter_configuracao(self) -> Dict[str, Any]:
        """
        Carrega as configurações atuais da máquina. Se não configurado,
        retorna dicionário padrão de máquina virgem (Setup Wizard pendente).
        """
        if self.caminho_arquivo.exists():
            try:
                with open(self.caminho_arquivo, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

        return {
            "configurado": False,
            "modo": "NAO_CONFIGURADO",
            "escola_id": None,
            "escola_nome": None,
            "drive_particao": None,
            "permissoes_globais": False,
            "data_instalacao": None,
            "operador_instalacao": None,
            "versao_app": "1.0.0",
            "senha_mestra_hash": HASH_MESTRA_PADRAO,
            "senha_mestra_salt": SALT_MESTRA_SME
        }

    def salvar_configuracao(self, dados: Dict[str, Any]) -> Dict[str, Any]:
        """Persiste os dados de configuração em disco com formatação legível."""
        self._assegurar_diretorio()
        temp_file = self.caminho_arquivo.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(dados, f, indent=2, ensure_ascii=False)
        temp_file.replace(self.caminho_arquivo)
        return dados

    def verificar_senha_mestra(self, senha_digitada: str) -> bool:
        """Valida a senha mestra fornecida contra o hash armazenado na instalação."""
        config = self.obter_configuracao()
        salt = config.get("senha_mestra_salt", SALT_MESTRA_SME)
        hash_esperado = config.get("senha_mestra_hash", HASH_MESTRA_PADRAO)
        hash_digitado = calcular_hash_senha_mestra(senha_digitada, salt)
        return hashlib.sha256(hash_digitado.encode()).hexdigest() == hashlib.sha256(hash_esperado.encode()).hexdigest()

    def alterar_senha_mestra(self, senha_antiga: str, nova_senha: str) -> bool:
        """Altera a senha mestra da instalação mediante confirmação da senha antiga."""
        if not self.verificar_senha_mestra(senha_antiga):
            return False
        if not nova_senha or len(nova_senha.strip()) < 6:
            raise ValueError("A nova senha mestra deve conter ao menos 6 caracteres.")
        
        config = self.obter_configuracao()
        novo_salt = hashlib.sha256(os.urandom(16)).hexdigest()[:16]
        novo_hash = calcular_hash_senha_mestra(nova_senha, novo_salt)
        
        config["senha_mestra_salt"] = novo_salt
        config["senha_mestra_hash"] = novo_hash
        self.salvar_configuracao(config)
        return True

    def configurar_modo_escola(
        self,
        escola_id: int,
        codigo_ativacao: str,
        operador_nome: str = "Secretaria Escolar"
    ) -> Dict[str, Any]:
        """
        Ativa a máquina no Perfil Unidade Escolar (Opção A).
        Valida o ID da escola (1 a 8) e o código de ativação.
        """
        escola_info = next((e for e in CATALOGO_ESCOLAS_INICIAIS if e["id"] == escola_id), None)
        if not escola_info:
            raise ValueError(f"Escola municipal ID {escola_id} não encontrada no catálogo oficial.")

        # Validação do código de ativação da unidade escolar
        codigo_esperado = escola_info["codigo_ativacao"].upper().strip()
        codigo_fornecido = codigo_ativacao.upper().strip() if codigo_ativacao else ""

        # Aceita o código da unidade ou a senha mestra global da SME
        if codigo_fornecido != codigo_esperado and not self.verificar_senha_mestra(codigo_ativacao):
            raise ValueError(
                f"Código de ativação inválido para {escola_info['nome_oficial']}. "
                f"Consulte a SME ou verifique o código oficial da unidade."
            )

        config_atual = self.obter_configuracao()
        nova_config = {
            **config_atual,
            "configurado": True,
            "modo": "ESCOLA",
            "escola_id": escola_id,
            "escola_nome": escola_info["nome_oficial"],
            "codigo_inep": escola_info["codigo_inep"],
            "drive_particao": escola_info["drive_particao"],
            "permissoes_globais": False,
            "data_instalacao": datetime.now(timezone.utc).isoformat(),
            "operador_instalacao": operador_nome.strip() or "Secretaria Escolar",
            "versao_app": "1.0.0"
        }
        return self.salvar_configuracao(nova_config)

    def configurar_modo_sme(
        self,
        senha_mestra: str,
        operador_nome: str = "Administrador SME"
    ) -> Dict[str, Any]:
        """
        Ativa a máquina no Perfil Secretaria Municipal de Educação - SME (Opção B).
        Exige autenticação rigorosa via Senha Mestra.
        """
        if not self.verificar_senha_mestra(senha_mestra):
            raise PermissionError("Senha Mestra da Secretaria incorreta. Acesso negado à ativação SME.")

        config_atual = self.obter_configuracao()
        nova_config = {
            **config_atual,
            "configurado": True,
            "modo": "SME",
            "escola_id": None,
            "escola_nome": "Secretaria Municipal de Educação (SME)",
            "codigo_inep": "SME-GLOBAL",
            "drive_particao": "DRIVE_B",  # SME pode acessar ambos; partição padrão para extintas é DRIVE_B
            "permissoes_globais": True,
            "data_instalacao": datetime.now(timezone.utc).isoformat(),
            "operador_instalacao": operador_nome.strip() or "Administrador SME",
            "versao_app": "1.0.0"
        }
        return self.salvar_configuracao(nova_config)

    def resetar_configuracao(self, senha_mestra: str) -> bool:
        """
        Restaura o sistema para o estado de Primeiro Uso (virgem),
        permitindo reconfigurar o perfil da máquina. Exige a Senha Mestra.
        """
        if not self.verificar_senha_mestra(senha_mestra):
            raise PermissionError("Senha Mestra incorreta. Apenas a SME pode desativar o perfil desta máquina.")

        if self.caminho_arquivo.exists():
            self.caminho_arquivo.unlink()
        return True

    # ==========================================================================
    # CONSULTAS RÁPIDAS DE POLÍTICAS DE ACESSO
    # ==========================================================================

    def obter_modo(self) -> str:
        """Retorna 'ESCOLA', 'SME' ou 'NAO_CONFIGURADO'."""
        return self.obter_configuracao().get("modo", "NAO_CONFIGURADO")

    def eh_modo_sme(self) -> bool:
        """Indica se a máquina possui privilégios de Secretaria de Educação."""
        return self.obter_modo() == "SME"

    def obter_escola_id(self) -> Optional[int]:
        """Retorna o ID da escola vinculada (1 a 8), ou None se modo SME."""
        return self.obter_configuracao().get("escola_id")

    def obter_drive_particao(self) -> str:
        """
        Retorna 'DRIVE_A' (escolas 1 a 4) ou 'DRIVE_B' (escolas 5 a 8 e SME).
        """
        config = self.obter_configuracao()
        particao = config.get("drive_particao")
        if particao:
            return particao
        escola_id = config.get("escola_id")
        if escola_id and 1 <= escola_id <= 4:
            return "DRIVE_A"
        return "DRIVE_B"

    def pode_editar_escola(self, escola_id_alvo: int) -> bool:
        """
        Regra de Controle de Acesso do Modo Camaleão:
        - Máquinas da SME podem editar qualquer escola (1 a 8 e extintas >= 9);
        - Máquinas de Escola só podem editar registros da sua própria unidade.
        """
        if self.eh_modo_sme():
            return True
        config_id = self.obter_escola_id()
        return config_id is not None and int(config_id) == int(escola_id_alvo)

    def listar_escolas_catalogo(self) -> List[Dict[str, Any]]:
        """Retorna a lista pública de metadados das 8 escolas para o Setup Wizard."""
        resultado = []
        for e in CATALOGO_ESCOLAS_INICIAIS:
            copia = dict(e)
            # Removemos o código de ativação ao expor para a interface pública
            copia.pop("codigo_ativacao", None)
            resultado.append(copia)
        return resultado


# Instância singleton padrão para o ciclo de vida da aplicação
config_manager = ConfigManager()
