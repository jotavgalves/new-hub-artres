# Baseline das regras de produtos

## Finalidade

Registrar o que a **Atual Versão de Segurança** declara e executa antes de escolher qual regra será oficial na V2.

Este arquivo não corrige divergências. Ele impede que uma divergência seja resolvida por suposição.

Base analisada: `a51b6bc530473a09e5c561b7a54643535f82f174`.

## Regra de decisão

Uma regra só poderá virar canônica quando estiver confirmada por pelo menos uma destas fontes:

1. decisão expressa do negócio;
2. configuração administrativa vigente;
3. pedido real validado;
4. comportamento de produção confirmado;
5. documentação comercial atual.

Código duplicado ou README antigo não será considerado autoridade isolada.

## Produtos observados no frontend

| Chave | Nome | Tipo | Valor observado | Quantidade | Personalização |
|---|---|---|---:|---|---|
| `50x50` | Bolinhas 50x50 | redondo | conflito | mínimo 6, depois pares | diâmetro padrão 50 no frontend, desativada na configuração do backend |
| `painel-150` | Painel 150x150 | redondo | R$ 59,90 | incremento atual de 1 | diâmetro padrão 150 |
| `redondo-indefinido` | Painel 150x150 | redondo | R$ 59,90 | incremento atual de 1 | alias observado |
| `cenario` | Cenário | retangular | R$ 59,90 | incremento atual de 1 | largura e altura |
| `lateral` | Lateral | retangular | R$ 59,90 | incremento atual de 1 | largura e altura |
| `retangular` | Lateral | retangular | R$ 59,90 | incremento atual de 1 | alias observado |
| `cilindros` | Cilindros | kit de cilindros | R$ 99,00 | incremento atual de 1 | P, M, G e tampas |
| `kit-painel-cilindros` | Kit Painel + Cilindros | kit | R$ 158,90 | incremento atual de 1 | cilindros e painel redondo |
| `kit-romano` | Kit + Romano | kit | R$ 210,00 | incremento atual de 1 | cilindros e romano |
| `romano` | Romano | romano | R$ 78,00 | incremento atual de 1 | largura e altura |
| `romano-lateral` | Romano + Lateral | composto | R$ 137,90 | incremento atual de 1 | romano, largura e altura da lateral |
| `sacolinha` | Sacolinha de Festa | variantes | P R$ 6,00, M R$ 8,00, G R$ 10,00 | mínimo 10, depois de 5 em 5 | tamanho P, M ou G |

## Conflito crítico das bolinhas

Valores simultaneamente observados:

```text
Card e texto comercial: R$ 9,75 cada
Configuração padrão do backend: R$ 9,75 cada
PRODUCT_CONFIG do frontend: R$ 9,90 por unidade
Fórmula do frontend: 6 unidades = R$ 58,90
Unidades depois das seis: R$ 9,90
```

Consequências:

- seis vezes R$ 9,75 seriam R$ 58,50, não R$ 58,90;
- seis vezes R$ 9,90 seriam R$ 59,40, não R$ 58,90;
- o pacote possui preço próprio;
- a unidade adicional possui outro valor observado;
- a expressão “R$ 9,75 cada” não descreve integralmente a fórmula em execução.

Decisão necessária antes da ativação da V2:

```text
A. preço unitário único;
B. pacote inicial com preço próprio e adicional com outro preço;
C. outra regra comercial definida pelo negócio.
```

Até a decisão, o produto `50x50` ficará marcado como bloqueado para migração canônica.

## Problemas de quantidade observados

### Bolinhas

Regra declarada:

```text
mínimo 6
após 6, acrescentar de 2 em 2
```

Comportamento atual dos botões:

```text
primeira inclusão: 1 unidade
botão adicionar: +1
botão remover: -1
favoritas existentes: +1
```

O carrinho bloqueia a finalização, mas permite estados inválidos como 1, 3, 5, 7 e 9.

### Sacolinhas

Regra declarada:

```text
mínimo 10
após 10, acrescentar de 5 em 5
```

Comportamento atual:

```text
primeira inclusão: 10
próximo clique: 11
botão adicionar: +1
botão remover: -1
favorita já existente: +1
```

O carrinho permite estados inválidos e somente impede a finalização depois.

## Identidade atual do carrinho

A função de busca usa apenas:

```text
item.id
```

O `item.id` vem da API ou de dados demonstrativos. O modelo não declara formalmente:

- produto;
- variante;
- tamanho;
- Drive;
- arquivo;
- configuração de medidas.

A V2 deverá utilizar uma identidade composta e estável.

Proposta inicial:

```text
driveFileId:productKey:variantKey:sizeKey
```

A proposta ainda será validada contra o índice do Supabase e o aplicativo de produção.

## Fallback de produto

O frontend executa:

```text
PRODUCT_CONFIG[product] || PRODUCT_CONFIG["painel-150"]
```

Produto desconhecido passa a se comportar como painel de R$ 59,90.

Regra V2:

```text
Produto desconhecido deve gerar PRODUTO_NAO_CONFIGURADO.
```

Não será permitido fallback comercial silencioso.

## Fonte de catálogo observada

O backend público usa `getBolinhas(config)` como configuração dominante.

No modo `items`, a resposta declara sempre:

```text
product: bolinhas.productKey
productName: bolinhas.label
```

Ao converter cada arte, o backend também força o produto para bolinhas antes de considerar o produto do índice.

Consequência:

O catálogo público atual não constitui prova de suporte genérico a todos os produtos listados no frontend.

## Desconto

O frontend calcula:

```text
desconto = subtotal x 10%
total = subtotal menos desconto
```

Pontos ainda não confirmados:

- se todos os produtos participam do desconto;
- se medidas personalizadas alteram preço;
- se há campanha com data de início e término;
- se o servidor deve arredondar por item ou sobre o subtotal;
- se pedido antigo preserva o mesmo cálculo.

A V2 não confiará no total calculado pelo navegador.

## Medidas personalizadas

Tipos observados:

```text
round
rectangle
roman
romanRectangle
cylinders
kitPanelCylinders
kitRoman
bag
```

Regras parcialmente observadas:

- painel redondo personalizado deve ter pelo menos 90 cm;
- medida redonda personalizada deve avançar de 10 em 10 cm;
- o valor igual ao padrão não é considerado personalização;
- o cliente pode marcar que ainda não sabe as medidas;
- há aviso de produção a partir do próximo dia útil;
- sacolinha usa tamanho fechado, não medida personalizada.

Pendências:

- limites de largura e altura;
- medidas padrão dos produtos não redondos;
- acréscimo de preço por personalização;
- regras de produção;
- unidades aceitas;
- validação do servidor.

## Estados necessários no registro V2

Cada produto deverá possuir:

```text
active
catalogEnabled
checkoutEnabled
productionEnabled
validationStatus
blockedReasons
```

Isso permitirá cadastrar um produto antes de liberá-lo e impedir que configuração incompleta chegue ao cliente.

## Decisões pendentes do negócio

1. Regra final de preço das bolinhas.
2. Se o mínimo de seis é por arte, por produto ou pelo carrinho inteiro.
3. Se o passo par é aplicado por arte ou total de bolinhas.
4. Se sacolinhas de tamanhos diferentes podem compartilhar o mesmo grupo de mínimo.
5. Se o desconto de 10% vale para todos os produtos.
6. Valores e limites de medidas personalizadas.
7. Produtos e aliases que continuam comerciais.
8. Qual produto novo será incluído e suas regras completas.

Enquanto essas decisões não estiverem confirmadas, o registro passivo apenas documentará o observado e bloqueará ativação automática.
