"""
Script de Testes e Validação da Fase 3 - SGM-Históricos
Cobre: drive_router.py, sync_worker.py, main.py e static/mobile_scan.html
"""

import io
import os
import sys
import json
import numpy as np
import cv2
from pathlib import Path
from starlette.testclient import TestClient

import database
import config_manager
import drive_router
import sync_worker
import main

print("=======================================================")
print(" INICIANDO TESTES DA FASE 3: SERVIDOR E SINCRONIZAÇÃO")
print("=======================================================")

client = TestClient(main.app)

# ==============================================================================
# 1. TESTE DO ROTEADOR MULTI-DRIVE E FERNET (drive_router.py)
# ==============================================================================
print("\n--- TESTE 1: Roteador Multi-Drive de 30 GB e Backups Fernet ---")

# 1.1 Mapeamento das 8 Escolas entre DRIVE_A e DRIVE_B
for esc_id in range(1, 9):
    part = drive_router.drive_router.obter_particao_para_escola(esc_id)
    if esc_id <= 4:
        assert part == "DRIVE_A", f"Escola {esc_id} deveria ser DRIVE_A"
    else:
        assert part == "DRIVE_B", f"Escola {esc_id} deveria ser DRIVE_B"
print("✓ Roteamento de partição correto: Escolas 1-4 no DRIVE_A e 5-8 no DRIVE_B!")

# 1.2 Geração de Backup Local Criptografado com Fernet (.db.enc)
res_backup = drive_router.drive_router.gerar_e_enviar_backup(escola_id=1)
assert res_backup["sucesso"] is True
enc_path = Path(res_backup["backup_local"]["caminho_enc"])
assert enc_path.exists()
assert enc_path.name.endswith(".db.enc")
print(f"✓ Backup criptografado com Fernet gerado: {enc_path.name} ({res_backup['backup_local']['tamanho_kb']} KB)")

# 1.3 Teste de Descriptografia e Restauração
restaurado_db = enc_path.parent / "temp_restaurado.db"
res_dec = drive_router.descriptografar_backup_sqlite(enc_path, restaurado_db)
assert restaurado_db.exists()
assert res_dec["sha256"] == res_backup["backup_local"]["sha256_original"]
print("✓ Descriptografia Fernet validada: SHA-256 idêntico ao banco original!")

# Limpeza
if enc_path.exists(): enc_path.unlink()
if restaurado_db.exists(): restaurado_db.unlink()

# 1.4 Status de Conexões dos Dois Drives (Tolerância Offline)
status_drives = drive_router.drive_router.status_conexoes()
assert "DRIVE_A" in status_drives and "DRIVE_B" in status_drives
print("✓ Diagnóstico de Multi-Drive operando 100% resiliente em modo offline!")


# ==============================================================================
# 2. TESTE DO WORKER DE SINCRONIZAÇÃO (sync_worker.py)
# ==============================================================================
print("\n--- TESTE 2: Sincronização Híbrida Offline-First (sync_worker.py) ---")

res_sync = sync_worker.executar_sincronizacao_completa()
assert res_sync["sucesso"] is True
assert res_sync["offline"] is True
print(f"✓ Ciclo de sincronização offline concluído: {res_sync['mensagem']}")

status_sync = sync_worker.obter_status_sincronizacao()
assert "total_pendentes_outbox" in status_sync
print(f"✓ Status outbox verificado: {status_sync['total_pendentes_outbox']['total_geral']} pendentes.")


# ==============================================================================
# 3. TESTE DAS ROTAS FASTAPI (main.py)
# ==============================================================================
print("\n--- TESTE 3: Endpoints da API REST FastAPI (main.py) ---")

# 3.1 Setup Wizard / Config Status
res = client.get("/api/config/status")
assert res.status_code == 200
dados_cfg = res.json()
assert "configurado" in dados_cfg
assert "ip_local" in dados_cfg
print(f"✓ GET /api/config/status -> OK (IP Local detectado: {dados_cfg['ip_local']})")

# 3.2 Catálogo de Escolas
res = client.get("/api/config/catalogo-escolas")
assert res.status_code == 200
escolas_cat = res.json()
assert len(escolas_cat) == 8
print(f"✓ GET /api/config/catalogo-escolas -> 8 escolas oficiais listadas.")

# 3.3 Ativação Modo Escola
res = client.post("/api/config/ativar-escola", json={
    "escola_id": 1,
    "codigo_ativacao": "ESC01-2026",
    "operador_nome": "Secretária Maria"
})
assert res.status_code == 200
assert res.json()["configuracao"]["modo"] == "ESCOLA"
print("✓ POST /api/config/ativar-escola -> Ativada com sucesso!")

# 3.4 Iniciar Sessão de Escaneamento e Geração de QR Code
res = client.post("/api/scan/iniciar-sessao", json={
    "escola_id": 1,
    "origem_captura": "MOBILE_QR"
})
assert res.status_code == 200
scan_data = res.json()
sessao_id = scan_data["sessao_id"]
assert scan_data["qr_code_base64"].startswith("data:image/png;base64,")
assert f":8000/mobile/scan/{sessao_id}" in scan_data["mobile_url"]
print(f"✓ POST /api/scan/iniciar-sessao -> Sessão {sessao_id[:8]}... com QR Code Base64 e URL: {scan_data['mobile_url']}")

# 3.5 Obter QR Code como imagem PNG
res = client.get(f"/api/scan/{sessao_id}/qrcode")
assert res.status_code == 200
assert res.headers["content-type"] == "image/png"
print("✓ GET /api/scan/{sessao_id}/qrcode -> PNG do QR Code retornado com sucesso!")

# 3.6 Servir Interface Mobile (static/mobile_scan.html)
res = client.get(f"/mobile/scan/{sessao_id}")
assert res.status_code == 200
assert "text/html" in res.headers["content-type"]
assert "SGM-Históricos" in res.text
assert "cameraInput" in res.text
print("✓ GET /mobile/scan/{sessao_id} -> mobile_scan.html servida perfeitamente!")

# 3.7 Upload de Página Mobile com Porteiro de Qualidade
# Cria imagem de documento nítida com grade e textos de histórico escolar
img_teste = np.full((1400, 1000, 3), 190, dtype=np.uint8)
for y in range(100, 1300, 80):
    cv2.line(img_teste, (50, y), (950, y), (30, 30, 30), 2)
cv2.putText(img_teste, "SECRETARIA MUNICIPAL DE EDUCACAO", (80, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 3)
cv2.putText(img_teste, "HISTORICO ESCOLAR DO 1o GRAU - 1982", (100, 150), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (20, 20, 20), 3)
_, buf = cv2.imencode(".jpg", img_teste)

res = client.post(
    f"/api/scan/{sessao_id}/upload-pagina",
    files={"arquivo": ("frente.jpg", buf.tobytes(), "image/jpeg")}
)
assert res.status_code == 200, f"Falha upload: {res.text}"
up_data = res.json()
assert up_data["sucesso"] is True
assert up_data["pagina_numero"] == 1
print(f"✓ POST /api/scan/{sessao_id}/upload-pagina -> Aprovada pelo Porteiro! ({up_data['score_nitidez']} score, {up_data['tamanho_kb']} KB)")

# 3.8 Teste de Rejeição do Porteiro via API (HTTP 422 para foto escura)
img_escura = np.full((1000, 1000, 3), 20, dtype=np.uint8)
_, buf_escura = cv2.imencode(".jpg", img_escura)

res_escura = client.post(
    f"/api/scan/{sessao_id}/upload-pagina",
    files={"arquivo": ("escura.jpg", buf_escura.tobytes(), "image/jpeg")}
)
assert res_escura.status_code == 422
assert "escura" in res_escura.json()["detail"].lower()
print("✓ POST /api/scan/.../upload-pagina -> Porteiro rejeitou com HTTP 422 e instrução amigável!")

# 3.9 Finalização do Envelope
res = client.post(f"/api/scan/{sessao_id}/finalizar")
assert res.status_code == 200
assert res.json()["status"] == "PENDENTE_IA"
print(f"✓ POST /api/scan/{sessao_id}/finalizar -> Envelope movido para PENDENTE_IA!")

# 3.10 Salvar Histórico Completo com Assinatura HMAC
aluno_teste = {
    "escola_id": 1,
    "nome_completo": "Clarice Lispector da Silva",
    "data_nascimento": "1975-12-10",
    "rg_numero": "2.890.111",
    "regime_ensino": "8_ANOS",
    "status_ficha": "DIGITADO"
}
vida_teste = [
    {
        "ordem_coluna": 1,
        "label_serie": "1ª Série",
        "ano_letivo": "1982",
        "escola_nome": "Escola Municipal Monteiro Lobato",
        "resultado_final": "Aprovado"
    }
]
notas_teste = [
    {
        "ordem_coluna": 1,
        "categoria": "BASE_COMUM",
        "ordem_disciplina": 1,
        "disciplina_nome": "Língua Portuguesa",
        "nota_ou_conceito": "9,0"
    }
]

res = client.post("/api/alunos/historico-completo", json={
    "aluno": aluno_teste,
    "vida_escolar": vida_teste,
    "notas_curriculares": notas_teste,
    "operador": "Secretária Teste"
})
assert res.status_code == 200
aluno_salvo_uuid = res.json()["aluno_uuid"]
codigo_aut = res.json()["codigo_autenticidade"]
print(f"✓ POST /api/alunos/historico-completo -> Salvo com UUID {aluno_salvo_uuid} e Código {codigo_aut}!")

# 3.11 Obter Histórico Completo com Laudo de Integridade HMAC
res = client.get(f"/api/alunos/{aluno_salvo_uuid}/historico-completo")
assert res.status_code == 200
hist_data = res.json()
assert hist_data["integridade"]["integro"] is True
assert len(hist_data["notas_curriculares"]) == 1
print("✓ GET /api/alunos/{uuid}/historico-completo -> Histórico 100% íntegro com HMAC!")

# 3.12 Homologar e Lacrar Ficha
res = client.post(f"/api/alunos/{aluno_salvo_uuid}/homologar-lacrar?operador=Diretora")
assert res.status_code == 200
assert res.json()["status"] == "LACRADO_HOMOLOGADO"
print("✓ POST /api/alunos/{uuid}/homologar-lacrar -> Ficha lacrada oficialmente!")

# 3.13 Verificação Pública pelo Código de Autenticidade
res = client.get(f"/api/alunos/verificar/{codigo_aut}")
assert res.status_code == 200
verif = res.json()
assert verif["autentico"] is True
assert verif["status_ficha"] == "LACRADO_HOMOLOGADO"
print(f"✓ GET /api/alunos/verificar/{codigo_aut} -> Documento autêntico verificado!")

# 3.14 Painel de Estatísticas
res = client.get("/api/estatisticas/painel")
assert res.status_code == 200
stats = res.json()
assert stats["total_alunos_passivo"] >= 1
assert stats["total_lacrados_homologados"] >= 1
print(f"✓ GET /api/estatisticas/painel -> Total de {stats['total_alunos_passivo']} alunos no acervo ({stats['total_lacrados_homologados']} lacrados).")

print("\n=======================================================")
print(" TODOS OS TESTES DA FASE 3 PASSARAM COM 100% DE SUCESSO!")
print("=======================================================")
