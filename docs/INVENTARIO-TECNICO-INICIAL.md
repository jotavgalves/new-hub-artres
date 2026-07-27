# Inventário Técnico Inicial

## Estado

Este documento registra o inventário inicial levantado antes da reconstrução. Ele será atualizado conforme os arquivos forem confirmados em runtime, substituídos ou removidos.

Nenhum item classificado como legado ou candidato à remoção deve ser excluído sem teste de carregamento e comparação funcional.

## Classificações

- `CRITICO_PRODUCAO`: participa diretamente de catálogo, pedido, checkout, administração ou produção.
- `ATIVO`: carregado e necessário.
- `ATIVO_DUPLICADO`: carregado, mas repete responsabilidade existente.
- `PATCH_TEMPORARIO`: corrige comportamento por sobreposição ou injeção.
- `LEGADO`: implementação antiga ainda presente no repositório.
- `NAO_CONFIRMADO`: participação no runtime ainda precisa ser demonstrada.
- `CANDIDATO_REMOCAO`: somente poderá ser removido depois da substituição e dos testes.

## Arquivos principais

| Caminho | Classificação inicial | Responsabilidade observada | Risco |
|---|---|---|---|
| `index.html` | `CRITICO_PRODUCAO` | HTML, CSS e grande parte do JavaScript da aplicação | Muito alto |
| `scripts.js` | `LEGADO` e `NAO_CONFIRMADO` | Implementação antiga duplicada do aplicativo | Médio |
| `functions/[[path]].js` | `CRITICO_PRODUCAO` e `PATCH_TEMPORARIO` | Lê HTML estático, altera conteúdo e injeta recursos | Muito alto |
| `functions/api/drive.js` | `CRITICO_PRODUCAO` | Catálogo público e resposta de produtos e artes | Muito alto |
| `functions/api/_config.js` | `CRITICO_PRODUCAO` | Configuração de produtos, Drives e serviços | Muito alto |
| `functions/api/_catalog_index.js` | `CRITICO_PRODUCAO` | Consulta e normalização do índice de catálogo | Alto |
| `functions/api/_catalog_rules.js` | `ATIVO` | Bloqueios e regras do catálogo | Alto |
| `functions/api/orders.js` | `CRITICO_PRODUCAO` | Criação, persistência e consulta de pedidos | Muito alto |
| `functions/api/admin/production.js` | `CRITICO_PRODUCAO` | Entrada administrativa da produção | Muito alto |
| `functions/api/production/_helpers.js` | `CRITICO_PRODUCAO` | Montagem do payload de produção | Muito alto |
| `functions/api/catalog-meta.js` | `ATIVO` | Metadados públicos do catálogo | Médio |
| `functions/api/catalog-rules.js` | `ATIVO` | Regras públicas do catálogo | Médio |
| `functions/api/public-whatsapp.js` | `ATIVO` | Dados públicos do fluxo de WhatsApp | Médio |
| `assets/catalog-cache-bust.js` | `PATCH_TEMPORARIO` | Altera armazenamento e `fetch` globalmente | Alto |
| `assets/catalog-runtime-safe.js` | `PATCH_TEMPORARIO` | Substitui funções globais e consulta regras periodicamente | Alto |
| `assets/customer-checkout.js` | `PATCH_TEMPORARIO` e `ATIVO_DUPLICADO` | Fluxo paralelo de checkout e pedido | Muito alto |
| `assets/catalog-drive-search.js` | `PATCH_TEMPORARIO` | Busca complementar do catálogo | Alto |
| `assets/catalog-navigation-ux.js` | `PATCH_TEMPORARIO` | Altera navegação e estilos usando observadores | Alto |
| `_headers` | `ATIVO` | Headers básicos de segurança e cache | Médio |
| `README.md` | `LEGADO` | Documentação divergente da implementação atual | Médio |

## Problemas estruturais já confirmados

### Produtos

- partes do backend forçam o produto `bolinhas`;
- configuração central normaliza completamente apenas parte dos produtos;
- produto desconhecido pode receber fallback silencioso;
- preços existem em múltiplos pontos com valores divergentes;
- regras de mínimo e incremento não são respeitadas de forma uniforme.

### Identidade e carrinho

- itens podem ser identificados somente pelo código visual;
- códigos iguais em produtos diferentes podem colidir;
- variante, tamanho e personalização não compõem uma chave interna confiável;
- atualização de quantidade pode usar incremento unitário em produtos com passo específico.

### Pedidos

- o navegador fornece valores que deveriam ser recalculados no servidor;
- detalhes e medidas podem ser descartados em partes do fluxo;
- o backend não valida integralmente a relação entre arte, produto e variante;
- subtotal, desconto e total precisam de autoridade no servidor.

### Produção

- itens podem ser agrupados pelo código numérico;
- seleção da arte pode depender de heurística;
- dois produtos com o mesmo código podem se tornar um único item;
- compatibilidade com pedidos antigos precisa ser preservada na migração.

### Frontend

- HTML, CSS e JavaScript estão concentrados no mesmo arquivo;
- existem funções duplicadas;
- scripts externos substituem funções globais;
- observadores acompanham grandes áreas do documento;
- timers e consultas periódicas podem continuar ativos durante toda a sessão;
- falha de imagem pode substituir um elemento esperado por outras rotinas.

### CSS e renderização

- regras repetidas e blocos descritos como correções finais;
- excesso de `!important`;
- regras móveis contraditórias;
- uso de `object-fit: cover` pode cortar artes;
- scrolls internos, elementos fixos e barras ocultas aumentam o risco de regressão móvel;
- foco visual pode ser removido por CSS.

### Runtime e infraestrutura

- HTML é reescrito por regex na Function de rota;
- scripts e estilos são injetados no runtime;
- cache do HTML é reduzido pela transformação dinâmica;
- catálogo demonstrativo pode mascarar falha real;
- limite fixo de linhas pode truncar catálogos grandes;
- logging e observabilidade ainda são insuficientes.

### Segurança

- endpoint público de pedidos precisa de rate limiting e proteção contra spam;
- origem e conteúdo do pedido precisam de validação mais forte;
- tokens administrativos exigem tratamento mais seguro;
- headers de segurança ainda são incompletos;
- valores sensíveis não devem ser documentados no repositório.

## Mapa de dependências a confirmar

### Entrada HTML

```text
requisição HTML
  -> functions/[[path]].js
  -> leitura do arquivo estático
  -> transformação por regex
  -> injeção de scripts e estilos
  -> index.html com JavaScript inline
  -> patches em assets/
  -> APIs em functions/api/
```

### Catálogo

```text
frontend
  -> /api/drive
  -> configuração
  -> catalog_index no Supabase
  -> regras e bloqueios
  -> resposta de temas, produtos ou itens
```

### Pedido

```text
carrinho no navegador
  -> checkout
  -> /api/orders
  -> Supabase
  -> KV
  -> painel administrativo
  -> produção
```

## Próximas confirmações técnicas

1. Registrar todos os scripts realmente carregados no navegador.
2. Registrar a ordem de carregamento.
3. Registrar funções globais antes e depois de cada patch.
4. Registrar observadores, timers e intervalos.
5. Mapear tabelas, colunas e chaves utilizadas.
6. Mapear bindings do Cloudflare por ambiente.
7. Confirmar quais arquivos estão sem referência.
8. Confirmar URLs e fluxos de produção e staging.
9. Confirmar o formato real dos pedidos antigos.
10. Confirmar regras comerciais válidas com exemplos reais.

## Regra para remoção

Um arquivo somente será marcado como removível quando todas as condições forem atendidas:

- responsabilidade identificada;
- substituto oficial implementado;
- ausência de carregamento confirmada ou patch desativado;
- testes funcionais aprovados;
- screenshots comparadas;
- rollback disponível;
- nenhuma dependência administrativa ou de produção afetada.
