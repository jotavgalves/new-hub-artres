# Inventário de bindings e armazenamento

## Finalidade

Mapear os recursos externos exigidos pela **Atual Versão de Segurança** e definir o que o staging deverá validar antes de executar qualquer código da V2.

Este documento registra somente nomes e responsabilidades. Nenhum valor secreto foi lido ou armazenado.

## Cloudflare Pages

### `ASSETS`

Tipo esperado:

```text
Pages static assets binding
```

Uso atual:

- `functions/[[path]].js` chama `context.env.ASSETS.fetch()`;
- lê o HTML estático como texto;
- injeta scripts e estilos;
- retorna a resposta HTML transformada.

Classificação:

```text
Obrigatório para todas as páginas HTML
```

Risco:

Se a binding estiver ausente, a camada que entrega o HTML deixa de funcionar. A V2 deverá reduzir essa dependência e voltar a servir ativos estáticos sem reconstrução por regex.

## KV

### `CONFIG_KV`

A mesma namespace é utilizada atualmente para várias responsabilidades:

```text
APP_CONFIG
ORDER:<id>
ORDER_DELETED:<id>
ORDER_COUNTER:<ano>
controles e histórico do catálogo dentro de APP_CONFIG
usuários administrativos alternativos dentro de APP_CONFIG
```

Usos confirmados:

1. configuração pública e administrativa;
2. regras de catálogo;
3. pedidos;
4. pedidos excluídos;
5. contador alternativo dos pedidos;
6. usuários e permissões de fallback;
7. configuração da API de produção.

Classificação:

```text
Obrigatório para configuração
Obrigatório para fallback de pedidos
Obrigatório para contador KV
```

Riscos:

- responsabilidades diferentes compartilham uma única namespace;
- uma política de limpeza pode afetar configuração e pedidos;
- não há transação entre contador e gravação do pedido;
- `get` seguido de `put` no contador KV não é incremento atômico;
- a listagem de pedidos depende de prefixos convencionais;
- staging não pode reutilizar essa mesma namespace.

Recomendação V2:

```text
CONFIG_KV
ORDERS_KV ou banco principal de pedidos
CATALOG_RUNTIME_KV
```

A separação será feita somente depois de compatibilidade e migração testadas.

## Supabase do catálogo

### URLs aceitas

O código procura, nesta ordem:

```text
ARTS_SUPABASE_URL
SUPABASE_ARTS_URL
ARTWORKS_SUPABASE_URL
SUPABASE_REST_URL
```

### Chaves aceitas

```text
ARTS_SUPABASE_SERVICE_KEY
SUPABASE_ARTS_SERVICE_KEY
ARTWORKS_SUPABASE_SERVICE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

### Tabela exigida

```text
catalog_index
```

### Colunas lidas

```text
drive_id
parent_drive_id
root_drive_id
type
name
mime_type
path
path_parts
depth
theme
subtheme
product
size
code
extension
drive_url
thumbnail_url
search_text
indexed_at
deleted_at
```

Classificação:

```text
Obrigatório para o catálogo real
```

Risco de alias:

Os aliases genéricos `SUPABASE_REST_URL` e `SUPABASE_SERVICE_ROLE_KEY` também podem ser utilizados pelo banco de pedidos. Se os projetos forem separados, depender desses aliases pode ligar o catálogo ao banco errado.

Regra para staging:

```text
Usar aliases específicos ARTS_SUPABASE_URL e ARTS_SUPABASE_SERVICE_KEY.
Não depender dos aliases genéricos.
```

## Supabase de pedidos e administração

### URLs aceitas

```text
SUPABASE_URL
SUPABASE_REST_URL
```

### Chaves aceitas

```text
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SERVICE_KEY
SUPABASE_KEY
```

### Tabelas exigidas

```text
orders
order_items
customers
staff_users
```

### RPC exigida

```text
next_order_number
```

### Contrato resumido de `orders`

O código grava ou lê, entre outros:

```text
id
order_number
order_code
display_id
legacy_id
customer_id
customer_name
customer_whatsapp
seller_id
seller_name
status
qty
totals
source
user_agent
raw
created_at
updated_at
deleted_at
```

### Contrato resumido de `order_items`

```text
order_id
code
theme
product
product_name
qty
image
raw
```

### Contrato resumido de `customers`

```text
id
name
phone
whatsapp
whatsapp_digits
metadata
```

### Contrato resumido de `staff_users`

```text
id
username
name
role
seller_id
active
password_hash
created_at
updated_at
```

Classificação:

```text
Opcional no código atual porque existe fallback KV
Obrigatório para a arquitetura V2 planejada
```

Riscos:

- gravação em Supabase e KV não é transacional;
- um pedido pode ser salvo em somente um dos dois destinos;
- itens são apagados e recriados em operações separadas;
- o campo `raw` duplica o pedido integral;
- o service role possui acesso privilegiado;
- o schema correto ainda não foi localizado no Supabase conectado nesta sessão.

## Autenticação administrativa

### `ADMIN_SECRET_KEY`

Uso:

- senha do usuário legado `admin`;
- chave HMAC da sessão administrativa;
- requisito para autenticação de toda área administrativa.

Classificação:

```text
Obrigatório para o administrativo atual
```

Risco:

A mesma credencial funciona como senha administrativa e segredo criptográfico de sessão. A V2 deverá separar:

```text
credencial de usuário
segredo de assinatura de sessão
```

## API do aplicativo de produção

O código aceita, nesta ordem:

```text
ARMAZEM_DESKTOP_TOKEN
DESKTOP_APP_TOKEN
PRODUCTION_API_TOKEN
```

Classificação:

```text
Obrigatório quando productionApi.enabled = true
```

Riscos atuais:

- comparação direta de strings;
- CORS permite qualquer origem;
- o token pode ser enviado em `Authorization` ou `X-Armazem-Token`;
- os aliases aumentam a chance de divergência entre ambientes.

Regra para staging:

```text
Usar ARMAZEM_DESKTOP_TOKEN específico do staging.
Nunca reutilizar o token de produção.
```

## Perfis mínimos de ambiente

### Produção pública atual

```text
ASSETS
CONFIG_KV
ARTS_SUPABASE_URL ou alias
ARTS_SUPABASE_SERVICE_KEY ou alias
```

### Administrativo atual

```text
Tudo da produção pública
ADMIN_SECRET_KEY
SUPABASE_URL e chave, se pedidos e usuários estiverem no Supabase
```

### Aplicativo de produção

```text
Tudo do administrativo
ARMAZEM_DESKTOP_TOKEN ou alias
```

### Staging V2

```text
ASSETS isolado por deployment
CONFIG_KV exclusivo do staging
ARTS_SUPABASE_URL confirmado
ARTS_SUPABASE_SERVICE_KEY exclusivo ou com escopo controlado
SUPABASE_URL do projeto correto
SUPABASE_SERVICE_ROLE_KEY do projeto correto
ADMIN_SECRET_KEY exclusivo do staging
ARMAZEM_DESKTOP_TOKEN exclusivo do staging
```

## Bloqueios de segurança do staging

O staging não poderá ser considerado pronto se:

- qualquer binding obrigatória estiver ausente;
- `CONFIG_KV` apontar para produção;
- token administrativo ou de produção for reutilizado;
- o Supabase não possuir as tabelas esperadas;
- catálogo e pedidos usarem aliases genéricos sem confirmação do projeto;
- o endpoint de pedidos puder gravar registros reais;
- a URL de staging puder ser indexada por mecanismos de busca;
- não houver identificação visual do ambiente;
- não houver teste de rollback.

## Situação confirmada nesta sessão

```text
Cloudflare bindings: valores não acessados
Supabase do catálogo correto: não identificado
Supabase de pedidos correto: não identificado
Supabase conectado à sessão: schema incompatível, tratado como outro projeto
KV de produção: confirmado indiretamente pela resposta pública, sem acesso direto
Escritas externas realizadas: nenhuma
```
