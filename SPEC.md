# SPEC.md — Sistema Municipal de Acervo Passivo e Histórico Escolar (SGM-Históricos)

## 1. Visão Geral e Escopo
Aplicação desktop local (Offline-First) com sincronização híbrida em nuvem, projetada para as **8 Escolas Municipais** e a **Secretaria Municipal de Educação (SME)**.
- **Foco Exclusivo:** Resgate, digitalização inteligente (OCR/IA), catalogação física e emissão de 2ª via de Históricos Escolares de **ex-alunos (Arquivo Passivo / Arquivo Morto)**.
- **Não inclui:** Gestão de matrículas vigentes, diários de classe ou transferências em curso do ano atual.

---

## 2. Stack Tecnológica e Arquitetura de Execução
- **Linguagem e Backend:** Python 3.11+ com **FastAPI** e **Uvicorn** (`host="0.0.0.0"`, `port=8000` para permitir acesso na rede local por um 2º PC na mesma secretaria e pelo celular como scanner sem fio).
- **Janela de Aplicativo Nativa (Desktop):** Utilizar **`pywebview`** (com motor nativo Microsoft Edge WebView2 no Windows) ou abertura controlada via `msedge --app=http://127.0.0.1:8000`. O usuário final opera o sistema em uma janela dedicada de programa do Windows (sem barra de endereços, sem abas de navegador e encerrando o processo Python ao fechar a janela).
- **Frontend:** HTML5 semântico, **Tailwind CSS** (local ou CDN com fallback offline), **Lucide Icons** e **JavaScript Vanilla (ES6+)** estruturado em módulos limpos.
- **Banco de Dados Local:** **SQLite3** nativo (`./data_local/acervo_local.db`), utilizando chaves primárias **`UUIDv4`** (strings geradas via `uuid.uuid4()`) em todas as tabelas de negócio para permitir que 2 computadores na mesma escola cadastrem alunos simultaneamente sem colisão de IDs.
- **Nuvem de Dados (Sincronização Registro a Registro):** **Supabase (PostgreSQL)** via API REST / SDK `supabase-py`, operando no padrão *Offline-First Outbox*.
- **Cofre de Imagens e Backups (30 GB Gratuitos):** **Google Drive API v3** via *Service Account* (`google-api-python-client`) com **Roteador Multi-Drive** dividindo as 8 escolas em 2 contas Google gratuitas de 15 GB cada.
- **Processamento de Imagem e Scanner:**
  - `opencv-python-headless` e `Pillow` (validação de nitidez/iluminação, melhoria de contraste e compressão WebP).
  - Integração com Scanner USB/Rede do Windows via **WIA (`pywin32` / `win32com.client.Dispatch("WIA.CommonDialog")`)** + fallback para upload de múltiplos arquivos locais (JPG/PNG/PDF).
- **Transcrição por Inteligência Artificial:** SDK oficial **`google-genai`** utilizando o modelo **`gemini-2.5-flash`** com saída estruturada (`response_schema` via **Pydantic**).

---

## 3. Estrutura de Diretórios do Projeto
```text
sgm_historicos/
├── SPEC.md
├── requirements.txt
├── iniciar.bat
├── app_window.py             # Inicializador PyWebView + Servidor Uvicorn em Thread
├── main.py                   # Rotas FastAPI (API REST + Páginas Mobile e Desktop)
├── config_manager.py         # Modo Camaleão (Escola vs Secretaria), Senha Mestra e Chaves
├── database.py               # Conexão SQLite, criação de tabelas, gatilhos e assinatura HMAC
├── security_hmac.py          # Assinatura e verificação anti-adulteração externa do SQLite
├── sync_worker.py            # Worker em background (Imediato + Ciclo de 2h) para Supabase
├── drive_router.py           # Roteador Multi-Drive (Drive A: Escolas 1-4 | Drive B: Escolas 5-8)
├── scanner_service.py        # Captura via Scanner USB Windows (WIA) e gestão de lotes
├── image_processor.py        # Porteiro OpenCV (Anti-tremido/Brilho), CLAHE e Compressão WebP
├── ocr_queue_worker.py       # Fila Offline de IA e cliente Gemini 2.5 Flash com Pydantic
├── data_local/               # Gerado automaticamente (fora do versionamento)
│   ├── config_instalacao.json
│   ├── acervo_local.db
│   ├── scans_temp/           # Envelopes de páginas em captura
│   └── imagens_webp/         # Páginas comprimidas definitivas (180KB-350KB)
└── static/
    ├── index.html            # Interface Principal Desktop (SPA)
    ├── mobile_scan.html      # Interface Mobile Ultra-Leve (Scanner QR Code)
    ├── impressao_a4.html     # Template Oficial A4 de Impressão (@media print)
    ├── css/
    └── js/
        ├── app.js            # Controle geral, Setup Wizard, Busca e Listagem
        ├── editor_matriz.js  # Planilha Matricial 100% editável e Modo Digitação Turbo
        └── split_review.js   # Tela Dividida de Revisão (Visualizador Multi-Páginas + Form)
```

---

## 4. Instalador Único "Modo Camaleão" e Segurança

### 4.1. Primeiro Uso (Setup Wizard)
Ao iniciar sem o arquivo `./data_local/config_instalacao.json`, o sistema bloqueia a tela inicial e exibe o **Assistente de Ativação da Máquina**:
1. **Opção A — Instalar como Unidade Escolar:**
   - Permite selecionar uma das **8 Escolas Municipais** da lista oficial.
   - Exige um código de ativação simples da unidade.
   - Restringe a gravação e edição exclusivamente aos alunos do `escola_id` selecionado. Permite consultar (somente leitura) alunos das outras 7 escolas.
2. **Opção B — Instalar como Secretaria Municipal de Educação (SME):**
   - Exige a **Senha Mestra da Secretaria** (validada via hash SHA-256 com salt).
   - Desbloqueia visão global das 8 escolas + cadastro de **Escolas Extintas/Nucleadas** (acervo recolhido pela SME).
   - Desbloqueia o Painel de Auditoria, Estatísticas de Digitalização, Homologação/Desbloqueio de fichas lacradas e Gestão dos 2 Google Drives.

### 4.2. Proteção contra Adulteração Fora do Programa (HMAC-SHA256)
- Cada registro nas tabelas `alunos`, `vida_escolar` e `notas_curriculares` possui uma coluna `assinatura_hmac`.
- Sempre que o Python grava um registro, calcula o HMAC-SHA256 concatenando os campos críticos (nome, série, disciplina, nota, resultado) com uma chave interna do sistema.
- Se alguém abrir o arquivo `acervo_local.db` por fora do programa (usando um editor SQLite externo) e alterar uma nota, a validação de `assinatura_hmac` falhará na leitura, bloqueando a impressão do documento, exibindo alerta de **"Violação Externa Detectada"** e restaurando a versão íntegra da nuvem.

---

## 5. Modelagem do Banco de Dados (SQLite Local & Supabase)

### 5.1. Tabela `escolas`
- `id` (INTEGER PK: 1 a 8 para escolas ativas; 9+ para escolas rurais extintas/nucleadas)
- `nome_oficial` (TEXT)
- `codigo_inep` (TEXT)
- `endereco` (TEXT), `municipio_uf` (TEXT)
- `ato_criacao` (TEXT), `ato_autorizacao` (TEXT)
- `diretor_nome` (TEXT), `diretor_registro` (TEXT)
- `secretario_nome` (TEXT), `secretario_registro` (TEXT)
- `extinta` (INTEGER: 0 ou 1), `observacao_acervo_extinta` (TEXT)
- `drive_particao` (TEXT: `'DRIVE_A'` para escolas 1 a 4; `'DRIVE_B'` para escolas 5 a 8 e SME)
- `brasao_base64` (TEXT)

### 5.2. Tabela `alunos` (Adaptada para Arquivo Passivo)
- `uuid` (TEXT PK - UUIDv4)
- `escola_id` (INTEGER FK -> escolas.id)
- `nome_completo` (TEXT NOT NULL)
- `data_nascimento` (TEXT)
- `naturalidade_municipio` (TEXT), `naturalidade_uf` (TEXT), `nacionalidade` (TEXT DEFAULT 'Brasileira')
- `filiacao_1` (TEXT), `filiacao_2` (TEXT)
- **Documentos Antigos (Todos opcionais, sem trava de obrigatoriedade):**
  - `rg_numero` (TEXT), `rg_orgao_uf` (TEXT), `cpf` (TEXT), `codigo_inep_aluno` (TEXT)
  - `certidao_tipo` (TEXT: Nascimento/Casamento), `certidao_termo` (TEXT), `certidao_livro` (TEXT), `certidao_folha` (TEXT), `certidao_cartorio` (TEXT), `certidao_municipio_uf` (TEXT)
- **Configuração Histórica e Controle:**
  - `regime_ensino` (TEXT: `'8_ANOS'` [1ª a 8ª Série], `'9_ANOS'` [1º ao 9º Ano], `'EJA_ETAPAS'`)
  - `observacoes_historico` (TEXT - Equivalências, leis da época, observações livres)
  - `status_ficha` (TEXT: `'RASCUNHO_IA'`, `'DIGITADO'`, `'LACRADO_HOMOLOGADO'`)
  - `codigo_autenticidade` (TEXT UNIQUE - Ex: `VER-2026-X89F`)
  - `paginas_webp_json` (TEXT - JSON array com nomes locais e IDs no Google Drive das folhas escaneadas)
  - `assinatura_hmac` (TEXT)
  - `atualizado_em` (TEXT - ISO8601 UTC), `sincronizado` (INTEGER: 0 ou 1)

### 5.3. Tabela `vida_escolar` (Séries/Anos cursados pelo ex-aluno)
- `uuid` (TEXT PK - UUIDv4)
- `aluno_uuid` (TEXT FK -> alunos.uuid ON DELETE CASCADE)
- `ordem_coluna` (INTEGER: 1 a 9)
- `label_serie` (TEXT: ex. `"1ª Série"`, `"8ª Série"`, `"1º Ano"`, `"1ª Etapa EJA"`)
- `ano_letivo` (TEXT: ex. `"1994"`)
- `escola_nome` (TEXT), `escola_municipio_uf` (TEXT)
- `dias_letivos` (TEXT), `carga_horaria_total` (TEXT), `frequencia_percentual` (TEXT)
- `resultado_final` (TEXT: `'Aprovado'`, `'Reprovado'`, `'Promovido'`, `'Transferido'`, `'Desistente'`, `'Não Cursado'`)
- `atualizado_em` (TEXT), `sincronizado` (INTEGER: 0 ou 1)

### 5.4. Tabela `notas_curriculares` (Matriz de Disciplinas x Séries)
- `uuid` (TEXT PK - UUIDv4)
- `aluno_uuid` (TEXT FK -> alunos.uuid ON DELETE CASCADE)
- `ordem_coluna` (INTEGER: 1 a 9 - vincula à coluna da série)
- `categoria` (TEXT: `'BASE_COMUM'` ou `'DIVERSIFICADA'`)
- `ordem_disciplina` (INTEGER)
- `disciplina_nome` (TEXT - Permite nomes clássicos e históricos: *Língua Portuguesa, Matemática, Estudos Sociais, OSPB, Educação Moral e Cívica, Programas de Saúde, Ciências Físicas e Biológicas, Educação Artística, Práticas Agrícolas*, ou qualquer nome digitado)
- `nota_ou_conceito` (TEXT - Aceita `"8,5"`, `"70"`, `"A"`, `"AP"`, `"---"`)
- `carga_horaria_disciplina` (TEXT)
- `assinatura_hmac` (TEXT)
- `atualizado_em` (TEXT), `sincronizado` (INTEGER: 0 ou 1)

### 5.5. Tabela `fila_ocr` (Fila Local de Escaneamento e Transcrição IA)
- `sessao_id` (TEXT PK - UUIDv4)
- `escola_id` (INTEGER)
- `status` (TEXT: `'CAPTURANDO'`, `'PENDENTE_IA'`, `'PROCESSANDO_IA'`, `'AGUARDANDO_REVISAO'`, `'CONCLUIDO'`, `'ERRO_IA'`)
- `origem_captura` (TEXT: `'MOBILE_QR'` ou `'SCANNER_PC'`)
- `paginas_locais_json` (TEXT - Lista de caminhos das imagens `.webp` aprovadas pelo Porteiro de Qualidade)
- `json_extraido_ia` (TEXT - Resposta estruturada do Gemini 2.5 Flash com flags de confiança)
- `tentativas_ia` (INTEGER DEFAULT 0), `ultimo_erro` (TEXT)
- `criado_em` (TEXT), `atualizado_em` (TEXT)

### 5.6. Tabela `auditoria_logs`
- `uuid` (TEXT PK), `escola_id` (INTEGER), `aluno_uuid` (TEXT), `acao` (TEXT), `detalhes_antes_depois` (TEXT), `criado_em` (TEXT), `sincronizado` (INTEGER)

---

## 6. Módulo de Escaneamento Duplo, Porteiro OpenCV e Compressão WebP

### 6.1. Opção 1: Scanner Sem Fio via Celular (QR Code + Envelope Multi-Páginas)
- Ao clicar em **"Escanear com Celular (Sem Fio)"**, o backend cria um registro em `fila_ocr` com `status = 'CAPTURANDO'` e gera um QR Code na tela do PC apontando para `http://{ip_local_da_maquina}:8000/mobile/scan/{sessao_id}`.
- A página `mobile_scan.html` usa `<input type="file" accept="image/*" capture="environment">` para abrir a câmera nativa do celular em máxima resolução sem exigir HTTPS na rede local.
- O funcionário tira a foto da Página 1 (ex: Frente). A imagem é enviada ao PC via `POST /api/scan/{sessao_id}/upload-pagina`.
- Se aprovada pelo Porteiro de Qualidade, o celular exibe a miniatura da Página 1 e dois botões grandes:
  - **`[+ Fotografar Próxima Página (Verso / Anexo)]`**
  - **`[✓ Finalizar Todas as Páginas deste Aluno]`**

### 6.2. Opção 2: Scanner de Mesa Conectado ao PC (USB / Rede) ou Arquivos
- Ao clicar em **"Escanear pelo Computador (Scanner USB)"**:
  - Aciona a interface WIA do Windows (`WIA.CommonDialog`) para capturar página direto do vidro ou alimentador do scanner e adiciona ao envelope atual.
  - Possui também botão **"Importar Imagens/PDF já escaneados no PC"** para selecionar múltiplos arquivos de uma pasta local.

### 6.3. Porteiro de Qualidade de Imagem (`image_processor.py`)
Toda imagem recebida passa instantaneamente (menos de 0,2 segundo) por 3 verificações com `opencv-python-headless`:
1. **Teste Anti-Tremido (Foco):** Converte para escala de cinza, redimensiona para largura base de 1200px e calcula a variância do Laplaciano (`cv2.Laplacian(gray, cv2.CV_64F).var()`). Se o valor for menor que `80.0`, rejeita imediatamente a foto (HTTP 422) exibindo aviso vermelho no celular/PC: *"Foto tremida ou fora de foco! Apoie os braços e tente novamente."*
2. **Teste de Escuridão e Estouro de Flash:** Calcula o brilho médio dos pixels. Se menor que `55` (escura/sombra) ou se mais de 25% da área central tiver brilho acima de `248` (reflexo de flash cego), rejeita com instrução clara ao operador.
3. **Melhoria Documental e Compressão WebP:**
   - Se aprovada, aplica realce suave de contraste adaptativo (CLAHE) para destacar letras antigas em papel amarelado.
   - Redimensiona proporcionalmente limitando o maior lado a **1750 pixels** (~200 DPI para folha A4).
   - Salva no disco local em formato **`.webp` com `quality=78` e `method=6`**, garantindo arquivos entre **180 KB e 350 KB por página**.

---

## 7. Fila Offline de IA (`gemini-2.5-flash`) e Revisão Livre

### 7.1. Processamento em Segundo Plano e Respeito à Cota Gratuita (1.500/dia e 15/min)
- Ao clicar em **"Finalizar Todas as Páginas deste Aluno"**, o envelope muda para `status = 'PENDENTE_IA'`.
- Se a escola estiver sem internet, as páginas ficam salvas localmente e o funcionário pode continuar escaneando dezenas de fichas sem interrupção.
- Quando houver internet, o `ocr_queue_worker.py` envia **todas as páginas daquele aluno juntas** em uma única requisição para o modelo `gemini-2.5-flash` usando `response_schema` (Pydantic), com controle de taxa (máximo 12 requisições por minuto e *exponential backoff* em caso de HTTP 429).

### 7.2. Esquema Pydantic de Extração (`HistoricoExtraidoSchema`)
O prompt de sistema instrui o Gemini a ler fichas antigas brasileiras (datilografadas ou manuscritas) e retornar:
- Dados civis identificados, cada um acompanhado de `baixa_confianca: bool`.
- Regime sugerido (`8_ANOS`, `9_ANOS` ou `EJA_ETAPAS`).
- Lista de séries cursadas com ano letivo, escola, município e resultado final.
- Lista de disciplinas e notas/conceitos por série, onde cada célula possui `valor: str` e `baixa_confianca: bool` (marcado como `true` sempre que houver rasura, carimbo sobre o número, letra cursiva duvidosa ou borrão).

### 7.3. Tela Dividida de Revisão com Liberdade Total de Edição
- A IA atua **exclusivamente como pré-preenchimento (rascunho)**.
- Ao clicar em um item na aba **"Para Revisar"**, abre-se a interface **Split-Screen**:
  - **Lado Esquerdo (42% da largura):** Visualizador das páginas escaneadas com abas (`Página 1`, `Página 2`...), zoom na roda do mouse, arrastar com o mouse e botão de girar 90°.
  - **Lado Direito (58% da largura):** Formulário civil completo + Planilha Matricial de Séries e Notas **100% editáveis**.
  - **Liberdade Total do Operador:** O funcionário pode alterar qualquer texto ou nota, mudar o regime entre 8 e 9 anos, adicionar novas disciplinas, excluir linhas, preencher campos em branco e corrigir qualquer dado.
  - **Guia Visual Amarelo:** Campos onde a IA retornou `baixa_confianca = true` aparecem com fundo amarelo (`bg-amber-100 border-amber-500`) apenas para chamar a atenção do revisor. Assim que o funcionário clica ou edita o campo, o alerta amarelo fica verde.
- Somente quando o funcionário clica em **"Aprovar e Salvar Histórico"** é que os dados são gravados nas tabelas definitivas (`alunos`, `vida_escolar`, `notas_curriculares`) e entram na fila de sincronização da nuvem.

---

## 8. Sincronização Híbrida (Supabase + Multi-Drive de 30 GB)

1. **Gatilho Duplo de Sincronização (`sync_worker.py`):**
   - **Imediato (Reativo):** Disparado em thread assíncrona imediatamente após salvar/aprovar um aluno.
   - **Agendado (2 em 2 horas) e Manual:** Varre todos os registros com `sincronizado = 0`, faz `upsert` no Supabase e, em seguida, faz `pull` de registros novos/atualizados por outro computador da mesma escola.
2. **Roteador Multi-Drive de 30 GB (`drive_router.py`):**
   - **Drive A (`credentials_drive_a.json`):** Armazena as pastas de imagens `.webp` e backups `.db.enc` das **Escolas 1, 2, 3 e 4**.
   - **Drive B (`credentials_drive_b.json`):** Armazena as pastas de imagens `.webp` e backups `.db.enc` das **Escolas 5, 6, 7, 8 e Escolas Extintas (SME)**.
   - Na versão da **Secretaria (SME)**, o roteador conecta nos dois Drives simultaneamente, permitindo visualizar as fotos originais e restaurar backups de qualquer uma das 8 escolas.

---

## 9. Produtividade de Arquivo Passivo e Impressão Oficial A4

1. **Modo Digitação Turbo (Sem Scanner):**
   - Para lançamentos manuais rápidos de pastas da mesma caixa/ano, incluir botão **"Salvar e Criar Próximo da Mesma Época"**, que mantém o Regime (ex: 1ª a 8ª Série), a lista de disciplinas da época e o nome da escola preenchidos, limpando apenas os dados do aluno e as notas.
2. **Catálogo Rápido de Disciplinas Antigas:**
   - Botões de adição rápida na planilha para incluir com 1 clique: *Estudos Sociais, Educação Moral e Cívica (EMC), OSPB, Programas de Saúde, Ciências Físicas e Biológicas, Educação Artística, Língua Estrangeira Moderna, Práticas Agrícolas/Comerciais*.
3. **Layout Oficial de Impressão (`impressao_a4.html`):**
   - Diagramado em preto e branco clássico com CSS `@page { size: A4 portrait; margin: 8mm; }` e tabelas de bordas finas colapsadas (`1px solid #000`).
   - Preenche automaticamente com traços (`---`) todas as células de séries marcadas como `'Não Cursado'`, impedindo adulteração manual no papel impresso.
   - Inclui no rodapé o **Código de Autenticidade** (`codigo_autenticidade`), QR Code de verificação e campos de assinatura para Secretário(a) e Diretor(a) (ou Responsável pelo Setor de Arquivo da SME, no caso de escolas extintas).