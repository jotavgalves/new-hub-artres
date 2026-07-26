# Plano de Reconstrução do Site V2

## Objetivo

Reconstruir a arquitetura do catálogo e dos pedidos sem interromper a operação atual, sem alterar silenciosamente regras comerciais e sem colocar o novo produto sobre uma base instável.

A versão atualmente publicada será denominada **Atual Versão de Segurança**. A nova implementação será denominada **Site V2**.

## Princípios obrigatórios

1. Produção não será usada como ambiente de desenvolvimento.
2. A Atual Versão de Segurança permanecerá recuperável durante toda a migração.
3. Cada mudança será pequena, rastreável e reversível.
4. O comportamento visual será comparado antes e depois.
5. O servidor será a autoridade sobre produto, preço, quantidade, desconto e total.
6. Produto desconhecido produzirá erro explícito, nunca fallback silencioso.
7. Código visual da arte não será utilizado como identidade interna do item.
8. Compatibilidade com pedidos antigos será preservada durante a transição.
9. Scripts e estilos antigos somente serão removidos depois da substituição comprovada.
10. O produto novo somente será ativado após a validação integral dos fundamentos.

## Estratégia de branches

- `main`: produção atual.
- `safety/atual-versao-de-seguranca`: fotografia preservada e intocável.
- `agent/site-v2-defensive-foundation`: documentação, testes e fundação inicial.
- branches futuras: alterações isoladas da V2.

Padrão sugerido para branches futuras:

- `agent/v2-product-registry`
- `agent/v2-catalog-api`
- `agent/v2-cart-identity`
- `agent/v2-order-schema`
- `agent/v2-production-payload`
- `agent/v2-frontend-modules`
- `agent/v2-css-consolidation`
- `agent/v2-security-observability`

## Fases e portões de avanço

### Fase 0. Preservação

Entregáveis:

- branch de segurança;
- identificação do commit preservado;
- documentação de rollback;
- inventário dos recursos externos;
- proibição de refatoração direta na `main`.

Portão de avanço:

- commit de segurança confirmado;
- branch de segurança acessível;
- documentação de rollback revisada.

### Fase 1. Inventário técnico

Mapear:

- arquivos ativos;
- arquivos legados;
- scripts injetados;
- scripts que substituem funções globais;
- `MutationObserver`, timers e intervalos;
- endpoints;
- tabelas do Supabase;
- chaves do KV;
- bindings do Cloudflare;
- origens do catálogo;
- regras de produto espalhadas no frontend e backend.

Cada arquivo será classificado como:

- `CRITICO_PRODUCAO`
- `ATIVO`
- `ATIVO_DUPLICADO`
- `PATCH_TEMPORARIO`
- `LEGADO`
- `NAO_CONFIRMADO`
- `CANDIDATO_REMOCAO`

Portão de avanço:

- nenhum arquivo será removido sem evidência de que não participa do runtime.

### Fase 2. Baseline funcional e visual

Criar testes para:

- navegação por temas e subtemas;
- listagem de produtos e artes;
- busca;
- favoritos;
- carrinho;
- quantidades;
- personalização;
- seleção de vendedora;
- checkout;
- WhatsApp;
- salvamento e recuperação do pedido;
- painel administrativo;
- payload de produção.

Criar screenshots nas resoluções:

- 320x568
- 375x667
- 390x844
- 430x932
- 768x1024
- 1024x768
- 1366x768
- 1920x1080

Portão de avanço:

- fluxos críticos reproduzíveis;
- screenshots de referência disponíveis;
- diferenças conhecidas documentadas.

### Fase 3. Registro central de produtos

Criar fonte única com:

- `productKey`;
- nome;
- status;
- preço;
- quantidade inicial;
- quantidade mínima;
- incremento;
- variações;
- tamanhos;
- medidas;
- Drives;
- regras de carrinho;
- regras de pedido;
- regras de produção.

A primeira implantação será passiva. O registro existirá sem controlar a produção.

Portão de avanço:

- testes unitários de preço, mínimo, incremento e variantes;
- nenhum comportamento da Atual Versão de Segurança alterado.

### Fase 4. API de catálogo V2

Criar endpoints versionados sem substituir a API antiga.

Estrutura sugerida:

- `/api/catalog/v2/themes`
- `/api/catalog/v2/folders`
- `/api/catalog/v2/products`
- `/api/catalog/v2/items`
- `/api/catalog/v2/search`

Requisitos:

- filtrar por `root_drive_id`;
- respeitar o produto real da linha;
- não forçar `bolinhas`;
- não utilizar `painel-150` como fallback;
- retornar erro explícito para configuração incompleta;
- indicar versão do contrato da API.

Modo sombra:

- API atual alimenta a tela;
- API V2 executa em paralelo;
- respostas são comparadas;
- divergências são registradas sem afetar o cliente.

Portão de avanço:

- equivalência dos fluxos válidos;
- divergências conhecidas justificadas;
- erros claros nos casos inválidos.

### Fase 5. Identidade dos itens e carrinho

Nova identidade interna:

`driveFileId:productKey:variantKey:sizeKey`

O código visual continuará sendo exibido, mas não será chave de armazenamento.

Requisitos:

- permitir códigos iguais em produtos distintos;
- permitir variantes distintas da mesma arte;
- impedir agrupamento incorreto;
- aplicar quantidade pelo incremento do produto;
- restaurar carrinho antigo com migração controlada.

Portão de avanço:

- testes de colisão entre produtos;
- testes de quantidade mínima e incremento;
- carrinho restaurado sem perda.

### Fase 6. Pedido V2

Criar contrato versionado com:

- `schemaVersion`;
- cliente;
- vendedor;
- itens;
- identidade interna;
- produto;
- variante;
- quantidade;
- preço unitário;
- detalhes e medidas;
- subtotal;
- desconto;
- total.

Validações do servidor:

- produto existe;
- arte existe;
- arte pertence ao produto;
- variante é permitida;
- quantidade respeita mínimo e incremento;
- preço é recalculado;
- desconto é recalculado;
- total é recalculado;
- payload manipulado é rejeitado.

Portão de avanço:

- pedidos antigos continuam legíveis;
- pedidos V2 preservam detalhes;
- servidor rejeita adulteração.

### Fase 7. Produção V2

Alterar o agrupamento da produção para usar `itemId`, não apenas código.

O payload deve preservar:

- ID do arquivo;
- nome original;
- código;
- tema;
- subtema;
- produto;
- variante;
- quantidade;
- medidas;
- observações.

Portão de avanço:

- dois produtos com o mesmo código geram itens separados;
- pedidos antigos permanecem processáveis.

### Fase 8. Modularização do frontend

Extrair JavaScript do `index.html` sem alterar comportamento inicialmente.

Estrutura sugerida:

```text
src/
  main.js
  state/
  api/
  catalog/
  products/
  cart/
  checkout/
  orders/
  navigation/
  components/
  utilities/
```

Depois da extração:

- remover duplicações;
- eliminar globais;
- centralizar eventos;
- remover substituições de funções;
- eliminar monkey patches.

Portão de avanço:

- baseline funcional aprovado;
- nenhuma regressão visual não autorizada.

### Fase 9. Desativação controlada dos patches

Para cada patch:

1. documentar a função atual;
2. implementar a função no módulo oficial;
3. desativar o patch apenas em staging;
4. executar testes;
5. comparar screenshots;
6. remover somente após aprovação.

Patches prioritários:

- cache bust global;
- runtime safe;
- checkout paralelo;
- busca auxiliar;
- navegação alterada por observador;
- injeção de CSS;
- alteração de `window.fetch`;
- alteração de `Storage.prototype`;
- reescrita de HTML por regex.

### Fase 10. Consolidação do CSS

Ordem de trabalho por componente:

1. capturar estilos finais computados;
2. transferir o resultado para a regra oficial;
3. remover sobrescritas anteriores;
4. executar comparação visual;
5. reduzir especificidade;
6. remover `!important` desnecessário.

Estrutura sugerida:

```text
styles/
  tokens.css
  base.css
  layout.css
  catalog.css
  product-card.css
  cart.css
  forms.css
  modal.css
  checkout.css
  responsive.css
```

Portão de avanço:

- layout aprovado nas resoluções de referência;
- foco visível e navegação preservados;
- ausência de regressão grave no celular.

### Fase 11. Segurança e observabilidade

Implementar:

- limite de payload;
- rate limiting;
- validação de origem;
- proteção contra spam;
- comparação segura de token;
- logs estruturados;
- ID de requisição;
- monitoramento de Supabase, KV e catálogo;
- headers de segurança;
- política de segurança de conteúdo progressiva;
- erro explícito em vez de catálogo demonstrativo em produção.

Portão de avanço:

- falhas rastreáveis;
- pedidos inválidos rejeitados;
- nenhum segredo exposto em código ou documentação.

### Fase 12. Produto novo

O novo produto deve possuir ficha completa:

- chave;
- nome;
- preço;
- quantidade inicial;
- mínimo;
- incremento;
- tamanhos;
- variantes;
- medidas;
- Drive;
- estrutura de pastas;
- comportamento no carrinho;
- comportamento no pedido;
- comportamento na produção;
- texto do WhatsApp.

Portão de avanço:

- testes de colisão;
- pedido integral no staging;
- payload de produção validado;
- aprovação visual no celular e desktop.

## Estratégia de publicação

1. Staging exclusivo.
2. Ativação administrativa da V2.
3. Ativação controlada para pequena parcela das sessões.
4. V2 como padrão com rollback disponível.
5. Remoção de compatibilidade antiga somente após estabilidade comprovada.

## Gatilhos de rollback

- catálogo vazio;
- preço incorreto;
- identificação errada de produto;
- quantidade incorreta;
- pedido sem detalhes;
- colisão de código;
- falha no WhatsApp;
- falha no painel;
- falha na produção;
- regressão grave no celular;
- aumento anormal de erros.

## Definição de concluído

A reconstrução estará concluída quando:

- produtos vierem de uma única fonte;
- servidor for autoridade dos valores;
- identidade dos itens for inequívoca;
- pedidos preservarem todos os dados;
- produção diferenciar produtos e variantes;
- frontend não depender de monkey patches;
- HTML não for reescrito por regex;
- CSS estiver consolidado;
- testes cobrirem fluxos críticos;
- staging e rollback estiverem operacionais;
- produto novo estiver validado.
