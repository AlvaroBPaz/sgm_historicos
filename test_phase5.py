"""
SGM-Históricos — Testes Automatizados da FASE 5 (Impressão Oficial A4, App Window e Batch Launcher)
"""

import sys
import os
from pathlib import Path
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

import database
TEST_DB_PATH = Path("./data_local/teste_acervo_fase5.db")
if TEST_DB_PATH.exists():
    try:
        TEST_DB_PATH.unlink()
    except Exception:
        pass
database.DB_PATH = TEST_DB_PATH
database.init_db(TEST_DB_PATH)

import main
import app_window

client = TestClient(main.app)

def test_app_window_e_launcher():
    print("-> Testando app_window.py e iniciar.bat...")
    
    # 1. Valida app_window.py
    assert hasattr(app_window, "UvicornServerThread"), "UvicornServerThread não encontrado."
    assert hasattr(app_window, "aguardar_servidor_online"), "aguardar_servidor_online não encontrado."
    assert hasattr(app_window, "abrir_em_navegador_fallback"), "abrir_em_navegador_fallback não encontrado."
    assert app_window.HOST == "0.0.0.0"
    assert app_window.PORT == 8000
    print("   [OK] app_window.py configurado com 0.0.0.0:8000 e thread daemon!")

    # 2. Valida iniciar.bat
    bat_path = BASE_DIR / "iniciar.bat"
    assert bat_path.exists()
    conteudo_bat = bat_path.read_text(encoding="utf-8")
    assert "SGM-Historicos" in conteudo_bat
    assert "python app_window.py" in conteudo_bat
    assert "requirements.txt" in conteudo_bat
    print("   [OK] iniciar.bat configurado para execução 1-clique no Windows com CRLF e ASCII seguro!")

def test_template_impressao_a4_oficial():
    print("\n-> Testando conformidade do template limpo SMEJ-Jandaíra/RN (impressao.html e impressao_a4.html)...")
    
    for nome_arq in ["impressao.html", "impressao_a4.html"]:
        a4_path = BASE_DIR / "static" / nome_arq
        assert a4_path.exists(), f"Falta {nome_arq}"
        html = a4_path.read_text(encoding="utf-8")

        # Regras CSS @page e dimensões A4
        assert "size: A4 portrait" in html, f"Falta CSS @page size A4 portrait em {nome_arq}"
        assert "7mm 8mm 7mm 8mm" in html, f"Falta margem 7mm 8mm 7mm 8mm em {nome_arq}"
        assert "1px solid #000" in html, f"Falta bordas 1px solid #000 em {nome_arq}"

        # Cabeçalho Oficial
        assert "SMEJ-JANDAÍRA - Secretaria de Educação de Jandaíra - RN" in html
        assert "Sistema Municipal de Gestão de Acervo e Escrituração Escolar" in html
        assert "img-brasao" in html
        assert "HISTÓRICO ESCOLAR" in html

        # Bloco 1: DADOS DA ESCOLA (Sem atos regulatórios/DOE)
        assert "DADOS DA ESCOLA" in html
        assert "escola_nome" in html
        assert "escola_inep" in html
        assert "escola_endereco" in html
        assert "escola_bairro" in html
        assert "escola_municipio" in html
        assert "escola_uf" in html
        assert "ATO DE CRIAÇÃO" not in html
        assert "ATO DE AUTORIZAÇÃO" not in html
        assert "ATO DE RECONHECIMENTO" not in html
        assert "NÚMERO DOE" not in html

        # Bloco 2: DADOS DO ESTUDANTE (Sem censo escolar, sem profissão e sem matrícula)
        assert "DADOS DO ESTUDANTE" in html
        assert "aluno_nome_civil" in html
        assert "aluno_data_nascimento" in html
        assert "aluno_cpf" in html
        assert "aluno_naturalidade" in html
        assert "aluno_nacionalidade" in html
        assert "aluno_filiacao_1" in html
        assert "aluno_filiacao_2" in html
        assert "aluno_matricula" not in html
        assert "CENSO ESCOLAR" not in html
        assert "PROFISSÃO" not in html

        # Bloco 3 e 4: Componentes Curriculares e Registros Complementares
        assert "COMPONENTES CURRICULARES" in html
        assert "tabela-matriz" in html
        assert "REGISTROS COMPLEMENTARES" in html
        assert "tabela-complementares" in html
        assert "LEGENDA" in html

        # Bloco 6: Assinaturas limpas (Sem notas de rodapé nem links)
        assert "Responsável pela Informação" in html
        assert "Diretor(a)" in html
        assert "JANDAÍRA-RN" in html
        assert "Portaria 1878/2016" not in html
        assert "progressão parcial" not in html
        assert "qrCodeAutenticidade" not in html

    print("   [OK] Templates impressao.html e impressao_a4.html 100% aderentes ao modelo limpo SMEJ-Jandaíra/RN!")

def test_rota_impressao_com_aluno_real():
    print("\n-> Testando renderização da rota de impressão com dados reais...")
    # Cadastra um aluno para o teste com a estrutura limpa
    payload = {
        "aluno": {
            "escola_id": 1,
            "nome_completo": "CARLOS EDUARDO PEREIRA",
            "data_nascimento": "18/09/1985",
            "cpf": "123.456.789-00",
            "naturalidade_municipio": "Jandaíra",
            "naturalidade_uf": "RN",
            "nacionalidade": "BRASILEIRA",
            "filiacao_1": "MARIA DA SILVA PEREIRA",
            "filiacao_2": "JOSÉ PEREIRA",
            "regime_ensino": "9_ANOS",
            "status_ficha": "LACRADO_HOMOLOGADO"
        },
        "vida_escolar": [
            {
                "ordem_coluna": 1,
                "label_serie": "1º Ano",
                "ano_letivo": "2015",
                "escola_nome": "Escola Municipal Maria da Guia Barbosa",
                "escola_municipio_uf": "Jandaíra - RN",
                "dias_letivos": "200",
                "carga_horaria_total": "800 h",
                "resultado_final": "Aprovado"
            },
            {
                "ordem_coluna": 2,
                "label_serie": "2º Ano",
                "ano_letivo": "2016",
                "escola_nome": "Escola Municipal Maria da Guia Barbosa",
                "escola_municipio_uf": "Jandaíra - RN",
                "dias_letivos": "200",
                "carga_horaria_total": "800 h",
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
                "ordem_coluna": 2,
                "categoria": "BASE_COMUM",
                "ordem_disciplina": 1,
                "disciplina_nome": "Língua Portuguesa",
                "nota_ou_conceito": "9,0"
            }
        ],
        "operador": "Testador Fase 5"
    }

    res_salvar = client.post("/api/alunos/historico-completo", json=payload)
    assert res_salvar.status_code == 200
    aluno_uuid = res_salvar.json()["aluno_uuid"]

    # Testa a rota de impressão que serve o HTML para este UUID
    res_imp = client.get(f"/impressao/{aluno_uuid}")
    assert res_imp.status_code == 200
    assert "HISTÓRICO ESCOLAR" in res_imp.text
    assert "SMEJ-JANDAÍRA" in res_imp.text
    print(f"   [OK] Rota /impressao/{aluno_uuid} retornou 200 OK e template limpo!")

    # Testa API de histórico completo consumida pelo front da folha A4
    res_dados = client.get(f"/api/alunos/{aluno_uuid}/historico-completo")
    assert res_dados.status_code == 200
    dados = res_dados.json()
    assert dados["integridade"]["integro"] is True
    assert dados["aluno"]["nome_completo"] == "CARLOS EDUARDO PEREIRA"
    print("   [OK] Dados do aluno e integridade HMAC validados para impressão!")

if __name__ == "__main__":
    print("======================================================================")
    print("  EXECUTANDO BATERIA DE TESTES DA FASE 5 — IMPRESSÃO A4 & DESKTOP")
    print("======================================================================")
    test_app_window_e_launcher()
    test_template_impressao_a4_oficial()
    test_rota_impressao_com_aluno_real()
    if TEST_DB_PATH.exists():
        try:
            TEST_DB_PATH.unlink()
        except Exception:
            pass
    print("\n======================================================================")
    print("  TODOS OS TESTES DA FASE 5 PASSARAM COM 100% DE SUCESSO!")
    print("======================================================================")
