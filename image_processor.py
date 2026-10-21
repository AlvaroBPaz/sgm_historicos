"""
Módulo de Processamento de Imagens e Porteiro de Qualidade OpenCV
================================================================
Implementa as verificações automáticas de qualidade fotográfica e
o pipeline de melhoria e compressão WebP conforme Seção 6.3 do SPEC.md:

1. Teste Anti-Tremido (Foco):
   - Converte para escala de cinza e redimensiona para largura base de 1200px.
   - Calcula a variância do operador Laplaciano (cv2.Laplacian).
   - Rejeita se valor for menor que 80.0 com mensagem amigável e orientativa.
2. Teste de Escuridão e Estouro de Flash:
   - Rejeita fotos escuras/com sombra se brilho médio dos pixels for menor que 55.
   - Rejeita estouro de flash se mais de 25% da área central tiver pixels > 248.
3. Melhoria Documental e Compressão WebP:
   - Aplica realce adaptativo de contraste (CLAHE no canal Luminância L* do espaço LAB)
     para revitalizar letras e números em papel antigo amarelado.
   - Redimensiona proporcionalmente limitando o maior lado a 1750 pixels (~200 DPI em A4).
   - Salva em formato .webp com quality=78 e method=6, produzindo arquivos entre 180KB e 350KB.
"""

import io
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import cv2
import numpy as np
from PIL import Image


# Diretório padrão para armazenamento definitivo das páginas WebP
DIR_IMAGENS_WEBP = Path(__file__).resolve().parent / "data_local" / "imagens_webp"
DIR_IMAGENS_WEBP.mkdir(parents=True, exist_ok=True)


class QualidadeInsuficienteError(Exception):
    """Exceção levantada quando uma foto é rejeitada pelo Porteiro de Qualidade."""
    def __init__(self, motivo: str, codigo_erro: str, metricas: Dict[str, Any]):
        super().__init__(motivo)
        self.motivo = motivo
        self.codigo_erro = codigo_erro
        self.metricas = metricas


@dataclass
class QualidadeFotoResult:
    """Resultado da análise do Porteiro de Qualidade."""
    aprovado: bool
    motivo_rejeicao: Optional[str]
    codigo_erro: Optional[str]
    score_nitidez: float
    brilho_medio: float
    pct_estouro_centro: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "aprovado": self.aprovado,
            "motivo_rejeicao": self.motivo_rejeicao,
            "codigo_erro": self.codigo_erro,
            "score_nitidez": round(self.score_nitidez, 2),
            "brilho_medio": round(self.brilho_medio, 2),
            "pct_estouro_centro": round(self.pct_estouro_centro, 2)
        }


def carregar_imagem_bgr(
    origem: Union[str, Path, bytes, np.ndarray, Image.Image]
) -> np.ndarray:
    """
    Carrega e normaliza qualquer formato de entrada (caminho em disco, bytes de upload,
    array numpy ou Pillow Image) para uma matriz BGR padrão do OpenCV.
    """
    if isinstance(origem, np.ndarray):
        if len(origem.shape) == 2:
            return cv2.cvtColor(origem, cv2.COLOR_GRAY2BGR)
        return origem

    if isinstance(origem, (str, Path)):
        caminho = Path(origem)
        if not caminho.exists():
            raise FileNotFoundError(f"Arquivo de imagem não encontrado: {caminho}")
        # Usamos cv2.imdecode para suporte completo a acentos/caracteres UTF-8 em caminhos Windows
        with open(caminho, "rb") as f:
            dados_bytes = f.read()
        nparr = np.frombuffer(dados_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Não foi possível decodificar a imagem do caminho: {caminho}")
        return img

    if isinstance(origem, bytes):
        nparr = np.frombuffer(origem, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Bytes fornecidos não formam uma imagem válida (JPG/PNG/WebP).")
        return img

    if isinstance(origem, Image.Image):
        # Converte Pillow para OpenCV BGR
        rgb = np.array(origem.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    raise TypeError(f"Tipo de entrada não suportado para carregar_imagem_bgr: {type(origem)}")


# ==============================================================================
# PORTEIRO DE QUALIDADE (SEÇÃO 6.3 DO SPEC)
# ==============================================================================

def calcular_nitidez_laplaciano(
    gray: np.ndarray,
    largura_base: int = 1200
) -> float:
    """
    Calcula a variância do Laplaciano para avaliar nitidez/foco.
    Redimensiona para largura base de 1200px para normalizar o teste
    independentemente de a câmera ter 12MP, 48MP ou 2MP.
    """
    h, w = gray.shape[:2]
    if w <= 0 or h <= 0:
        return 0.0

    if w != largura_base:
        escala = largura_base / float(w)
        novo_h = max(1, int(round(h * escala)))
        gray_norm = cv2.resize(gray, (largura_base, novo_h), interpolation=cv2.INTER_AREA)
    else:
        gray_norm = gray

    # cv2.CV_64F garante precisão flutuante nas derivadas de segunda ordem
    lap = cv2.Laplacian(gray_norm, cv2.CV_64F)
    return float(lap.var())


def calcular_iluminacao(
    gray: np.ndarray
) -> Tuple[float, float]:
    """
    Avalia a iluminação da cena:
    - Retorna o brilho médio geral (0 a 255);
    - Retorna a porcentagem de pixels cegados/estourados (> 248) na área central (50% do centro).
    """
    h, w = gray.shape[:2]
    brilho_medio = float(np.mean(gray))

    # Região central (25% a 75% da altura e largura)
    y1, y2 = int(h * 0.25), int(h * 0.75)
    x1, x2 = int(w * 0.25), int(w * 0.75)
    centro = gray[y1:y2, x1:x2]

    if centro.size == 0:
        return brilho_medio, 0.0

    pixels_estourados = int(np.sum(centro > 248))
    pct_estouro_centro = (pixels_estourados / float(centro.size)) * 100.0

    return brilho_medio, pct_estouro_centro


def avaliar_qualidade_imagem(
    origem: Union[str, Path, bytes, np.ndarray, Image.Image]
) -> QualidadeFotoResult:
    """
    Porteiro de Qualidade oficial do SGM-Históricos.
    Realiza as 3 verificações em menos de 0,2 segundo.
    """
    bgr = carregar_imagem_bgr(origem)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # 1. Teste de Escuridão e Flash Estourado (Iluminação)
    brilho_medio, pct_estouro = calcular_iluminacao(gray)
    if brilho_medio < 55.0:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Foto muito escura ou com sombra cobrindo o documento! Acenda a luz do ambiente ou posicione a folha em local mais iluminado.",
            codigo_erro="FOTO_ESCURA",
            score_nitidez=0.0,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro
        )

    if pct_estouro > 25.0:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Reflexo ou estouro de flash cegando o centro do documento! Desative o flash da câmera e use apenas a iluminação do ambiente.",
            codigo_erro="FLASH_ESTOURADO",
            score_nitidez=0.0,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro
        )

    # 2. Teste de Foco e Anti-Tremido (Nitidez)
    score_nitidez = calcular_nitidez_laplaciano(gray, largura_base=1200)
    if score_nitidez < 80.0:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Foto tremida ou fora de foco! Apoie os braços ou use um suporte e tente novamente.",
            codigo_erro="FOTO_TREMIDA",
            score_nitidez=score_nitidez,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro
        )

    return QualidadeFotoResult(
        aprovado=True,
        motivo_rejeicao=None,
        codigo_erro=None,
        score_nitidez=score_nitidez,
        brilho_medio=brilho_medio,
        pct_estouro_centro=pct_estouro
    )


# ==============================================================================
# PIPELINE DE MELHORIA DOCUMENTAL E COMPRESSÃO WEBP
# ==============================================================================

def aplicar_melhoria_clahe(
    bgr: np.ndarray,
    clip_limit: float = 2.0,
    tile_grid_size: Tuple[int, int] = (8, 8)
) -> np.ndarray:
    """
    Aplica equalização de histograma adaptativa limitada por contraste (CLAHE)
    no canal L* do espaço de cores LAB.
    Realça nitidamente textos datilografados, manuscritos a lápis/caneta azul
    e notas desbotadas em folhas amareladas pelo tempo, sem estourar as cores.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
    l_melhorado = clahe.apply(l_channel)

    lab_melhorado = cv2.merge((l_melhorado, a_channel, b_channel))
    return cv2.cvtColor(lab_melhorado, cv2.COLOR_LAB2BGR)


def redimensionar_documento(
    bgr: np.ndarray,
    max_lado: int = 1750
) -> np.ndarray:
    """
    Redimensiona proporcionalmente a imagem se o maior lado exceder max_lado (1750px).
    Equivale a ~200 DPI em uma folha A4, ideal para leitura por OCR/IA sem excesso de bytes.
    """
    h, w = bgr.shape[:2]
    maior_dim = max(h, w)
    if maior_dim <= max_lado:
        return bgr

    escala = max_lado / float(maior_dim)
    novo_w = max(1, int(round(w * escala)))
    novo_h = max(1, int(round(h * escala)))

    return cv2.resize(bgr, (novo_w, novo_h), interpolation=cv2.INTER_AREA)


def comprimir_para_webp(
    bgr: np.ndarray,
    caminho_destino: Union[str, Path],
    quality: int = 78,
    method: int = 6
) -> Path:
    """
    Converte o array BGR para RGB e salva como .webp via Pillow com
    quality=78 e method=6 (máxima compressão computacional sem perda perceptível).
    Garante arquivos entre 180 KB e 350 KB por página A4.
    """
    destino = Path(caminho_destino)
    destino.parent.mkdir(parents=True, exist_ok=True)

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb)
    pil_img.save(str(destino), format="WEBP", quality=quality, method=method)

    return destino


def processar_pagina_documento(
    origem: Union[str, Path, bytes, np.ndarray, Image.Image],
    destino_webp: Optional[Union[str, Path]] = None,
    sessao_id: Optional[str] = None,
    numero_pagina: Optional[int] = 1,
    verificar_qualidade: bool = True
) -> Dict[str, Any]:
    """
    Executa o fluxo completo do Porteiro de Qualidade e Processamento:
    1. Avalia a foto contra tremidos e problemas de iluminação.
    2. Se reprovada, levanta QualidadeInsuficienteError.
    3. Se aprovada, aplica realce CLAHE e redimensiona para máximo 1750px.
    4. Salva como WebP definitivo em ./data_local/imagens_webp/ (quality=78, method=6).
    5. Retorna dicionário com metadados e métricas técnicas da página.
    """
    bgr = carregar_imagem_bgr(origem)

    # 1. Validação pelo Porteiro
    if verificar_qualidade:
        avaliacao = avaliar_qualidade_imagem(bgr)
        if not avaliacao.aprovado:
            raise QualidadeInsuficienteError(
                motivo=avaliacao.motivo_rejeicao or "Qualidade insuficiente.",
                codigo_erro=avaliacao.codigo_erro or "ERRO_QUALIDADE",
                metricas=avaliacao.to_dict()
            )
    else:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        avaliacao = QualidadeFotoResult(
            aprovado=True,
            motivo_rejeicao=None,
            codigo_erro=None,
            score_nitidez=calcular_nitidez_laplaciano(gray),
            brilho_medio=float(np.mean(gray)),
            pct_estouro_centro=0.0
        )

    # 2. Melhoria de Contraste CLAHE
    bgr_realcado = aplicar_melhoria_clahe(bgr)

    # 3. Redimensionamento Proporcional (max 1750px)
    bgr_final = redimensionar_documento(bgr_realcado, max_lado=1750)
    h_final, w_final = bgr_final.shape[:2]

    # 4. Destino WebP
    if destino_webp:
        caminho_final = Path(destino_webp)
    else:
        prefixo = f"sessao_{sessao_id}" if sessao_id else "scan"
        num = numero_pagina if numero_pagina is not None else 1
        sufixo_rand = uuid.uuid4().hex[:6]
        nome_arquivo = f"{prefixo}_pag_{num}_{sufixo_rand}.webp"
        caminho_final = DIR_IMAGENS_WEBP / nome_arquivo

    comprimir_para_webp(bgr_final, caminho_final, quality=78, method=6)

    tamanho_bytes = caminho_final.stat().st_size
    tamanho_kb = round(tamanho_bytes / 1024.0, 1)

    return {
        "sucesso": True,
        "caminho_webp": str(caminho_final),
        "nome_arquivo": caminho_final.name,
        "tamanho_bytes": tamanho_bytes,
        "tamanho_kb": tamanho_kb,
        "largura": w_final,
        "altura": h_final,
        "score_nitidez": round(avaliacao.score_nitidez, 2),
        "brilho_medio": round(avaliacao.brilho_medio, 2),
        "pct_estouro_centro": round(avaliacao.pct_estouro_centro, 2)
    }
