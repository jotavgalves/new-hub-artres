# Índice do catálogo do Drive

Este fluxo cria um índice persistente do Google Drive no Supabase para parar de depender de busca ao vivo no Drive durante a navegação do site.

## Arquivos criados

- `supabase/catalog_index.sql`  
  Cria a tabela `public.catalog_index` e índices de busca.

- `scripts/reindex-drive-catalog.mjs`  
  Script Node.js que varre todas as pastas/subpastas do Drive e grava folders/artes no Supabase.

- `.github/workflows/reindex-drive-catalog.yml`  
  Workflow manual para rodar o indexador pelo GitHub Actions.

- `functions/api/catalog-index/search.js`  
  Endpoint novo de busca: `/api/catalog-index/search?q=...`

- `functions/api/catalog-index/tree.js`  
  Endpoint novo de navegação: `/api/catalog-index/tree?mode=...`

- `functions/api/catalog-index/status.js`  
  Endpoint de diagnóstico: `/api/catalog-index/status`

- `.env.catalog-index.example`  
  Exemplo de variáveis locais.

## 1. Criar a tabela no Supabase

Abra o SQL Editor do Supabase de artes e rode:

```sql
-- conteúdo de supabase/catalog_index.sql
```

O banco correto é o banco das artes, o mesmo usado por:

```text
ARTS_SUPABASE_URL=https://tviagmllvnhnrumhmeli.supabase.co/rest/v1
```

## 2. Configurar variáveis

### Para rodar local

Crie `.env.catalog-index` com:

```env
GOOGLE_API_KEY=...
DRIVE_ROOT_FOLDER_ID=193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae
ARTS_SUPABASE_URL=https://tviagmllvnhnrumhmeli.supabase.co/rest/v1
ARTS_SUPABASE_SERVICE_KEY=sb_secret_...
```

Depois rode:

```bash
node scripts/reindex-drive-catalog.mjs --dry-run
node scripts/reindex-drive-catalog.mjs
```

### Para rodar pelo GitHub Actions

Em `Settings > Secrets and variables > Actions`, configure:

```text
GOOGLE_API_KEY
DRIVE_ROOT_FOLDER_ID
ARTS_SUPABASE_URL
ARTS_SUPABASE_SERVICE_KEY
```

Depois abra `Actions > Reindex Drive Catalog > Run workflow`.

## 3. O que o indexador grava

Cada pasta e imagem vira uma linha em `public.catalog_index`.

Campos importantes:

```text
drive_id
parent_drive_id
type = folder | artwork
name
path
path_parts
theme
subtheme
product
size
code
drive_url
thumbnail_url
search_text
last_indexed_run_id
```

A coluna `search_text` é normalizada sem acento e sem caixa alta. Ela permite buscar por código, tema, produto, subpasta, tamanho, nome do arquivo e ID do Drive.

## 4. Endpoints novos

### Status

```text
/api/catalog-index/status
```

Esperado:

```json
{
  "ok": true,
  "ready": true,
  "hasFolders": true,
  "hasArtworks": true
}
```

### Busca global

```text
/api/catalog-index/search?q=4408
/api/catalog-index/search?q=rei%20leao
/api/catalog-index/search?q=painel%20redondo
/api/catalog-index/search?q=ID_DO_DRIVE
```

Retorna:

```json
{
  "ok": true,
  "source": "catalog_index",
  "total": 1,
  "items": [],
  "folders": []
}
```

### Temas

```text
/api/catalog-index/tree?mode=themes
```

### Filhos de uma pasta

```text
/api/catalog-index/tree?mode=children&parentDriveId=ID_DA_PASTA
```

### Produtos por tema

```text
/api/catalog-index/tree?mode=products&theme=Rei%20Leao
```

### Artes por tema/produto

```text
/api/catalog-index/tree?mode=items&theme=Rei%20Leao&product=Painel%20Redondo
```

## 5. Importante

Este pacote não substitui automaticamente `/api/drive` nem altera o HTML público. Isso foi proposital para evitar quebrar o site.

Depois que o índice estiver preenchido e os endpoints novos estiverem respondendo corretamente, o próximo passo é trocar o front para usar `/api/catalog-index/tree` e `/api/catalog-index/search`.

## 6. Teste de aceitação

1. Rodar SQL.
2. Rodar indexador.
3. Abrir:

```text
/api/catalog-index/status
```

4. Confirmar `ready: true`, `hasFolders: true`, `hasArtworks: true`.
5. Testar:

```text
/api/catalog-index/search?q=4408
/api/catalog-index/search?q=rei%20leao
/api/catalog-index/search?q=painel%20redondo
```

6. Só depois integrar no front.
