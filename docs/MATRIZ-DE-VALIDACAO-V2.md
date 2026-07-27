# Matriz de Validação da Versão 2

## Como usar

Cada mudança estrutural deve indicar quais casos desta matriz foram executados. Um caso somente é aprovado quando o resultado funcional, os dados persistidos e a renderização estiverem corretos.

Estados permitidos:

- `PENDENTE`
- `EM_TESTE`
- `APROVADO`
- `REPROVADO`
- `NAO_APLICAVEL`

## Ambientes

| Ambiente | Finalidade | Pode receber pedido real? |
|---|---|---|
| Atual Versão de Segurança | Produção e rollback | Sim |
| Staging V2 | Testes funcionais e visuais | Não |
| Desenvolvimento local | Testes isolados | Não |

## Catálogo

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| CAT-001 | Abrir página inicial | Temas carregados sem erro e sem catálogo demonstrativo | PENDENTE |
| CAT-002 | Abrir tema com produtos diretos | Produtos corretos, sem produto forçado | PENDENTE |
| CAT-003 | Abrir tema com subtema | Hierarquia e breadcrumb corretos | PENDENTE |
| CAT-004 | Abrir produto | Artes pertencentes ao produto correto | PENDENTE |
| CAT-005 | Buscar código existente | Arte correta e produto correto | PENDENTE |
| CAT-006 | Buscar código inexistente | Estado vazio claro, sem fallback | PENDENTE |
| CAT-007 | Produto desconhecido | Erro `PRODUTO_NAO_CONFIGURADO` | PENDENTE |
| CAT-008 | Tema bloqueado | Tema não aparece nem abre por URL manipulada | PENDENTE |
| CAT-009 | Arte bloqueada | Arte não aparece nem entra no carrinho | PENDENTE |
| CAT-010 | Falha da API | Erro real e recuperável, sem dados demonstrativos | PENDENTE |
| CAT-011 | Dois Drives ativos | Resultados separados por `root_drive_id` | PENDENTE |
| CAT-012 | Catálogo acima do limite atual | Nenhum truncamento silencioso | PENDENTE |

## Favoritos

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| FAV-001 | Favoritar arte | Estado visual e armazenamento atualizados | PENDENTE |
| FAV-002 | Desfavoritar arte | Item removido sem afetar carrinho | PENDENTE |
| FAV-003 | Reabrir página | Favoritos restaurados | PENDENTE |
| FAV-004 | Mesma arte em produtos distintos | Estados independentes por item | PENDENTE |

## Carrinho

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| CAR-001 | Adicionar item | Item correto com produto e preço corretos | PENDENTE |
| CAR-002 | Adicionar mesmo item | Quantidade atualizada pelo incremento correto | PENDENTE |
| CAR-003 | Adicionar mesmo código em outro produto | Dois itens independentes | PENDENTE |
| CAR-004 | Adicionar duas variantes da mesma arte | Duas linhas independentes | PENDENTE |
| CAR-005 | Diminuir abaixo do mínimo | Operação bloqueada ou item removido conforme regra | PENDENTE |
| CAR-006 | Incremento de bolinhas | Quantidade respeita passo configurado | PENDENTE |
| CAR-007 | Incremento de sacolinha | Quantidade respeita passo configurado | PENDENTE |
| CAR-008 | Atualizar medidas | Detalhes permanecem vinculados ao item correto | PENDENTE |
| CAR-009 | Reabrir página | Carrinho restaurado sem perda de variante ou medida | PENDENTE |
| CAR-010 | Remover item | Somente o item selecionado é removido | PENDENTE |
| CAR-011 | Alterar preço no navegador | Servidor ignora valor adulterado | PENDENTE |

## Checkout e WhatsApp

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| CHK-001 | Carrinho vazio | Checkout bloqueado com mensagem clara | PENDENTE |
| CHK-002 | Dados obrigatórios ausentes | Campos inválidos identificados | PENDENTE |
| CHK-003 | Selecionar vendedora | Vendedora preservada no pedido | PENDENTE |
| CHK-004 | Gerar mensagem | Produtos, variantes, quantidades e medidas corretos | PENDENTE |
| CHK-005 | Pedido com desconto | Servidor recalcula desconto | PENDENTE |
| CHK-006 | Total adulterado | Servidor rejeita ou recalcula | PENDENTE |
| CHK-007 | Duplo clique em confirmar | Um único pedido efetivo | PENDENTE |
| CHK-008 | Falha ao salvar | Mensagem clara e possibilidade de nova tentativa | PENDENTE |

## Pedidos

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| PED-001 | Criar pedido V2 | `schemaVersion: 2` e dados completos | PENDENTE |
| PED-002 | Persistir no Supabase | Registro íntegro | PENDENTE |
| PED-003 | Persistir no KV | Registro íntegro ou estratégia de contingência clara | PENDENTE |
| PED-004 | Consultar por número | Pedido correto retornado | PENDENTE |
| PED-005 | Ler pedido antigo | Compatibilidade preservada | PENDENTE |
| PED-006 | Arte inexistente | Pedido rejeitado | PENDENTE |
| PED-007 | Arte de outro produto | Pedido rejeitado | PENDENTE |
| PED-008 | Variante inválida | Pedido rejeitado | PENDENTE |
| PED-009 | Quantidade inválida | Pedido rejeitado | PENDENTE |
| PED-010 | Payload excessivo | Pedido rejeitado com status adequado | PENDENTE |
| PED-011 | Requisições abusivas | Rate limit aplicado | PENDENTE |

## Produção

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| PRO-001 | Gerar payload V2 | Todos os campos necessários presentes | PENDENTE |
| PRO-002 | Mesmo código em produtos distintos | Itens separados | PENDENTE |
| PRO-003 | Mesma arte em variantes distintas | Itens separados | PENDENTE |
| PRO-004 | Pedido antigo | Payload compatível gerado | PENDENTE |
| PRO-005 | Medidas personalizadas | Medidas preservadas | PENDENTE |
| PRO-006 | Token inválido | Acesso negado sem informação sensível | PENDENTE |

## Renderização e responsividade

Executar os casos principais em:

- 320x568
- 375x667
- 390x844
- 430x932
- 768x1024
- 1024x768
- 1366x768
- 1920x1080

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| UI-001 | Cards de arte | Imagem não cortada indevidamente | PENDENTE |
| UI-002 | Grade de produtos no celular | Número de colunas coerente | PENDENTE |
| UI-003 | Drawer do carrinho | Abre, rola e fecha corretamente | PENDENTE |
| UI-004 | Modal de detalhe | Cabe na tela e preserva controles | PENDENTE |
| UI-005 | Teclado móvel | Campo ativo continua visível | PENDENTE |
| UI-006 | Safe area do iPhone | Conteúdo não fica sob barras do sistema | PENDENTE |
| UI-007 | Falha de imagem | Placeholder estável e nova tentativa possível | PENDENTE |
| UI-008 | Scroll | Sem travamentos ou scrolls internos desnecessários | PENDENTE |
| UI-009 | Estado de erro | Mensagem visível e ação de recuperação | PENDENTE |

## Acessibilidade

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| A11Y-001 | Navegação por Tab | Ordem lógica e foco visível | PENDENTE |
| A11Y-002 | Fechar modal com Escape | Modal fechado e foco devolvido | PENDENTE |
| A11Y-003 | Leitor de tela | Botões e estados possuem nomes acessíveis | PENDENTE |
| A11Y-004 | Contraste | Textos e controles legíveis | PENDENTE |
| A11Y-005 | Movimento reduzido | Animações respeitam preferência do sistema | PENDENTE |

## Segurança e observabilidade

| ID | Caso | Resultado esperado | Estado inicial |
|---|---|---|---|
| SEG-001 | Headers | Políticas previstas presentes | PENDENTE |
| SEG-002 | Origem inválida | Requisição rejeitada quando aplicável | PENDENTE |
| SEG-003 | Token em log | Nenhum segredo registrado | PENDENTE |
| SEG-004 | Erro do Supabase | Log estruturado com ID de requisição | PENDENTE |
| SEG-005 | Erro do KV | Log estruturado com estratégia clara | PENDENTE |
| SEG-006 | Erro do catálogo | Cliente recebe erro explícito | PENDENTE |

## Critério para publicação

Nenhuma etapa poderá avançar para produção se houver reprovação em:

- preço;
- produto;
- quantidade;
- identidade do item;
- pedido;
- medidas;
- WhatsApp;
- produção;
- fluxo móvel principal;
- autenticação administrativa.
