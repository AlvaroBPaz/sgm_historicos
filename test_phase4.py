"""
SGM-Históricos — Testes Automatizados da FASE 4 (Frontend Desktop, Split-Screen, Matriz e Impressão A4)
"""

import sys
import os
from pathlib import Path
from fastapi.testclient import TestClient

# Garante o path na raiz
BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

import database
import main

client = TestClient(main.app)

def test_arquivos_estaticos_existem():
    print("-> Verificando presença dos arquivos estáticos da Fase 4...")
    arquivos_obrigatorios = [
        "static/index.html",
        "static/impressao_a4.html",
        "static/mobile_scan.html",
        "static/js/app.js",
        "static/js/editor_matriz.js",
        "static/js/split_review.js",
        "app_window.py",
        "iniciar.bat"
    ]
    for rel_path in arquivos_obrigatorios:
        p = BASE_DIR / rel_path
        assert p.exists(), f"Arquivo obrigatório não encontrado: {rel_path}"
        assert p.stat().st_size > 100, f"Arquivo vazio ou corrompido: {rel_path}"
        print(f"   [OK] {rel_path} ({p.stat().st_size} bytes)")

def test_rota_raiz_e_impressao():
    print("\n-> Verificando rotas HTML do FastAPI...")
    
    # 1. Rota raiz /
    r_raiz = client.get("/")
    assert r_raiz.status_code == 200
    assert "SGM-Históricos" in r_raiz.text
    assert "id=\"modalSetupWizard\"" in r_raiz.text
    assert "id=\"modalEdicaoMatriz\"" in r_raiz.text
    print("   [OK] Rota / retornou static/index.html")

    # 2. Rota de Impressão A4
    r_imp = client.get("/impressao/teste-uuid-123")
    assert r_imp.status_code == 200
    assert "HISTÓRICO ESCOLAR" in r_imp.text
    assert "tabelaMatrizA4" in r_imp.text
    assert "qrCodeAutenticidade" in r_imp.text
    print("   [OK] Rota /impressao/{uuid} retornou static/impressao_a4.html")

def test_ciclo_completo_cadastro_aluno_e_integridade():
    print("\n-> Testando cadastro de aluno via API do Editor Matriz e validação HMAC...")
    payload = {
        "aluno": {
            "escola_id": 1,
            "nome_completo": "MARIA DAS DORES OLIVEIRA",
            "data_nascimento": "12/04/1982",
            "naturalidade_municipio": "Porto Alegre",
            "naturalidade_uf": "RS",
            "filiacao_1": "Jose de Oliveira",
            "filiacao_2": "Ana Maria de Oliveira",
            "rg_numero": "1098765432",
            "certidao_tipo": "Nascimento",
            "certidao_termo": "4521",
            "certidao_livro": "A-12",
            "certidao_folha": "88",
            "arquivo_estante": "Estante 02",
            "arquivo_caixa": "Caixa 1996",
            "arquivo_pasta": "Pasta 45",
            "arquivo_ano_referencia": "1996",
            "regime_ensino": "8_ANOS",
            "status_ficha": "DIGITADO"
        },
        "vida_escolar": [
            {
                "ordem_coluna": 1,
                "label_serie": "1ª Série",
                "ano_letivo": "1989",
                "escola_nome": "E.M. Bento Gonçalves",
                "resultado_final": "Aprovado"
            },
            {
                "ordem_coluna": 8,
                "label_serie": "8ª Série",
                "ano_letivo": "1996",
                "escola_nome": "E.M. Bento Gonçalves",
                "resultado_final": "Aprovado"
            }
        ],
        "notas_curriculares": [
            {
                "ordem_coluna": 1,
                "categoria": "BASE_COMUM",
                "ordem_disciplina": 1,
                "disciplina_nome": "Língua Portuguesa",
                "nota_ou_conceito": "8,5"
            },
            {
                "ordem_coluna": 8,
                "categoria": "BASE_COMUM",
                "ordem_disciplina": 1,
                "disciplina_nome": "Língua Portuguesa",
                "nota_ou_conceito": "9,0"
            },
            {
                "ordem_coluna": 8,
                "categoria": "BASE_COMUM",
                "ordem_disciplina": 2,
                "disciplina_nome": "Estudos Sociais",
                "nota_ou_conceito": "8,0"
            }
        ],
        "operador": "Testador Fase 4"
    }

    # 1. Salva via API
    res_salvar = client.post("/api/alunos/historico-completo", json=payload)
    assert res_salvar.status_code == 200
    dados_salvos = res_salvar.json()
    assert dados_salvos["sucesso"] is True
    aluno_uuid = dados_salvos["aluno_uuid"]
    cod_aut = dados_salvos["codigo_autenticidade"]
    print(f"   [OK] Aluno salvo com UUID: {aluno_uuid} | Código: {cod_aut}")

    # 2. Obtém histórico completo com HMAC validado
    res_get = client.get(f"/api/alunos/{aluno_uuid}/historico-completo")
    assert res_get.status_code == 200
    dados_completos = res_get.json()
    assert dados_completos["integridade"]["integro"] is True
    assert dados_completos["aluno"]["nome_completo"] == "MARIA DAS DORES OLIVEIRA"
    assert len(dados_completos["vida_escolar"]) == 2
    assert len(dados_completos["notas_curriculares"]) == 3
    print("   [OK] Histórico recuperado com assinatura HMAC 100% íntegra!")

    # 3. Busca com filtro textual
    res_busca = client.get("/api/alunos?busca=MARIA+DAS+DORES")
    assert res_busca.status_code == 200
    lista_busca = res_busca.json()
    assert lista_busca["total"] >= 1
    assert any(a["uuid"] == aluno_uuid for a in lista_busca["alunos"])
    print("   [OK] Busca multifatorial localizou o registro com sucesso!")

def test_fila_ocr_e_aprovacao_split():
    print("\n-> Testando fluxo da Tela Dividida (Split-Screen) de Revisão IA...")
    
    # 1. Cria uma sessão na fila OCR com status AGUARDANDO_REVISAO
    sessao_dict = database.criar_sessao_ocr(
        escola_id=1,
        origem_captura="SCANNER_PC"
    )
    sessao_id = sessao_dict["sessao_id"]
    database.adicionar_pagina_ocr(sessao_id, "data_local/scans_temp/pagina_teste.webp")
    database.atualizar_status_ocr(
        sessao_id=sessao_id,
        status="AGUARDANDO_REVISAO",
        json_extraido='{"dados_civis": {"nome_completo": {"valor": "JOSE CARLOS SILVA", "baixa_confianca": true}}, "regime_ensino": "8_ANOS"}'
    )

    # 2. Consulta a fila de IA
    r_fila = client.get("/api/ocr/fila")
    assert r_fila.status_code == 200
    dados_fila = r_fila.json()
    assert dados_fila["total_para_revisar"] >= 1
    print(f"   [OK] Fila IA listou {dados_fila['total_para_revisar']} envelope(s) para conferência.")

    # 3. Consulta dados da sessão para o Split-Screen
    r_sessao = client.get(f"/api/ocr/sessao/{sessao_id}")
    assert r_sessao.status_code == 200
    sessao_dados = r_sessao.json()
    assert sessao_dados["dados_ia"]["dados_civis"]["nome_completo"]["valor"] == "JOSE CARLOS SILVA"
    assert sessao_dados["dados_ia"]["dados_civis"]["nome_completo"]["baixa_confianca"] is True
    print("   [OK] Sessão retornou dados estruturados da IA com flag de baixa confiança!")

    # 4. Aprovação pelo funcionário (Aprovar e Salvar)
    payload_aprovacao = {
        "aluno": {
            "escola_id": 1,
            "nome_completo": "JOSE CARLOS DA SILVA CORRIGIDO",
            "regime_ensino": "8_ANOS",
            "status_ficha": "DIGITADO",
            "paginas_webp_json": '["data_local/scans_temp/pagina_teste.webp"]'
        },
        "vida_escolar": [
            {
                "ordem_coluna": 1,
                "label_serie": "1ª Série",
                "ano_letivo": "1990",
                "resultado_final": "Aprovado"
            }
        ],
        "notas_curriculares": [
            {
                "ordem_coluna": 1,
                "categoria": "BASE_COMUM",
                "ordem_disciplina": 1,
                "disciplina_nome": "Matemática",
                "nota_ou_conceito": "7,5"
            }
        ],
        "operador": "Revisor Split-Screen"
    }

    r_aprovar = client.post(f"/api/ocr/sessao/{sessao_id}/aprovar-e-salvar", json=payload_aprovacao)
    assert r_aprovar.status_code == 200
    res_aprovado = r_aprovar.json()
    assert res_aprovado["sucesso"] is True
    print(f"   [OK] Split-Screen aprovou e gravou no SQLite com código {res_aprovado['codigo_autenticidade']}")

    # Verifica se status virou CONCLUIDO
    sessao_fim = database.obter_sessao_ocr(sessao_id)
    assert sessao_fim["status"] == "CONCLUIDO"
    print("   [OK] Sessão de OCR marcada como CONCLUIDO!")

def test_painel_sme_estatisticas():
    print("\n-> Testando API de Estatísticas do Painel SME...")
    r_stats = client.get("/api/estatisticas/painel")
    assert r_stats.status_code == 200
    stats = r_stats.json()
    assert stats["total_alunos_passivo"] >= 2
    assert len(stats["detalhes_por_escola"]) == 8
    print(f"   [OK] Painel SME retornou estatísticas para todas as {len(stats['detalhes_por_escola'])} escolas!")

if __name__ == "__main__":
    print("======================================================================")
    print("  EXECUTANDO BATERIA DE TESTES DA FASE 4 — INTERFACE E MATRIZ")
    print("======================================================================")
    test_arquivos_estaticos_existem();
    test_rota_raiz_e_impressao();
    test_ciclo_completo_cadastro_aluno_e_integridade();
    test_fila_ocr_e_aprovacao_split();
    test_painel_sme_estatisticas();
    print("\n======================================================================")
    print("  TODOS OS TESTES DA FASE 4 PASSARAM COM 100% DE SUCESSO!")
    print("======================================================================")
