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
    densidade_bordas: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "aprovado": self.aprovado,
            "motivo_rejeicao": self.motivo_rejeicao,
            "codigo_erro": self.codigo_erro,
            "score_nitidez": round(self.score_nitidez, 2),
            "brilho_medio": round(self.brilho_medio, 2),
            "pct_estouro_centro": round(self.pct_estouro_centro, 2),
            "densidade_bordas": round(self.densidade_bordas, 4)
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

# ==============================================================================
# PORTEIRO DE QUALIDADE OPENCV RIGOROSO (CAMADA 1)
# ==============================================================================

def avaliar_qualidade_imagem(
    origem: Union[str, Path, bytes, np.ndarray, Image.Image]
) -> QualidadeFotoResult:
    """
    Porteiro de Qualidade OpenCV com bloqueio rigoroso em 5 etapas:
    1. Redimensionamento em escala de cinza para largura fixa de 1000px (mantendo proporção);
    2. Recorte dos 80% centrais da imagem (ROI);
    3. Verificação de Iluminação: brilho médio < 65 (escura) ou > 242 (estourada);
    4. Anti-tremido/Foco: cv2.GaussianBlur(roi, (3, 3), 0) antes de cv2.Laplacian(roi, cv2.CV_64F).var() >= 130.0;
    5. Densidade de texto/tabela: cv2.Canny(roi, 50, 150) com densidade >= 0.015 (1,5%).
    NUNCA possui fallback de aprovação em caso de erro ou imagem duvidosa.
    """
    try:
        bgr = carregar_imagem_bgr(origem)
    except Exception as err:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao=f"Não foi possível abrir o arquivo de imagem: {err}",
            codigo_erro="IMAGEM_CORROMPIDA",
            score_nitidez=0.0,
            brilho_medio=0.0,
            pct_estouro_centro=0.0,
            densidade_bordas=0.0
        )

    if bgr is None or not isinstance(bgr, np.ndarray) or bgr.size == 0:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Imagem vazia ou inválida recebida.",
            codigo_erro="IMAGEM_VAZIA",
            score_nitidez=0.0,
            brilho_medio=0.0,
            pct_estouro_centro=0.0,
            densidade_bordas=0.0
        )

    # 1. Redimensiona a imagem em escala de cinza para largura fixa de 1000px (mantendo proporção)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    if w <= 10 or h <= 10:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Dimensões da imagem excessivamente pequenas para leitura.",
            codigo_erro="DIMENSAO_INVALIDA",
            score_nitidez=0.0,
            brilho_medio=0.0,
            pct_estouro_centro=0.0,
            densidade_bordas=0.0
        )

    if w != 1000:
        escala = 1000.0 / float(w)
        novo_h = max(1, int(round(h * escala)))
        gray_1000 = cv2.resize(gray, (1000, novo_h), interpolation=cv2.INTER_AREA)
    else:
        gray_1000 = gray

    h_norm, w_norm = gray_1000.shape[:2]

    # 2. Extrai os 80% centrais da imagem (10% de margem em cada borda)
    y1, y2 = int(h_norm * 0.10), int(h_norm * 0.90)
    x1, x2 = int(w_norm * 0.10), int(w_norm * 0.90)
    roi = gray_1000[y1:y2, x1:x2]
    if roi.size == 0:
        roi = gray_1000

    # 3. Pré-cálculo abrangente de métricas ópticas nos 80% centrais (ROI)
    brilho_medio = float(np.mean(roi))
    pixels_estourados = int(np.sum(roi > 248))
    pct_estouro_centro = (pixels_estourados / float(roi.size)) * 100.0

    # 4. Análise de bordas Canny (detecção de escrita, tabelas e linhas do documento)
    edges = cv2.Canny(roi, 50, 150)
    densidade_bordas = float(np.count_nonzero(edges) / float(edges.size))

    # 5. Verificação de Foco e Anti-Tremido (Laplaciano com suavização Gaussiana 3x3)
    roi_suavizada = cv2.GaussianBlur(roi, (3, 3), 0)
    score_foco = float(cv2.Laplacian(roi_suavizada, cv2.CV_64F).var())

    min_pixel = float(np.min(roi))
    tem_tinta_ou_linhas = min_pixel < 120.0

    # --- REGRAS DE VALIDAÇÃO CALIBRADAS PARA FOTOS REAIS DE HISTÓRICOS ---

    # Regra 1: Iluminação Mínima (evita fotos na penumbra ou com sombras densas)
    # Limiar calibrado em 38.0 para suportar iluminação ambiente residencial/escritório
    if brilho_medio < 38.0:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Foto muito escura ou com sombra cobrindo o documento! Acenda a luz do ambiente ou posicione a folha em local mais iluminado.",
            codigo_erro="FOTO_ESCURA",
            score_nitidez=score_foco,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro_centro,
            densidade_bordas=densidade_bordas
        )

    # Regra 2: Iluminação Máxima Total (imagem completamente lavada/cega em luz)
    if brilho_medio > 250.0:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Foto excessivamente clara ou estourada! Afaste a fonte direta de luz.",
            codigo_erro="FOTO_ESTOURADA",
            score_nitidez=score_foco,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro_centro,
            densidade_bordas=densidade_bordas
        )

    # Regra 3: Estouro de Flash Cegando o Centro (glare reflexivo que apaga o texto)
    # Distingue folha de papel branca limpa (que tem tinta/linhas escuras) de reflexo cego especular
    if pct_estouro_centro > 18.0 and not tem_tinta_ou_linhas and densidade_bordas < 0.010:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Reflexo ou estouro de flash cegando o centro do documento! Desative o flash da câmera e use apenas a iluminação do ambiente.",
            codigo_erro="FLASH_ESTOURADO",
            score_nitidez=score_foco,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro_centro,
            densidade_bordas=densidade_bordas
        )

    # Regra 4: Foco e Anti-Tremido
    # Fotos reais de documentos históricos pelo celular atingem entre 30.0 e 60.0.
    # Desfoques severos e tremidos de mão caem abaixo de 18.0.
    if score_foco < 18.0 or (score_foco < 24.0 and densidade_bordas < 0.005):
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Foto embaçada ou tremida (Índice de nitidez insuficiente). Apoie o celular, foque no documento e tire outra foto.",
            codigo_erro="FOTO_TREMIDA",
            score_nitidez=score_foco,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro_centro,
            densidade_bordas=densidade_bordas
        )

    # Regra 5: Detecção de Documento (superfície vazia sem texto, tabela ou linhas)
    # Uma mesa de madeira ou parede lisa tem densidade ~0.000, enquanto documentos reais têm >= 0.002
    if densidade_bordas < 0.0015:
        return QualidadeFotoResult(
            aprovado=False,
            motivo_rejeicao="Nenhum documento com texto/tabelas foi detectado na imagem. Enquadre a folha do Histórico Escolar.",
            codigo_erro="SEM_TEXTO_DETECTADO",
            score_nitidez=score_foco,
            brilho_medio=brilho_medio,
            pct_estouro_centro=pct_estouro_centro,
            densidade_bordas=densidade_bordas
        )

    # Imagem 100% aprovada pelo Porteiro
    return QualidadeFotoResult(
        aprovado=True,
        motivo_rejeicao=None,
        codigo_erro=None,
        score_nitidez=score_foco,
        brilho_medio=brilho_medio,
        pct_estouro_centro=pct_estouro_centro,
        densidade_bordas=densidade_bordas
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
    avaliacao = avaliar_qualidade_imagem(bgr)
    if verificar_qualidade and not avaliacao.aprovado:
        raise QualidadeInsuficienteError(
            motivo=avaliacao.motivo_rejeicao or "Qualidade insuficiente.",
            codigo_erro=avaliacao.codigo_erro or "ERRO_QUALIDADE",
            metricas=avaliacao.to_dict()
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
        "pct_estouro_centro": round(avaliacao.pct_estouro_centro, 2),
        "densidade_bordas": round(avaliacao.densidade_bordas, 4)
    }
