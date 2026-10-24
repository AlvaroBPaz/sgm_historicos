"""
Benchmark de Capacidade e Performance de Transcrição por IA - SGM-Históricos
Testa a transcrição de envelopes de alunos com o Google Gemini e calcula métricas de vazão:
- Tempo de resposta por aluno
- Quantidade de alunos por minuto / hora / dia
- Limites de cota oficial (Free Tier vs Pay-as-you-go)
- Custo estimado por histórico
"""

import os
import sys
import time
import json
from pathlib import Path
from typing import List, Dict, Any

import ocr_queue_worker
import database

def formatar_tamanho(bytes_qty: int) -> str:
    return f"{bytes_qty / 1024:.1f} KB"

def executar_benchmark(qtd_amostras: int = 3):
    print("=" * 70)
    print("   BENCHMARK DE TRANSCRIÇÃO DE ALUNOS COM GOOGLE GEMINI")
    print("=" * 70)

    worker = ocr_queue_worker.GeminiClientWorker()
    api_key = worker.obter_api_key()
    if not api_key:
        print("\n[ERRO CRÍTICO] Chave GEMINI_API_KEY não encontrada no .env!")
        return

    modelo = worker.obter_modelo()
    print(f"Chave API configurada : {api_key[:8]}...{api_key[-4:]}")
    print(f"Modelo configurado    : {modelo}")
    print(f"Rate Limiter Local    : {ocr_queue_worker.INTERVALO_MINIMO_REQUISICAO_SEGUNDOS}s de pausa entre requisições")

    # Seleciona imagens reais de teste ordenadas pelas mais representativas
    pasta_imagens = Path("data_local/imagens_webp")
    if not pasta_imagens.exists():
        print(f"\n[ERRO] Diretório {pasta_imagens} não encontrado.")
        return

    candidatos = [
        "sessao_83c24368-fcd5-45f5-9fc6-704f3bbcf001_pag_1_4eb868.webp",
        "sessao_248c3762-f0e0-4acd-87d5-8eb02d166a0b_pag_1_ecebfa.webp",
        "sessao_d342256b-e8ca-4bbc-9965-097f6611224a_pag_1_2584b3.webp",
        "sessao_44153f24-161f-4a99-abf7-c5f47fffadec_pag_1_71f12a.webp",
    ]

    arquivos_teste = []
    for nome in candidatos:
        p = pasta_imagens / nome
        if p.exists() and p.stat().st_size > 50 * 1024:
            arquivos_teste.append(p)

    if not arquivos_teste:
        arquivos_teste = sorted(
            [f for f in pasta_imagens.glob("*.webp") if f.stat().st_size > 50 * 1024],
            key=lambda x: x.stat().st_size,
            reverse=True
        )

    amostras = arquivos_teste[:qtd_amostras]
    print(f"\nEncontradas {len(amostras)} fichas históricas para teste:")
    for idx, f in enumerate(amostras, 1):
        print(f"  [{idx}] {f.name} ({formatar_tamanho(f.stat().st_size)})")

    print("\nIniciando bateria de transcrição real via API do Gemini...\n")
    resultados = []
    tempo_total_inicio = time.time()

    for idx, arq in enumerate(amostras, 1):
        print(f"--- [Ficha {idx}/{len(amostras)}] Processando {arq.name} ---")
        t_inicio = time.time()
        sucesso = False
        aluno_nome = "Não identificado"
        qtd_notas = 0
        qtd_series = 0
        erro_msg = None

        try:
            res = worker.transcrever_envelope_multimodal([arq])
            t_fim = time.time()
            tempo_decorrido = t_fim - t_inicio
            sucesso = True
            
            if res.dados_civis and res.dados_civis.nome_completo and res.dados_civis.nome_completo.valor:
                aluno_nome = res.dados_civis.nome_completo.valor
            qtd_notas = len(res.notas_curriculares or [])
            qtd_series = len(res.series_cursadas or [])
            
            print(f"  ✓ Concluído em {tempo_decorrido:.2f}s")
            print(f"  → Aluno identificado: {aluno_nome}")
            print(f"  → Séries extraídas: {qtd_series} | Disciplinas/Notas: {qtd_notas}")
            print(f"  → Legível para transcrição: {res.esta_legivel_para_transcricao}")

        except Exception as e:
            t_fim = time.time()
            tempo_decorrido = t_fim - t_inicio
            erro_msg = str(e)
            print(f"  ✗ Falha após {tempo_decorrido:.2f}s: {erro_msg}")

        resultados.append({
            "arquivo": arq.name,
            "tempo_s": tempo_decorrido,
            "sucesso": sucesso,
            "aluno": aluno_nome,
            "series": qtd_series,
            "notas": qtd_notas,
            "erro": erro_msg
        })

    tempo_total_fim = time.time()
    duracao_total = tempo_total_fim - tempo_total_inicio

    # Cálculos Estatísticos
    tempos_sucesso = [r["tempo_s"] for r in resultados if r["sucesso"]]
    sucessos_count = len(tempos_sucesso)

    print("\n" + "=" * 70)
    print("                     RESULTADOS DO BENCHMARK")
    print("=" * 70)

    if sucessos_count > 0:
        tempo_medio = sum(tempos_sucesso) / sucessos_count
        tempo_min = min(tempos_sucesso)
        tempo_max = max(tempos_sucesso)
        taxa_sucesso = (sucessos_count / len(resultados)) * 100

        print(f"Total testado             : {len(resultados)} alunos/fichas")
        print(f"Taxa de sucesso           : {taxa_sucesso:.1f}% ({sucessos_count}/{len(resultados)})")
        print(f"Tempo médio por aluno     : {tempo_medio:.2f} segundos")
        print(f"Tempo mínimo / máximo     : {tempo_min:.2f}s / {tempo_max:.2f}s")
        print(f"Duração total do teste    : {duracao_total:.2f} segundos")

        # Projeções de Vazão (Throughput)
        # 1. Pelo tempo puro da API (sem rate limiting adicional)
        rpm_puro = 60.0 / tempo_medio

        # 2. Respeitando o Rate Limiter de segurança do sistema (pausa de 6s = máx 10 req/min)
        tempo_com_limiter = max(tempo_medio, ocr_queue_worker.INTERVALO_MINIMO_REQUISICAO_SEGUNDOS)
        alunos_por_minuto = 60.0 / tempo_com_limiter
        alunos_por_hora = alunos_por_minuto * 60

        print("\n" + "-" * 70)
        print("   CAPACIDADE DE TRANSCRIÇÃO ESTIMADA (PROJEÇÃO)")
        print("-" * 70)
        print(f"Velocidade média operacional  : ~{alunos_por_minuto:.1f} alunos/minuto")
        print(f"Capacidade por hora de trabalho: ~{alunos_por_hora:.0f} alunos/hora")
        print(f"Em um turno de 8 horas         : ~{alunos_por_hora * 8:.0f} alunos transcritos")

        print("\n" + "-" * 70)
        print("   LIMITES OFICIAIS DO GOOGLE GEMINI")
        print("-" * 70)
        print("1. Plano Gratuito (Free Tier):")
        print("   - Limite por Minuto (RPM)  : 15 requisições/minuto")
        print("   - Limite Diário (RPD)      : Até 1.500 alunos/fichas por dia")
        print("   - Custo                    : R$ 0,00 (100% gratuito)")

        print("\n2. Plano Pago (Pay-as-you-go):")
        print("   - Limite por Minuto (RPM)  : 1.000 requisições/minuto")
        print("   - Limite Diário (RPD)      : ~4.000.000 requisições por dia")
        print("   - Custo estimado por aluno : ~R$ 0,001 a R$ 0,005 (menos de 1 centavo por histórico)")

    else:
        print("Nenhuma das amostras foi transcrita com sucesso.")
        for r in resultados:
            print(f"- {r['arquivo']}: {r['erro']}")

    print("=" * 70 + "\n")

if __name__ == "__main__":
    qtd = 3
    if len(sys.argv) > 1:
        try:
            qtd = int(sys.argv[1])
        except ValueError:
            pass
    executar_benchmark(qtd)
