# Painel administrativo do staging V2, somente leitura

## Objetivo

Disponibilizar uma visualização administrativa isolada para os pedidos criados com o catálogo sintético do Worker V2 de staging.

O painel não é o futuro administrador de produção. Ele é uma ferramenta temporária de validação arquitetural e operacional.

## Endereço projetado

Após merge e novo deploy manual do staging:

```text
https://new-hub-artres-v2-staging.jvgacontato.workers.dev/admin
```

Nenhuma rota do domínio público atual é alterada.

## Autenticação temporária

O painel solicita a mesma chave interna do staging e a envia somente no cabeçalho:

```text
X-Staging-Token
```

A chave:

- não é gravada em `localStorage`;
- não é gravada em `sessionStorage`;
- não é colocada na URL;
- não é gravada em cookie;
- permanece apenas na memória JavaScript da aba;
- é removida ao clicar em `Desconectar` ou fechar/recarregar a página.

O mecanismo definitivo com usuário `admin` e `ADMIN_SECRET_KEY` permanece reservado para uma etapa posterior, em um projeto administrativo próprio e com sessão HttpOnly.

## Dados exibidos

A API administrativa retorna apenas:

- número do pedido;
- data de criação;
- status;
- vendedor sintético;
- itens e quantidades;
- valores calculados pelo servidor;
- origem sintética;
- totais agregados do ledger;
- quantidade de eventos pendentes no outbox.

O objeto de cliente é sempre substituído por:

```json
{
  "redacted": true
}
```

Nome, telefone e WhatsApp não são devolvidos ao navegador.

## Fonte dos pedidos

Nesta primeira versão, a listagem é derivada dos eventos pendentes `order.created.v2` do outbox do shard do ano corrente.

Isso é suficiente para o estágio atual porque:

- não existe dispatcher externo ativo;
- todos os pedidos são sintéticos;
- os eventos permanecem pendentes;
- não há integração com Supabase, Drive, KV ou sistema comercial.

Uma listagem paginada diretamente da tabela `orders` será avaliada antes de qualquer uso administrativo real.

## Garantias de somente leitura

A rota administrativa aceita exclusivamente:

```text
GET /internal/v2/admin/orders
```

Outros métodos retornam HTTP 405.

A interface não contém chamadas `POST`, `PUT`, `PATCH` ou `DELETE`. Também não contém botões de criação, edição, cancelamento ou exclusão.

## Segurança da página

O Worker envia:

- `Cache-Control: no-store`;
- CSP restrita a recursos da mesma origem;
- `frame-ancestors 'none'`;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `X-Robots-Tag: noindex, nofollow, noarchive`.

A renderização dinâmica usa `textContent` e criação explícita de elementos. Dados da API não são inseridos com `innerHTML`.

## Testes

O baseline executa:

1. testes estáticos de autenticação, CSP, ausência de persistência da chave e ausência de métodos de escrita;
2. validação de sintaxe dos módulos;
3. dry-run do bundle Cloudflare;
4. smoke local do Worker e do Durable Object;
5. smoke local específico do painel, incluindo:
   - carregamento da página;
   - rejeição sem token;
   - criação de um pedido sintético de R$ 58,50;
   - leitura administrativa autenticada;
   - confirmação da redação dos dados pessoais;
   - rejeição de `POST` na rota administrativa.

## Estado de publicação

A criação deste documento e do PR não publica o painel. O painel somente ficará acessível depois de:

1. aprovação do PR;
2. merge explícito na `main`;
3. nova execução manual do workflow de staging sintético;
4. validação do `/health` e da rota `/admin`.
