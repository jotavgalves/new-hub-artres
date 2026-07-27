# Baseline real da Atual Versão de Segurança

## Finalidade

Este documento registra o comportamento efetivamente entregue pelo site público em 26 de julho de 2026.

A referência de código preservada continua sendo:

```text
a51b6bc530473a09e5c561b7a54643535f82f174
```

A referência pública testada foi:

```text
https://new-hub-artres.pages.dev
```

Nenhum pedido foi finalizado ou salvo durante os testes.

## Teste executado

O workflow `Atual Versão de Segurança Baseline` executou quatro cenários:

1. página inicial em desktop, 1366 x 768;
2. página inicial em viewport móvel, 390 x 844;
3. navegação até uma arte e inclusão no carrinho em desktop;
4. navegação até uma arte e inclusão no carrinho em viewport móvel.

O workflow foi concluído com sucesso.

Evidência:

```text
Workflow run: 30212926954
Artifact: atual-versao-de-seguranca-baseline
Artifact id: 8634987436
Retenção configurada: 30 dias
```

O artifact contém screenshots, relatório e diagnósticos do navegador.

## Resultado funcional

Todos os seguintes pontos passaram:

- carregamento do site público;
- renderização do cabeçalho;
- carregamento dos temas;
- navegação até o primeiro tema;
- carregamento das artes;
- exibição das imagens;
- inclusão de uma arte no carrinho;
- atualização do contador;
- atualização do subtotal e total;
- execução em desktop;
- execução em viewport móvel.

Durante os quatro cenários, os diagnósticos não registraram:

- erro de console;
- exceção não tratada da página;
- requisição com falha de rede;
- resposta HTTP com status igual ou superior a 400.

Esse resultado vale somente para os fluxos testados. Checkout, criação de pedido, WhatsApp, administrativo, Supabase, KV e produção ainda exigem testes específicos.

## Estado real da página inicial

O site público entregou:

```text
Título: Escolha suas Artes | Armazém Festa e Eventos
H1: Vamos montar a sua festa?
Título promocional: Escolha suas artes com calma e envie tudo pronto
Quantidade: 472 tema(s)
```

A página inicial apresentou 472 botões de tema.

## Divergência entre código estático e produção

O `index.html` preservado contém:

```text
Vamos montar sua festa?
10% OFF por aqui
```

A produção testada entregou:

```text
Vamos montar a sua festa?
Pedido organizado
```

Portanto, o HTML estático do repositório não é uma fotografia suficiente do conteúdo visível. Há aplicação de configuração ou transformação em runtime.

A causa exata dessa divergência ainda será isolada. Não deve ser atribuída exclusivamente a um arquivo sem teste específico.

## Scripts confirmados no navegador

A ordem observada em `document.scripts` foi:

```text
1. /assets/catalog-cache-bust.js?v=9
2. /assets/catalog-runtime-safe.js?v=1
3. /assets/customer-checkout.js?v=6
4. /assets/catalog-drive-search.js?v=4
5. /assets/catalog-navigation-ux.js?v=3
6. inline
7. inline
8. /assets/confirm-modal.js?v=2
9. /assets/order-capture.js?v=1
```

Os seguintes indicadores globais estavam ativos:

```text
__CATALOG_VERSIONED_CACHE__ = true
__ARMAZEM_CATALOG_RUNTIME_SAFE__ = true
__ARMAZEM_CUSTOMER_CHECKOUT__ = true
__ARMAZEM_CATALOG_NAV_UX__ = true
```

Essa observação corrige o mapa preliminar, que ainda não havia confirmado `confirm-modal.js` e `order-capture.js` no navegador público.

## Observação sobre `confirm-modal.js`

O arquivo confirma a integração que antes parecia desconectada:

1. intercepta clique no link `a.wa`;
2. cria `#confirmSendBtn` dinamicamente;
3. `customer-checkout.js` procura e substitui o comportamento desse botão;
4. o funcionamento depende da ordem de carregamento e de observadores.

A integração existe, mas permanece estruturalmente frágil porque um script cria o elemento e outro script o procura continuamente.

## Observação sobre `order-capture.js`

No estado analisado, o arquivo registra um listener global de clique, mas retorna sem executar ação quando `window.__ARMAZEM_CUSTOMER_CHECKOUT__` está ativo.

Na produção testada esse indicador estava ativo. Assim, o arquivo permaneceu carregado sem realizar captura efetiva no fluxo observado.

Ele não será removido até que testes confirmem o comportamento quando o checkout do cliente estiver ausente ou falhar.

## Catálogo observado

O primeiro tema selecionado pelo teste foi:

```text
1 ANO
```

A navegação chegou diretamente ao produto:

```text
Bolinhas 50x50
```

Foram exibidas duas artes:

```text
#2657
#2656
```

O fluxo observado apresentou a etapa `Produtos` no breadcrumb, embora o script de navegação também mantenha um controle separado de voltar.

## Preço observado no navegador

Cada card exibiu:

```text
R$ 9,75 cada
```

Depois de adicionar uma unidade da arte `#2657`, o carrinho exibiu:

```text
Quantidade: 1
Subtotal: R$ 9,75
Total: R$ 9,75
Mensagem: Faltam 5 para fechar o mínimo de 6.
```

Esse comportamento confirma duas informações importantes:

1. a produção permite temporariamente uma quantidade inválida de uma bolinha;
2. no fluxo público testado, uma unidade foi calculada por R$ 9,75.

Isso diverge do `PRODUCT_CONFIG` estático do `index.html`, que declara R$ 9,90 para a unidade usada pela fórmula local preservada.

A configuração efetiva de produção deve ser considerada fonte independente até identificarmos exatamente qual camada substitui o valor.

## Chaves de armazenamento observadas

Na página inicial foram observadas chaves de versão e cache do catálogo.

Depois da navegação e inclusão no carrinho também apareceram:

```text
armazem:lastPlace
armazemHubCartV2
armazemHubFavItemsV2
armazemHubFavsV2
catalog-meta-version
drive-cache:vcatalog-index-v2-bolinhas-49:...
```

O prefixo efetivo de cache observado foi:

```text
vcatalog-index-v2-bolinhas-49
```

Esse valor deverá ser tratado como estado de produção observado, não como constante permanente da V2.

## Screenshots preservados

O artifact inclui:

```text
desktop/home-full.png
desktop/artwork-list.png
desktop/cart-after-one-item.png
mobile/home-full.png
mobile/artwork-list.png
mobile/cart-after-one-item.png
```

Essas imagens formam a primeira referência visual aprovada automaticamente. Elas ainda não constituem aprovação humana do design.

## Limitações desta rodada

Não foram testados:

- seleção de vendedora;
- mínimo completo de bolinhas;
- incremento depois do mínimo;
- favoritas;
- busca por código;
- modal de confirmação;
- identificação do cliente;
- gravação de pedido;
- abertura do WhatsApp;
- pedidos antigos;
- administrativo;
- envio para produção;
- indisponibilidade de API;
- comportamento offline;
- outros produtos;
- medidas personalizadas.

## Próximos testes obrigatórios

1. busca por código sem alterar carrinho;
2. favoritas e restauração do armazenamento;
3. quantidades válidas e inválidas;
4. modal de confirmação sem envio;
5. checkout com endpoint de teste isolado;
6. pedido V2 somente em staging;
7. colisão do mesmo código em produtos diferentes;
8. carregamento e falha controlada das APIs;
9. snapshots específicos dos componentes móveis;
10. administrativo em ambiente isolado.
