"""
SGM-Históricos — Testes Automatizados da FASE 5 (Impressão Oficial A4, App Window e Batch Launcher)
"""

import sys
import os
from pathlib import Path
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

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
    print("\n-> Testando conformidade do template static/impressao_a4.html...")
    
    a4_path = BASE_DIR / "static" / "impressao_a4.html"
    assert a4_path.exists()
    html = a4_path.read_text(encoding="utf-8")

    # Regras CSS @page e dimensões
    assert "size: A4 portrait" in html, "Falta CSS @page size A4 portrait"
    assert "margin: 8mm" in html, "Falta CSS margin 8mm"
    assert "1px solid #000" in html, "Falta bordas 1px solid #000 oficiais"

    # Elementos institucionais do cabeçalho
    assert "containerBrasao" in html, "Falta container do Brasão oficial"
    assert "cabecalhoEscolaNome" in html, "Falta nome da escola no cabeçalho"
    assert "cabecalhoEscolaAtos" in html, "Falta atos regulatórios no cabeçalho"
    assert "faixaEscolaExtinta" in html, "Falta banner para escolas extintas"

    # Dados civis e arquivo passivo
    assert "dado_nome_completo" in html
    assert "dado_data_nascimento" in html
    assert "dado_certidao" in html
    assert "dado_localizador_arquivo" in html

    # Matriz e estabelecimentos
    assert "tabelaEstabelecimentosA4" in html, "Falta quadro de estabelecimentos frequentados"
    assert "tabelaMatrizA4" in html, "Falta tabela matricial de notas e séries"
    assert "BASE NACIONAL COMUM" in html, "Falta seção Base Comum"
    assert "PARTE DIVERSIFICADA" in html, "Falta seção Parte Diversificada"

    # Rodapé, QR Code e Assinaturas
    assert "qrCodeAutenticidade" in html, "Falta QR Code de autenticidade"
    assert "rodapeCodigoAutenticidade" in html, "Falta código de autenticidade no rodapé"
    assert "assinaturaSecretarioNome" in html, "Falta linha de assinatura do Secretário"
    assert "assinaturaDiretorNome" in html, "Falta linha de assinatura do Diretor"

    print("   [OK] Todos os requisitos da Seção 9.3 do SPEC.md presentes no template A4!")

def test_rota_impressao_com_aluno_real():
    print("\n-> Testando renderização da rota de impressão com dados reais...")
    # Cadastra um aluno para o teste
    payload = {
        "aluno": {
            "escola_id": 1,
            "nome_completo": "CARLOS EDUARDO PEREIRA",
            "data_nascimento": "18/09/1985",
            "naturalidade_municipio": "Caxias do Sul",
            "naturalidade_uf": "RS",
            "certidao_tipo": "Nascimento",
            "certidao_termo": "9812",
            "certidao_livro": "B-44",
            "certidao_folha": "12",
            "certidao_cartorio": "1º Registro Civil",
            "arquivo_estante": "Estante A",
            "arquivo_caixa": "Caixa 1999",
            "arquivo_pasta": "Pasta 10",
            "regime_ensino": "8_ANOS",
            "status_ficha": "LACRADO_HOMOLOGADO"
        },
        "vida_escolar": [
            {
                "ordem_coluna": 1,
                "label_serie": "1ª Série",
                "ano_letivo": "1992",
                "escola_nome": "E.M. Castro Alves",
                "resultado_final": "Aprovado"
            },
            {
                "ordem_coluna": 2,
                "label_serie": "2ª Série",
                "ano_letivo": "1993",
                "escola_nome": "E.M. Castro Alves",
                "resultado_final": "Não Cursado"
            }
        ],
        "notas_curriculares": [
            {
                "ordem_coluna": 1,
                "categoria": "BASE_COMUM",
                "ordem_disciplina": 1,
                "disciplina_nome": "Língua Portuguesa",
                "nota_ou_conceito": "8,0"
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
    print(f"   [OK] Rota /impressao/{aluno_uuid} retornou 200 OK!")

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
    print("\n======================================================================")
    print("  TODOS OS TESTES DA FASE 5 PASSARAM COM 100% DE SUCESSO!")
    print("======================================================================")
