"""
Script de Testes e Validação da Fase 2 - SGM-Históricos
Cobre: image_processor.py, scanner_service.py e ocr_queue_worker.py
"""

import os
import sys
import json
import time
import shutil
import numpy as np
import cv2
from pathlib import Path
from PIL import Image

import image_processor
import scanner_service
import ocr_queue_worker
import database


print("=======================================================")
print(" INICIANDO TESTES DA FASE 2: CAPTURA, QUALIDADE E IA")
print("=======================================================")

# Diretório de teste
teste_dir = Path("./data_local/teste_fase2")
teste_dir.mkdir(parents=True, exist_ok=True)
teste_db_path = teste_dir / "teste_acervo_fase2.db"
if teste_db_path.exists():
    teste_db_path.unlink()
database.init_db(teste_db_path)

# ==============================================================================
# 1. TESTE DO PORTEIRO DE QUALIDADE (image_processor.py)
# ==============================================================================
print("\n--- TESTE 1: Porteiro de Qualidade e Processamento de Imagens ---")

# 1.1 Teste de Imagem Nítida e Bem Iluminada
img_nitida = np.full((1400, 1000, 3), 190, dtype=np.uint8)
# Adiciona texto e linhas de grade nítidas
for y in range(100, 1300, 80):
    cv2.line(img_nitida, (50, y), (950, y), (30, 30, 30), 2)
cv2.putText(img_nitida, "SECRETARIA MUNICIPAL DE EDUCACAO", (80, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 3)
cv2.putText(img_nitida, "HISTORICO ESCOLAR DO 1o GRAU", (120, 150), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (20, 20, 20), 3)

res_nitida = image_processor.avaliar_qualidade_imagem(img_nitida)
print(f"Foto Nítida -> Aprovada: {res_nitida.aprovado} (Nitidez: {res_nitida.score_nitidez:.1f}, Brilho: {res_nitida.brilho_medio:.1f})")
assert res_nitida.aprovado is True, "Foto com texto nítido deveria ser aprovada"
assert res_nitida.score_nitidez >= 80.0, "Score de nitidez deveria ser >= 80.0"

# 1.2 Teste de Foto Tremida / Fora de Foco (Desfoque Gaussiano severo)
img_tremida = cv2.GaussianBlur(img_nitida, (51, 51), 0)
res_tremida = image_processor.avaliar_qualidade_imagem(img_tremida)
print(f"Foto Tremida -> Aprovada: {res_tremida.aprovado} (Código: {res_tremida.codigo_erro}, Nitidez: {res_tremida.score_nitidez:.1f})")
assert res_tremida.aprovado is False, "Foto borrada/tremida deveria ser reprovada"
assert res_tremida.codigo_erro == "FOTO_TREMIDA"
assert "fora de foco" in res_tremida.motivo_rejeicao.lower()

# 1.3 Teste de Foto Muito Escura (brilho < 55)
img_escura = np.full((1200, 1000, 3), 35, dtype=np.uint8)
res_escura = image_processor.avaliar_qualidade_imagem(img_escura)
print(f"Foto Escura -> Aprovada: {res_escura.aprovado} (Código: {res_escura.codigo_erro}, Brilho: {res_escura.brilho_medio:.1f})")
assert res_escura.aprovado is False, "Foto escura deveria ser reprovada"
assert res_escura.codigo_erro == "FOTO_ESCURA"
assert "escura" in res_escura.motivo_rejeicao.lower()

# 1.4 Teste de Estouro de Flash no Centro (> 25% com brilho > 248)
img_flash = np.full((1200, 1000, 3), 160, dtype=np.uint8)
h, w = img_flash.shape[:2]
# Simula círculo de reflexo cego de flash bem no centro
cv2.circle(img_flash, (w // 2, h // 2), 220, (255, 255, 255), -1)
res_flash = image_processor.avaliar_qualidade_imagem(img_flash)
print(f"Foto Flash -> Aprovada: {res_flash.aprovado} (Código: {res_flash.codigo_erro}, % Estouro Centro: {res_flash.pct_estouro_centro:.1f}%)")
assert res_flash.aprovado is False, "Estouro de flash no centro deveria ser reprovado"
assert res_flash.codigo_erro == "FLASH_ESTOURADO"
assert "flash" in res_flash.motivo_rejeicao.lower()

# 1.5 Teste do Filtro CLAHE e Compressão WebP (largura max 1750, quality=78)
img_amarelada = np.full((2400, 1800, 3), (170, 220, 240), dtype=np.uint8) # BGR amarelado de papel velho
cv2.putText(img_amarelada, "DISCIPLINA: ESTUDOS SOCIAIS - NOTA: 8,5", (100, 500), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (40, 50, 60), 4)

caminho_webp_destino = teste_dir / "pagina_otimizada.webp"
proc = image_processor.processar_pagina_documento(
    origem=img_amarelada,
    destino_webp=caminho_webp_destino,
    verificar_qualidade=False
)
assert caminho_webp_destino.exists(), "Arquivo WebP deveria ter sido gerado"
assert max(proc["largura"], proc["altura"]) <= 1750, f"Maior lado deveria ser <= 1750, obteve {max(proc['largura'], proc['altura'])}"
print(f"✓ CLAHE e WebP concluídos: {proc['nome_arquivo']} ({proc['largura']}x{proc['altura']}, {proc['tamanho_kb']} KB)")
assert proc["tamanho_bytes"] > 0, "Tamanho deve ser maior que 0"

# ==============================================================================
# 2. TESTE DO SERVIÇO DE SCANNER WIA E IMPORTAÇÃO LOCAL (scanner_service.py)
# ==============================================================================
print("\n--- TESTE 2: Scanner WIA e Importação Local (scanner_service.py) ---")

# 2.1 Verificação de Scanner WIA (Diagnóstico gracioso)
disp_scanner = scanner_service.verificar_disponibilidade_scanner()
print(f"Diagnóstico WIA: Disponível={disp_scanner['disponivel']} | Mensagem: {disp_scanner['mensagem']}")
assert isinstance(disp_scanner["disponivel"], bool)
assert "scanners" in disp_scanner

# 2.2 Criação de Sessão OCR no SQLite
sessao = database.criar_sessao_ocr(escola_id=1, origem_captura="SCANNER_PC", caminho_db=teste_db_path)
sessao_id = sessao["sessao_id"]
print(f"Sessão OCR criada para teste: {sessao_id}")

# 2.3 Importação de Imagem Local para a Sessão
# Salva uma imagem temporária JPG em disco
temp_jpg = teste_dir / "documento_frente.jpg"
cv2.imwrite(str(temp_jpg), img_nitida)

res_import = scanner_service.importar_arquivo_local(
    caminho_arquivo=temp_jpg,
    sessao_id=sessao_id,
    verificar_qualidade=True,
    caminho_db=teste_db_path
)
assert res_import["sucesso"] is True, f"Falha na importação: {res_import}"
print(f"✓ Imagem local importada como Página {res_import['pagina_numero']}: {res_import['caminho_webp']}")

# 2.4 Importação de Segundo Arquivo (Verso)
temp_verso_jpg = teste_dir / "documento_verso.jpg"
cv2.imwrite(str(temp_verso_jpg), img_nitida)

res_import_verso = scanner_service.importar_arquivo_local(
    caminho_arquivo=temp_verso_jpg,
    sessao_id=sessao_id,
    verificar_qualidade=True,
    caminho_db=teste_db_path
)
assert res_import_verso["sucesso"] is True
assert res_import_verso["pagina_numero"] == 2
print(f"✓ Verso importado como Página {res_import_verso['pagina_numero']}: {res_import_verso['caminho_webp']}")

# Verifica se a sessão no SQLite agora tem 2 páginas
sessao_db = database.obter_sessao_ocr(sessao_id, caminho_db=teste_db_path)
paginas_salvas = json.loads(sessao_db["paginas_locais_json"])
assert len(paginas_salvas) == 2, f"Esperado 2 páginas na sessão, obteve {len(paginas_salvas)}"
print(f"✓ Sessão SQLite atualizada com {len(paginas_salvas)} páginas WebP!")

# 2.5 Teste de Importação de Arquivo Inexistente (Tratamento Gracioso)
res_inexistente = scanner_service.importar_arquivo_local(
    caminho_arquivo=teste_dir / "arquivo_fantasma.jpg",
    sessao_id=sessao_id,
    caminho_db=teste_db_path
)
assert res_inexistente["sucesso"] is False
assert res_inexistente["codigo_erro"] == "ARQUIVO_NAO_ENCONTRADO"
print("✓ Detecção de arquivo inexistente tratada graciosamente!")

# ==============================================================================
# 3. TESTE DA FILA ASSÍNCRONA E SCHEMAS PYDANTIC (ocr_queue_worker.py)
# ==============================================================================
print("\n--- TESTE 3: Fila Assíncrona e Modelos Pydantic (ocr_queue_worker.py) ---")

# 3.1 Validação do Esquema Pydantic HistoricoExtraidoSchema
dados_exemplo_json = {
    "regime_ensino": "8_ANOS",
    "dados_civis": {
        "nome_completo": {"valor": "Anísio Teixeira da Silva", "baixa_confianca": False},
        "data_nascimento": {"valor": "12/07/1972", "baixa_confianca": False},
        "naturalidade_municipio": {"valor": "Salvador", "baixa_confianca": False},
        "naturalidade_uf": {"valor": "BA", "baixa_confianca": False},
        "nacionalidade": {"valor": "Brasileira", "baixa_confianca": False},
        "filiacao_1": {"valor": "Maria Teixeira", "baixa_confianca": False},
        "filiacao_2": {"valor": "Antônio da Silva", "baixa_confianca": False},
        "rg_numero": {"valor": "1.234.567", "baixa_confianca": False},
        "rg_orgao_uf": {"valor": "SSP/BA", "baixa_confianca": False},
        "cpf": {"valor": "123.456.789-00", "baixa_confianca": False},
        "codigo_inep_aluno": {"valor": "987654321", "baixa_confianca": False},
        "certidao_tipo": {"valor": "Nascimento", "baixa_confianca": False},
        "certidao_termo": {"valor": "1023", "baixa_confianca": False},
        "certidao_livro": {"valor": "A-12", "baixa_confianca": False},
        "certidao_folha": {"valor": "45", "baixa_confianca": False},
        "certidao_cartorio": {"valor": "Cartório do 1º Ofício", "baixa_confianca": False},
        "certidao_municipio_uf": {"valor": "Salvador - BA", "baixa_confianca": False},
        "arquivo_ano_referencia": {"valor": "1988", "baixa_confianca": False}
    },
    "series_cursadas": [
        {
            "ordem_coluna": 1,
            "label_serie": {"valor": "1ª Série", "baixa_confianca": False},
            "ano_letivo": {"valor": "1981", "baixa_confianca": False},
            "escola_nome": {"valor": "Escola Municipal Monteiro Lobato", "baixa_confianca": False},
            "escola_municipio_uf": {"valor": "Município Sede - BA", "baixa_confianca": False},
            "dias_letivos": {"valor": "180", "baixa_confianca": False},
            "carga_horaria_total": {"valor": "720", "baixa_confianca": False},
            "frequencia_percentual": {"valor": "90%", "baixa_confianca": False},
            "resultado_final": {"valor": "Aprovado", "baixa_confianca": False}
        }
    ],
    "notas_curriculares": [
        {
            "ordem_coluna": 1,
            "categoria": "BASE_COMUM",
            "ordem_disciplina": 1,
            "disciplina_nome": {"valor": "Estudos Sociais", "baixa_confianca": False},
            "nota_ou_conceito": {"valor": "8,5", "baixa_confianca": False},
            "carga_horaria_disciplina": {"valor": "80", "baixa_confianca": False}
        },
        {
            "ordem_coluna": 1,
            "categoria": "BASE_COMUM",
            "ordem_disciplina": 2,
            "disciplina_nome": {"valor": "OSPB", "baixa_confianca": True}, # Dúvida/rasura na sigla
            "nota_ou_conceito": {"valor": "7,0", "baixa_confianca": True}, # Nota com borrão
            "carga_horaria_disciplina": {"valor": "60", "baixa_confianca": False}
        }
    ],
    "observacoes_historico": {
        "valor": "Concluiu o 1º Grau nos termos da Lei Federal nº 5.692/71.",
        "baixa_confianca": False
    }
}

schema_validado = ocr_queue_worker.HistoricoExtraidoSchema.model_validate(dados_exemplo_json)
assert schema_validado.regime_ensino == "8_ANOS"
assert schema_validado.dados_civis.nome_completo.valor == "Anísio Teixeira da Silva"
assert len(schema_validado.notas_curriculares) == 2
# Verifica a flag de baixa confiança
assert schema_validado.notas_curriculares[1].disciplina_nome.baixa_confianca is True
assert schema_validado.notas_curriculares[1].nota_ou_conceito.baixa_confianca is True
print("✓ Pydantic HistoricoExtraidoSchema validado com sucesso com flags de baixa_confianca!")

# 3.2 Teste do Controle de Taxa (Rate Limiter: intervalo mínimo de 5s entre chamadas)
worker_cliente = ocr_queue_worker.GeminiClientWorker()
t0 = time.time()
worker_cliente._ultima_requisicao_ts = t0
# Chamada imediata deve aguardar o delta até completar 5 segundos
worker_cliente._esperar_taxa_limite()
t1 = time.time()
duracao = t1 - t0
print(f"✓ Rate Limiter respeitou intervalo mínimo: {duracao:.2f}s (esperado >= 4.9s)")
assert duracao >= 4.5, "Rate limiter deveria garantir espaçamento mínimo de ~5s"

# 3.3 Teste do Processamento de Sessão na Fila sem Chave API (Modo Offline Gracioso)
# Avança a sessão para PENDENTE_IA
database.atualizar_status_ocr(sessao_id, "PENDENTE_IA", caminho_db=teste_db_path)

# Garante que teste não dependa de chave de API externa
old_key = os.environ.pop("GEMINI_API_KEY", None)
res_sem_chave = ocr_queue_worker.processar_sessao_ocr(sessao_id, caminho_db=teste_db_path)
print(f"Processamento sem Chave API: Status={res_sem_chave.get('status')} | {res_sem_chave.get('mensagem')}")
assert res_sem_chave["status"] == "PENDENTE_IA"
sessao_pos = database.obter_sessao_ocr(sessao_id, caminho_db=teste_db_path)
assert sessao_pos["status"] == "PENDENTE_IA", "Sessão deve permanecer em PENDENTE_IA sem quebrar"
if old_key:
    os.environ["GEMINI_API_KEY"] = old_key

# 3.4 Teste da Thread de Fila Assíncrona em Background
worker_thread = ocr_queue_worker.iniciar_worker_ocr(caminho_db=teste_db_path)
assert worker_thread.is_alive()
print("✓ Thread de background OcrQueueWorkerThread iniciada com sucesso!")
time.sleep(1.0)
ocr_queue_worker.parar_worker_ocr()
assert not worker_thread.is_alive()
print("✓ Thread de background finalizada com encerramento gracioso!")

# ==============================================================================
# LIMPEZA DOS ARQUIVOS DE TESTE
# ==============================================================================
if teste_dir.exists():
    try:
        shutil.rmtree(teste_dir)
    except Exception:
        pass

print("\n=======================================================")
print(" TODOS OS TESTES DA FASE 2 PASSARAM COM 100% DE SUCESSO!")
print("=======================================================")
