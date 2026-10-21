"""
Módulo de Serviço de Scanner (WIA) e Importação Local de Documentos
==================================================================
Implementa a captura de páginas de históricos escolares conforme Seções 6.1 e 6.2 do SPEC.md:

1. Scanner de Mesa Conectado ao PC (USB / Rede) via WIA (Windows Image Acquisition):
   - Utiliza a automação COM do Windows ('WIA.CommonDialog' e 'WIA.DeviceManager').
   - Prioriza 'win32com.client' com fallback automático para 'comtypes.client'.
   - Fallback gracioso com diagnósticos claros caso não haja scanner conectado ou o operador cancele.
2. Importação de Arquivos Locais (Imagens e PDFs já digitalizados no PC):
   - Suporte a seleção individual ou múltiplos arquivos em lote (JPG, PNG, WebP, TIFF, BMP).
   - Passa todas as páginas capturadas pelo Porteiro de Qualidade e Realce CLAHE (image_processor.py).
   - Registra as páginas aprovadas na fila OCR do banco de dados (database.py).
"""

import os
import sys
import uuid
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from PIL import Image

import image_processor
import database


# Formatos gráficos aceitos para importação local
EXTENSOES_IMAGEM_SUPORTADAS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

# Códigos de erro conhecidos da API WIA do Windows
WIA_ERROR_GENERAL = 0x80210001
WIA_ERROR_PAPER_JAM = 0x80210002
WIA_ERROR_PAPER_EMPTY = 0x80210003
WIA_ERROR_BUSY = 0x80210006
WIA_ERROR_NO_DEVICE_AVAILABLE = 0x80210015
WIA_ERROR_USER_CANCELLED = 0x80210064

# GUID oficial do formato BMP no WIA: {B96B3CAB-0728-11D3-9D7B-0000F81EF32E}
WIA_FORMAT_BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"
# GUID oficial do formato JPG no WIA: {B96B3CAE-0728-11D3-9D7B-0000F81EF32E}
WIA_FORMAT_JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"


def _obter_objeto_com_wia(nome_progid: str):
    """
    Instancia objetos COM da API WIA tentando win32com.client primeiro,
    e recorrendo a comtypes.client como fallback nativo do Windows.
    """
    # Tentativa 1: win32com
    try:
        import win32com.client
        return win32com.client.Dispatch(nome_progid)
    except Exception:
        pass

    # Tentativa 2: comtypes
    try:
        import comtypes.client
        return comtypes.client.CreateObject(nome_progid)
    except Exception:
        pass

    return None


# ==============================================================================
# DETECÇÃO E DIAGNÓSTICO DE SCANNERS DO WINDOWS (WIA)
# ==============================================================================

def listar_scanners_conectados() -> List[Dict[str, Any]]:
    """
    Consulta o WIA.DeviceManager do Windows e retorna a lista de scanners
    conectados (USB ou Rede) disponíveis para captura.
    """
    scanners = []
    dev_mgr = _obter_objeto_com_wia("WIA.DeviceManager")
    if dev_mgr is None:
        return scanners

    try:
        device_infos = dev_mgr.DeviceInfos
        total = getattr(device_infos, "Count", 0)

        for i in range(1, total + 1):
            try:
                # WIA coleções são 1-based
                info = device_infos.Item(i)
                # DeviceType 1 = ScannerDeviceType
                tipo = int(getattr(info, "Type", 0))
                if tipo == 1:
                    dev_id = str(getattr(info, "DeviceID", f"SCANNER-{i}"))
                    props = getattr(info, "Properties", None)
                    nome = "Scanner Desconhecido"
                    if props:
                        try:
                            # Propriedade "Name" no WIA
                            nome = str(props("Name").Value)
                        except Exception:
                            pass
                    scanners.append({
                        "device_id": dev_id,
                        "nome": nome,
                        "tipo": "WIA_SCANNER"
                    })
            except Exception:
                continue
    except Exception:
        pass

    return scanners


def verificar_disponibilidade_scanner() -> Dict[str, Any]:
    """
    Verifica se o subsistema WIA está operacional e se há pelo menos um scanner
    pronto para digitalização física.
    """
    dev_mgr = _obter_objeto_com_wia("WIA.DeviceManager")
    if dev_mgr is None:
        return {
            "disponivel": False,
            "motivo": "COM_WIA_INDISPONIVEL",
            "mensagem": "O serviço Windows Image Acquisition (WIA) não pôde ser iniciado neste computador.",
            "scanners": []
        }

    scanners = listar_scanners_conectados()
    if not scanners:
        return {
            "disponivel": False,
            "motivo": "NENHUM_SCANNER_CONECTADO",
            "mensagem": "Nenhum scanner USB ou de rede foi detectado. Conecte o cabo USB e certifique-se de que o aparelho está ligado.",
            "scanners": []
        }

    return {
        "disponivel": True,
        "motivo": None,
        "mensagem": f"{len(scanners)} scanner(s) pronto(s) para digitalização.",
        "scanners": scanners
    }


# ==============================================================================
# DIGITALIZAÇÃO DIRETA VIA WIA (SCANNER USB)
# ==============================================================================

def digitalizar_pagina_wia(
    sessao_id: str,
    numero_pagina: Optional[int] = None,
    verificar_qualidade: bool = False,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Aciona a caixa de diálogo nativa do Windows (WIA.CommonDialog.ShowAcquireImage)
    para capturar uma página diretamente do vidro ou alimentador do scanner.

    A imagem capturada é salva em arquivo temporário, passa pelo Porteiro CLAHE
    e é comprimida em WebP para o envelope da sessao_id.
    """
    dialog = _obter_objeto_com_wia("WIA.CommonDialog")
    if dialog is None:
        return {
            "sucesso": False,
            "codigo_erro": "WIA_NAO_SUPORTADO",
            "mensagem": "Interface WIA do Windows indisponível nesta máquina."
        }

    # Arquivo temporário intermediário para extrair do COM WIA
    pasta_temp = Path(tempfile.gettempdir()) / "sgm_scans_temp"
    pasta_temp.mkdir(parents=True, exist_ok=True)
    temp_bmp = pasta_temp / f"wia_raw_{uuid.uuid4().hex}.bmp"

    try:
        # ShowAcquireImage:
        # DeviceType=1 (Scanner), Intent=1 (ColorIntent) ou 4 (Grayscale), Bias=1 (MaximizeQuality)
        # FormatID=WIA_FORMAT_BMP, AlwaysSelectDevice=False, UseDevicePage=True
        image_file = dialog.ShowAcquireImage(
            1,                  # 1 = ScannerDeviceType
            1,                  # 1 = ColorIntent (ou 4 para Grayscale)
            0x1,                # 1 = MaximizeQuality
            WIA_FORMAT_BMP,     # Formato BMP para evitar dupla compressão
            False,              # AlwaysSelectDevice
            True,               # UseDevicePage
            False               # CancelError
        )

        if image_file is None:
            return {
                "sucesso": False,
                "codigo_erro": "CANCELADO",
                "mensagem": "A digitalização foi cancelada pelo operador."
            }

        # Salva o bitmap temporário gerado pelo scanner
        if temp_bmp.exists():
            temp_bmp.unlink()
        image_file.SaveFile(str(temp_bmp))

        if not temp_bmp.exists() or temp_bmp.stat().st_size == 0:
            return {
                "sucesso": False,
                "codigo_erro": "ARQUIVO_VAZIO",
                "mensagem": "O scanner não retornou dados de imagem válidos."
            }

        # Determina número da página atual na sessão
        sessao_atual = database.obter_sessao_ocr(sessao_id, caminho_db=caminho_db)
        if sessao_atual and numero_pagina is None:
            import json
            pags = json.loads(sessao_atual.get("paginas_locais_json") or "[]")
            num_pag = len(pags) + 1
        else:
            num_pag = numero_pagina or 1

        # Processamento pelo Porteiro (No caso de scanner de mesa, verificar_qualidade é opcional
        # pois o vidro é plano e estático, mas o CLAHE e redimensionamento 1750px são sempre aplicados)
        proc_resultado = image_processor.processar_pagina_documento(
            origem=temp_bmp,
            sessao_id=sessao_id,
            numero_pagina=num_pag,
            verificar_qualidade=verificar_qualidade
        )

        # Adiciona a página aprovada à sessão no SQLite
        database.adicionar_pagina_ocr(sessao_id, proc_resultado["caminho_webp"], caminho_db=caminho_db)

        return {
            "sucesso": True,
            "origem": "SCANNER_USB_WIA",
            "pagina_numero": num_pag,
            "caminho_webp": proc_resultado["caminho_webp"],
            "tamanho_kb": proc_resultado["tamanho_kb"],
            "largura": proc_resultado["largura"],
            "altura": proc_resultado["altura"],
            "score_nitidez": proc_resultado["score_nitidez"],
            "mensagem": f"Página {num_pag} digitalizada e processada com sucesso!"
        }

    except Exception as exc:
        msg_exc = str(exc)
        # Diagnóstico amigável de exceções comuns COM WIA
        if "0x80210015" in msg_exc or "WIA_ERROR_NO_DEVICE_AVAILABLE" in msg_exc or "Device not found" in msg_exc:
            return {
                "sucesso": False,
                "codigo_erro": "SEM_SCANNER",
                "mensagem": "Nenhum scanner foi encontrado. Conecte o cabo USB do scanner e certifique-se de que ele está ligado."
            }
        elif "0x80210064" in msg_exc or "WIA_ERROR_USER_CANCELLED" in msg_exc or "cancelled" in msg_exc.lower():
            return {
                "sucesso": False,
                "codigo_erro": "CANCELADO",
                "mensagem": "Digitalização cancelada pelo usuário."
            }
        elif "0x80210002" in msg_exc or "JAM" in msg_exc.upper():
            return {
                "sucesso": False,
                "codigo_erro": "PAPEL_PRESO",
                "mensagem": "Papel atolado no alimentador automático do scanner (Paper Jam). Remova a folha e tente novamente."
            }
        elif "0x80210003" in msg_exc or "EMPTY" in msg_exc.upper():
            return {
                "sucesso": False,
                "codigo_erro": "ALIMENTADOR_VAZIO",
                "mensagem": "Alimentador de folhas do scanner vazio."
            }
        elif "0x80210006" in msg_exc or "BUSY" in msg_exc.upper():
            return {
                "sucesso": False,
                "codigo_erro": "SCANNER_OCUPADO",
                "mensagem": "O scanner está ocupado realizando outra operação. Aguarde alguns instantes."
            }
        else:
            return {
                "sucesso": False,
                "codigo_erro": "ERRO_WIA_DESCONHECIDO",
                "mensagem": f"Erro durante a comunicação com o scanner: {msg_exc}"
            }
    finally:
        # Limpeza do arquivo BMP temporário bruto
        if temp_bmp.exists():
            try:
                temp_bmp.unlink()
            except Exception:
                pass


# ==============================================================================
# IMPORTAÇÃO DE ARQUIVOS LOCAIS (IMAGENS E PDFs)
# ==============================================================================

def importar_arquivo_local(
    caminho_arquivo: Union[str, Path],
    sessao_id: str,
    numero_pagina: Optional[int] = None,
    verificar_qualidade: bool = True,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Importa um arquivo já existente no computador do operador (JPG, PNG, WebP, etc.).
    Aplica o Porteiro de Qualidade, realce CLAHE e salva como página WebP oficial do envelope.
    """
    caminho = Path(caminho_arquivo)
    if not caminho.exists():
        return {
            "sucesso": False,
            "codigo_erro": "ARQUIVO_NAO_ENCONTRADO",
            "mensagem": f"O arquivo especificado não existe: {caminho}"
        }

    ext = caminho.suffix.lower()

    # Tratamento para imagens normais
    if ext in EXTENSOES_IMAGEM_SUPORTADAS:
        try:
            # Determina o próximo número de página do envelope
            sessao_atual = database.obter_sessao_ocr(sessao_id, caminho_db=caminho_db)
            if sessao_atual and numero_pagina is None:
                import json
                pags = json.loads(sessao_atual.get("paginas_locais_json") or "[]")
                num_pag = len(pags) + 1
            else:
                num_pag = numero_pagina or 1

            proc_resultado = image_processor.processar_pagina_documento(
                origem=caminho,
                sessao_id=sessao_id,
                numero_pagina=num_pag,
                verificar_qualidade=verificar_qualidade
            )

            database.adicionar_pagina_ocr(sessao_id, proc_resultado["caminho_webp"], caminho_db=caminho_db)

            return {
                "sucesso": True,
                "arquivo_original": caminho.name,
                "pagina_numero": num_pag,
                "caminho_webp": proc_resultado["caminho_webp"],
                "tamanho_kb": proc_resultado["tamanho_kb"],
                "score_nitidez": proc_resultado["score_nitidez"],
                "mensagem": f"Arquivo '{caminho.name}' importado e otimizado com sucesso como Página {num_pag}!"
            }
        except image_processor.QualidadeInsuficienteError as qerr:
            return {
                "sucesso": False,
                "codigo_erro": qerr.codigo_erro,
                "arquivo_original": caminho.name,
                "mensagem": qerr.motivo,
                "metricas": qerr.metricas
            }
        except Exception as err:
            return {
                "sucesso": False,
                "codigo_erro": "ERRO_PROCESSAMENTO",
                "arquivo_original": caminho.name,
                "mensagem": f"Falha ao processar imagem: {err}"
            }

    # Tratamento para arquivos PDF (extração de páginas)
    elif ext == ".pdf":
        return _importar_paginas_pdf(caminho, sessao_id, verificar_qualidade, caminho_db=caminho_db)

    else:
        return {
            "sucesso": False,
            "codigo_erro": "FORMATO_NAO_SUPORTADO",
            "mensagem": f"Formato '{ext}' não suportado. Utilize imagens JPG, PNG, WebP, TIFF ou PDF."
        }


def _importar_paginas_pdf(
    caminho_pdf: Path,
    sessao_id: str,
    verificar_qualidade: bool = False,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Extrai páginas de um arquivo PDF local para convertê-las em páginas do envelope.
    Utiliza bibliotecas disponíveis (ex: pypdf, pypdfium2, pdf2image ou Pillow se suportado).
    """
    paginas_adicionadas = []
    erros = []

    try:
        # Tenta renderização via pypdfium2 se disponível
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(str(caminho_pdf))
        for idx in range(len(pdf)):
            page = pdf.get_page(idx)
            pil_image = page.render(scale=2.0).to_pil_image()
            proc = image_processor.processar_pagina_documento(
                origem=pil_image,
                sessao_id=sessao_id,
                numero_pagina=idx + 1,
                verificar_qualidade=verificar_qualidade
            )
            database.adicionar_pagina_ocr(sessao_id, proc["caminho_webp"], caminho_db=caminho_db)
            paginas_adicionadas.append(proc["caminho_webp"])

        return {
            "sucesso": len(paginas_adicionadas) > 0,
            "arquivo_original": caminho_pdf.name,
            "total_paginas_pdf": len(pdf),
            "paginas_adicionadas": paginas_adicionadas,
            "mensagem": f"PDF com {len(paginas_adicionadas)} página(s) importado com sucesso!"
        }
    except ImportError:
        pass
    except Exception as e:
        erros.append(str(e))

    # Fallback se leitor de PDF não estiver instalado
    return {
        "sucesso": False,
        "codigo_erro": "PDF_EXTRACAO_INDISPONIVEL",
        "mensagem": "Para importar PDFs diretamente, converta as páginas em JPG/PNG ou instale o módulo 'pypdfium2'.",
        "detalhes": erros
    }


def importar_lote_arquivos_locais(
    lista_caminhos: List[Union[str, Path]],
    sessao_id: str,
    verificar_qualidade: bool = True,
    caminho_db: Optional[Union[str, Path]] = None
) -> Dict[str, Any]:
    """
    Importa um lote de múltiplos arquivos selecionados pelo operador
    para compor um único envelope de histórico escolar.
    """
    aprovados = []
    rejeitados = []

    for caminho in lista_caminhos:
        res = importar_arquivo_local(
            caminho_arquivo=caminho,
            sessao_id=sessao_id,
            verificar_qualidade=verificar_qualidade,
            caminho_db=caminho_db
        )
        if res.get("sucesso"):
            aprovados.append(res)
        else:
            rejeitados.append(res)

    return {
        "total_solicitados": len(lista_caminhos),
        "total_aprovados": len(aprovados),
        "total_rejeitados": len(rejeitados),
        "paginas_aprovadas": aprovados,
        "falhas_ou_rejeicoes": rejeitados
    }
