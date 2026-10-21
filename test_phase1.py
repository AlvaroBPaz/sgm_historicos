"""
Script de Validação e Teste da Fase 1 - SGM-Históricos
"""

import sys
import os
import json
import sqlite3
from pathlib import Path

# 1. Teste de Importação e Dependências Base
print("--- TESTE 1: Importações dos módulos da Fase 1 ---")
try:
    import security_hmac
    import config_manager
    import database
    print("✓ Todos os módulos foram importados com sucesso!")
except Exception as e:
    print(f"✗ Erro na importação: {e}")
    sys.exit(1)

# 2. Teste do Módulo security_hmac
print("\n--- TESTE 2: Assinatura e Validação HMAC-SHA256 ---")
aluno_exemplo = {
    "uuid": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
    "escola_id": 1,
    "nome_completo": "Sebastião da Silva Pereira",
    "data_nascimento": "1978-04-12",
    "rg_numero": "18.902.112-SSP/BA",
    "cpf": "123.456.789-00",
    "regime_ensino": "8_ANOS",
    "codigo_autenticidade": "VER-2026-A1B2"
}
hmac_aluno = security_hmac.gerar_hmac_aluno(aluno_exemplo)
aluno_exemplo["assinatura_hmac"] = hmac_aluno
assert security_hmac.validar_hmac_aluno(aluno_exemplo), "HMAC do aluno deveria ser válido"
print(f"✓ HMAC Aluno gerado: {hmac_aluno[:16]}... (Válido)")

# Teste de tentativa de adulteração externa do aluno
aluno_adulterado = dict(aluno_exemplo)
aluno_adulterado["nome_completo"] = "Sebastião da Silva Adulterado"
assert not security_hmac.validar_hmac_aluno(aluno_adulterado), "HMAC adulterado deveria falhar"
print("✓ Detecção de adulteração no aluno funcionou perfeitamente!")

# Teste de notas curriculares
nota_exemplo = {
    "uuid": "n1-uuid-1234",
    "aluno_uuid": aluno_exemplo["uuid"],
    "ordem_coluna": 1,
    "categoria": "BASE_COMUM",
    "ordem_disciplina": 1,
    "disciplina_nome": "Estudos Sociais",
    "nota_ou_conceito": "8,5",
    "carga_horaria_disciplina": "80"
}
hmac_nota = security_hmac.gerar_hmac_nota(nota_exemplo)
nota_exemplo["assinatura_hmac"] = hmac_nota
assert security_hmac.validar_hmac_nota(nota_exemplo), "HMAC da nota deveria ser válido"
print(f"✓ HMAC Nota gerado: {hmac_nota[:16]}... (Válido)")

# Teste de tentativa de adulteração de nota
nota_adulterada = dict(nota_exemplo)
nota_adulterada["nota_ou_conceito"] = "10,0"
assert not security_hmac.validar_hmac_nota(nota_adulterada), "HMAC da nota adulterada deveria falhar"
print("✓ Detecção de adulteração de nota funcionou com sucesso!")

# 3. Teste do Modo Camaleão (config_manager.py)
print("\n--- TESTE 3: Modo Camaleão e Senha Mestra (config_manager.py) ---")
# Criar instância de teste em arquivo temporário
teste_config_path = Path("./data_local/teste_config.json")
if teste_config_path.exists():
    teste_config_path.unlink()

mgr = config_manager.ConfigManager(teste_config_path)
assert not mgr.is_configurado(), "Inicialmente deve estar desconfigurado"

# Teste da Senha Mestra Padrão Documentada (SME@Admin2026)
assert mgr.verificar_senha_mestra("SME@Admin2026"), "Senha mestra padrão deve ser aceita"
assert not mgr.verificar_senha_mestra("SenhaErrada"), "Senha errada deve ser rejeitada"
print("✓ Senha Mestra SME@Admin2026 verificada com sucesso!")

# Teste de Ativação Modo Escola
cfg_escola = mgr.configurar_modo_escola(escola_id=3, codigo_ativacao="ESC03-2026", operador_nome="Secretária Teste")
assert mgr.is_configurado()
assert mgr.obter_modo() == "ESCOLA"
assert mgr.obter_escola_id() == 3
assert mgr.obter_drive_particao() == "DRIVE_A"
assert mgr.pode_editar_escola(3)
assert not mgr.pode_editar_escola(1)
print(f"✓ Configuração Modo Escola ID 3 ({cfg_escola['escola_nome']}) validada com DRIVE_A!")

# Teste de Ativação Modo SME
cfg_sme = mgr.configurar_modo_sme("SME@Admin2026", operador_nome="Adm SME")
assert mgr.obter_modo() == "SME"
assert mgr.eh_modo_sme()
assert mgr.pode_editar_escola(1) and mgr.pode_editar_escola(8) and mgr.pode_editar_escola(99)
print("✓ Configuração Modo SME validada com permissões globais!")

# Limpeza do config de teste
if teste_config_path.exists():
    teste_config_path.unlink()

# 4. Teste do Banco de Dados SQLite (database.py)
print("\n--- TESTE 4: Banco de Dados SQLite e CRUDs (database.py) ---")
teste_db_path = Path("./data_local/teste_acervo.db")
if teste_db_path.exists():
    teste_db_path.unlink()

database.init_db(teste_db_path)
assert teste_db_path.exists(), "Arquivo SQLite deve ter sido criado"
print("✓ Banco SQLite criado com sucesso em ./data_local/teste_acervo.db")

# Verificar as 8 escolas
escolas = database.listar_escolas(caminho_db=teste_db_path)
assert len(escolas) == 8, f"Esperado 8 escolas, mas obteve {len(escolas)}"
print("✓ 8 Escolas Municipais Pré-cadastradas:")
for esc in escolas:
    print(f"   [{esc['id']}] {esc['nome_oficial']} -> {esc['drive_particao']}")
    if esc["id"] <= 4:
        assert esc["drive_particao"] == "DRIVE_A"
    else:
        assert esc["drive_particao"] == "DRIVE_B"

# Teste de cadastro de Escola Extinta pela SME (ID >= 9)
nova_extinta = database.cadastrar_escola_extinta({
    "nome_oficial": "Escola Municipal Rural Fazenda Velha (Extinta)",
    "codigo_inep": "29009001",
    "observacao_acervo_extinta": "Acervo transferido para SME em 2005"
}, caminho_db=teste_db_path)
assert nova_extinta["id"] >= 9
assert nova_extinta["drive_particao"] == "DRIVE_B"
assert nova_extinta["extinta"] == 1
print(f"✓ Escola Extinta cadastrada com sucesso: ID {nova_extinta['id']} ({nova_extinta['nome_oficial']})")

# Teste de CRUD de Aluno com HMAC
novo_aluno_dados = {
    "escola_id": 1,
    "nome_completo": "Raimundo Nonato de Jesus",
    "data_nascimento": "1965-09-22",
    "naturalidade_municipio": "Salvador",
    "naturalidade_uf": "BA",
    "filiacao_1": "Antônio de Jesus",
    "filiacao_2": "Maria dos Santos Jesus",
    "rg_numero": "2.345.678",
    "cpf": "234.567.890-11",
    "arquivo_estante": "E-02",
    "arquivo_caixa": "CX-1980",
    "arquivo_pasta": "P-45",
    "arquivo_ano_referencia": "1980",
    "regime_ensino": "8_ANOS"
}
aluno_criado = database.criar_aluno(novo_aluno_dados, operador="Op Teste", caminho_db=teste_db_path)
assert aluno_criado["uuid"]
assert aluno_criado["codigo_autenticidade"].startswith("VER-2026-")
assert aluno_criado["assinatura_hmac"]
print(f"✓ Aluno criado com UUIDv4 {aluno_criado['uuid']} e Código {aluno_criado['codigo_autenticidade']}")

# Leitura e verificação de integridade
aluno_lido = database.obter_aluno(aluno_criado["uuid"], caminho_db=teste_db_path)
assert aluno_lido["hmac_valido"] is True
assert aluno_lido["violacao_detectada"] is False
print("✓ Leitura de aluno com validação HMAC bem-sucedida!")

# Simulação de ataque/adulteração externa direta no arquivo SQLite
with sqlite3.connect(str(teste_db_path)) as c_hack:
    c_hack.execute(
        "UPDATE alunos SET nome_completo = 'Raimundo Alterado Hack' WHERE uuid = ?",
        (aluno_criado["uuid"],)
    )
    c_hack.commit()

aluno_hackeado = database.obter_aluno(aluno_criado["uuid"], caminho_db=teste_db_path)
assert aluno_hackeado["hmac_valido"] is False
assert aluno_hackeado["violacao_detectada"] is True
print("✓ Violação Externa Detectada no Aluno pelo banco!")

# Restaura o nome íntegro e recalcula
database.atualizar_aluno(
    aluno_criado["uuid"],
    {"nome_completo": "Raimundo Nonato de Jesus"},
    caminho_db=teste_db_path
)
aluno_restaurado = database.obter_aluno(aluno_criado["uuid"], caminho_db=teste_db_path)
assert aluno_restaurado["hmac_valido"] is True
print("✓ Restauração e recálculo de HMAC efetuados com sucesso!")

# Teste de Salvar Histórico Completo (Transação Atômica: Aluno + Vida Escolar + Notas)
vida_itens = [
    {
        "ordem_coluna": 1,
        "label_serie": "1ª Série",
        "ano_letivo": "1978",
        "escola_nome": "Escola Municipal Monteiro Lobato",
        "escola_municipio_uf": "Município Sede - BA",
        "resultado_final": "Aprovado"
    },
    {
        "ordem_coluna": 2,
        "label_serie": "2ª Série",
        "ano_letivo": "1979",
        "escola_nome": "Escola Municipal Monteiro Lobato",
        "escola_municipio_uf": "Município Sede - BA",
        "resultado_final": "Aprovado"
    }
]

notas_itens = [
    {
        "ordem_coluna": 1,
        "categoria": "BASE_COMUM",
        "ordem_disciplina": 1,
        "disciplina_nome": "Língua Portuguesa",
        "nota_ou_conceito": "7,5",
        "carga_horaria_disciplina": "120"
    },
    {
        "ordem_coluna": 1,
        "categoria": "BASE_COMUM",
        "ordem_disciplina": 2,
        "disciplina_nome": "Matemática",
        "nota_ou_conceito": "8,0",
        "carga_horaria_disciplina": "120"
    },
    {
        "ordem_coluna": 2,
        "categoria": "BASE_COMUM",
        "ordem_disciplina": 1,
        "disciplina_nome": "Língua Portuguesa",
        "nota_ou_conceito": "8,5",
        "carga_horaria_disciplina": "120"
    },
    {
        "ordem_coluna": 2,
        "categoria": "BASE_COMUM",
        "ordem_disciplina": 2,
        "disciplina_nome": "Matemática",
        "nota_ou_conceito": "9,0",
        "carga_horaria_disciplina": "120"
    }
]

historico_completo = database.salvar_historico_completo(
    aluno_dados=aluno_restaurado,
    vida_escolar_itens=vida_itens,
    notas_itens=notas_itens,
    operador="Operador Teste",
    caminho_db=teste_db_path
)
assert len(historico_completo["vida_escolar"]) == 2
assert len(historico_completo["notas_curriculares"]) == 4
print("✓ Histórico completo salvo em transação atômica com sucesso!")

# Obter histórico completo e checar integridade total
hist_consultado = database.obter_historico_completo(aluno_criado["uuid"], caminho_db=teste_db_path)
assert hist_consultado["integridade"]["integro"] is True
assert hist_consultado["integridade"]["aluno_valido"] is True
assert len(hist_consultado["integridade"]["notas_invalidas"]) == 0
print("✓ Verificação de integridade total do histórico: 100% íntegro!")

# Teste de Sessão Fila OCR
sessao_ocr = database.criar_sessao_ocr(escola_id=1, origem_captura="MOBILE_QR", caminho_db=teste_db_path)
assert sessao_ocr["sessao_id"]
assert sessao_ocr["status"] == "CAPTURANDO"

database.adicionar_pagina_ocr(sessao_ocr["sessao_id"], "./data_local/imagens_webp/pag1.webp", caminho_db=teste_db_path)
database.adicionar_pagina_ocr(sessao_ocr["sessao_id"], "./data_local/imagens_webp/pag2.webp", caminho_db=teste_db_path)
sessao_up = database.atualizar_status_ocr(sessao_ocr["sessao_id"], "PENDENTE_IA", caminho_db=teste_db_path)
paginas = json.loads(sessao_up["paginas_locais_json"])
assert len(paginas) == 2
assert sessao_up["status"] == "PENDENTE_IA"
print(f"✓ Sessão Fila OCR criada com 2 páginas e avançada para PENDENTE_IA!")

# Teste de Logs de Auditoria
auditorias = database.listar_auditoria(aluno_uuid=aluno_criado["uuid"], caminho_db=teste_db_path)
assert len(auditorias) >= 2
print(f"✓ Auditoria registrou {len(auditorias)} ações rastreáveis!")

# Teste de Outbox / Sincronização
pendentes = database.obter_pendentes_sincronizacao(caminho_db=teste_db_path)
assert len(pendentes["alunos"]) >= 1
assert len(pendentes["notas_curriculares"]) >= 4
database.marcar_registros_sincronizados("alunos", [aluno_criado["uuid"]], caminho_db=teste_db_path)
pendentes_pos = database.obter_pendentes_sincronizacao(caminho_db=teste_db_path)
assert len(pendentes_pos["alunos"]) == 0
print("✓ Rotinas do padrão Offline-First Outbox testadas e aprovadas!")

# Limpeza do banco de teste
if teste_db_path.exists():
    try:
        teste_db_path.unlink()
        wal = teste_db_path.with_suffix(".db-wal")
        shm = teste_db_path.with_suffix(".db-shm")
        if wal.exists(): wal.unlink()
        if shm.exists(): shm.unlink()
    except Exception:
        pass

print("\n=======================================================")
print(" TODOS OS TESTES DA FASE 1 PASSARAM COM 100% DE SUCESSO!")
print("=======================================================")
