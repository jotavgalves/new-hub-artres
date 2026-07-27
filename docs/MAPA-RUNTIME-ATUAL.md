# Mapa do runtime atual

## Status

Este documento descreve a **Atual Versão de Segurança** no commit `a51b6bc530473a09e5c561b7a54643535f82f174`.

Não representa a arquitetura desejada. É um mapa para impedir que scripts aparentemente isolados sejam removidos sem conhecer seu efeito real.

## Fluxo de entrega

```text
Requisição do navegador
  -> Cloudflare Pages Function `functions/[[path]].js`
  -> `ASSETS.fetch()` lê o HTML estático
  -> a Function converte a resposta HTML em texto
  -> remove ou substitui scripts por expressões regulares
  -> injeta estilos e scripts antes de `</head>`
  -> desativa cache da resposta HTML
  -> navegador recebe o HTML modificado
  -> script inline principal de `index.html` executa
  -> scripts injetados executam
  -> scripts injetados substituem APIs e funções globais
  -> MutationObservers e timers continuam alterando a interface
```

## Ordem aproximada no catálogo público

A ordem efetiva depende do parser do navegador e dos atributos `defer`, mas a composição observada é:

1. `catalog-cache-bust.js`, injetado sem `defer`.
2. Script inline principal de `index.html`.
3. Script inline de correção visual das favoritas.
4. `customer-checkout.js`, injetado com `defer`.
5. `catalog-drive-search.js`, injetado com `defer`.
6. `catalog-navigation-ux.js`, injetado com `defer`.
7. `catalog-runtime-safe.js`, criado dinamicamente por `catalog-cache-bust.js`.

Essa ordem precisa ser confirmada no staging com instrumentação do navegador antes de qualquer remoção.

## Componentes e efeitos

### `index.html`

Responsabilidades atuais:

- HTML da página;
- todo o CSS público;
- estado global;
- catálogo;
- busca;
- favoritos;
- carrinho;
- regras de quantidade;
- medidas personalizadas;
- preço e desconto;
- renderização;
- WhatsApp;
- navegação;
- modais e drawer;
- persistência em `localStorage`.

Globais relevantes:

```text
view
themes
products
items
selectedTheme
selectedProduct
currentFolder
folderTrail
cart
seller
prev
favs
favItems
showFavs
PRODUCT_CONFIG
SELLERS
```

Funções globais utilizadas por patches externos:

```text
addItem
entry
save
renderCart
toast
loadThemes
smartBack
waUrl
gross
discount
total
detailsForWhatsApp
hasCustomizedItems
```

### `functions/[[path]].js`

Efeitos no catálogo público:

- lê todo HTML como texto;
- remove injeções anteriores por regex;
- injeta um estilo para centralizar a logo;
- injeta quatro scripts no `head`;
- força `Cache-Control: no-store` para todo HTML;
- remove `content-length`;
- impede que o HTML público seja servido como ativo estático puro.

Efeitos no administrativo:

- remove e reinsere ferramentas de pedidos;
- substitui versões de scripts administrativos;
- usa regex e versão fixa de query string.

### `catalog-cache-bust.js`

Efeitos:

- cria `catalog-runtime-safe.js` dinamicamente;
- consulta `/api/catalog-meta`;
- cria versão de cache baseada em schema fixo de bolinhas;
- remove caches antigos;
- substitui globalmente `Storage.prototype.getItem`;
- substitui globalmente `Storage.prototype.setItem`;
- substitui globalmente `Storage.prototype.removeItem`;
- substitui globalmente `window.fetch`;
- altera todas as chamadas para `/api/drive`.

Risco de remoção direta:

- a leitura do cache pode mudar;
- chaves antigas podem reaparecer;
- chamadas à API podem perder o parâmetro de versão;
- `catalog-runtime-safe.js` deixa de ser carregado.

### `catalog-runtime-safe.js`

Efeitos:

- acessa diretamente `items`, `cart`, `favItems` e `favs`;
- consulta `/api/catalog-rules`;
- remove artes bloqueadas do DOM e do carrinho;
- substitui a função global `addItem`;
- executa no carregamento, no `DOMContentLoaded` e no evento `load`;
- consulta regras ao voltar à aba;
- consulta regras a cada 15 segundos.

Risco de remoção direta:

- artes bloqueadas podem continuar selecionáveis;
- carrinhos existentes podem manter arte desativada;
- a interface pode deixar de atualizar o estado visual após o patch.

### `customer-checkout.js`

Efeitos:

- cria CSS no navegador;
- cria modal de identificação;
- cria snapshot próprio do carrinho;
- salva pedido via API;
- abre WhatsApp;
- tenta substituir o clique de `#confirmSendBtn`;
- observa todo o `body`;
- procura o botão a cada 800 milissegundos.

Problema estrutural observado:

O carrinho principal de `index.html` usa um link `.wa`. O patch procura `#confirmSendBtn`. A integração precisa ser confirmada no navegador, pois o elemento procurado não aparece no markup principal inspecionado.

Perda de dados observada:

O snapshot preserva código, tema, produto, nome, quantidade e imagem. Não preserva `details`, tamanho, medidas, variante, `driveFileId` ou identidade inequívoca.

### `catalog-drive-search.js`

Efeito atual:

- remove `#catalogDriveSearchBox` no carregamento.

Apesar do nome, o arquivo não implementa busca. É um desativador de interface legada.

### `catalog-navigation-ux.js`

Efeitos:

- reescreve textos dos breadcrumbs;
- esconde a etapa `Produtos`;
- remove duplicatas visualmente;
- injeta guia de navegação;
- injeta CSS;
- cria comportamento alternativo de voltar;
- observa toda a árvore do documento;
- agenda nova execução em cliques e inputs globais.

Conflito conhecido:

O script principal define `Produtos` como etapa invariável, mas este patch a oculta.

### Script inline das favoritas

Efeitos:

- percorre todos os botões;
- identifica botões pelo texto renderizado;
- aplica estilo inline;
- observa todo o `body` continuamente.

## Observadores e timers conhecidos

```text
index.html
  phraseTimer: intervalo de mensagens de carregamento
  preloadTimer: atraso para pré-carregamento
  searchTimer: debounce da pesquisa
  toast.t: temporizador do toast
  MutationObserver das favoritas

catalog-runtime-safe.js
  Mutation: não possui observador próprio do DOM
  setInterval: 15 segundos
  eventos: DOMContentLoaded, load, visibilitychange

customer-checkout.js
  MutationObserver em todo o body
  setInterval: 800 milissegundos

catalog-navigation-ux.js
  MutationObserver em document.documentElement
  listeners globais de click e input
  timeouts de 40, 80 e 120 milissegundos
```

## Substituições globais conhecidas

```text
Storage.prototype.getItem
Storage.prototype.setItem
Storage.prototype.removeItem
window.fetch
addItem
```

## Dependências implícitas perigosas

- scripts externos dependem de variáveis declaradas no script inline;
- a ordem de execução é parte do funcionamento;
- funções não exportadas formalmente são tratadas como API pública;
- elementos são encontrados por texto e IDs não garantidos;
- a Function depende de regex que precisa coincidir com HTML específico;
- versões são controladas manualmente em query strings.

## Plano de substituição

Nenhum componente será simplesmente apagado.

Para cada patch:

1. escrever teste que demonstre sua função atual;
2. implementar a mesma regra em módulo oficial;
3. ativar o módulo oficial no staging;
4. desativar somente o patch correspondente;
5. comparar comportamento e screenshots;
6. observar erros e pedidos;
7. remover o patch apenas depois da equivalência.

## Próxima instrumentação necessária

No staging, registrar em ordem cronológica:

- momento de execução de cada script;
- criação de cada timer;
- criação de cada MutationObserver;
- alteração de `window.fetch`;
- alteração de `Storage.prototype`;
- alteração de `addItem`;
- chamadas a `/api/drive`, `/api/catalog-meta` e `/api/catalog-rules`;
- número de execuções de cada observador durante navegação comum.
