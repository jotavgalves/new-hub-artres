# Checklist mestre de execução do Site V2

Atualizado em: 2026-07-29

## Objetivo

Concluir a reconstrução do Site V2 por etapas finitas, verificáveis e reversíveis, sem alterar silenciosamente a produção atual.

Este arquivo é a fonte principal de acompanhamento. Toda etapa concluída deve ser marcada aqui no mesmo PR que entrega a implementação ou a validação correspondente.

## Estados permitidos

- `[ ] PENDENTE`: ainda não iniciado.
- `[-] EM ANDAMENTO`: existe trabalho ativo em branch ou PR identificado.
- `[!] BLOQUEADO`: depende de informação, credencial, infraestrutura ou decisão externa claramente registrada.
- `[x] CONCLUÍDO`: implementação incorporada, testes aprovados e evidência registrada.

## Regras de execução

1. Apenas uma etapa principal permanece `EM ANDAMENTO` por vez.
2. Nenhuma etapa é marcada como concluída apenas porque o código foi escrito.
3. Cada conclusão deve indicar PR, commit ou workflow que comprovou o resultado.
4. Falha de teste mantém a etapa em andamento ou bloqueada.
5. Produção pública só pode ser alterada na etapa de migração controlada.
6. Não serão adicionadas novas fases sem registrar motivo, escopo e critério de encerramento.
7. O projeto termina quando todos os itens obrigatórios desta lista estiverem concluídos e a definição de pronto estiver satisfeita.

## Progresso consolidado

### 0. Preservação e rollback

- [x] Preservar a Atual Versão de Segurança.
- [x] Manter branch de recuperação `safety/atual-versao-de-seguranca`.
- [x] Documentar rollback e isolamento da V2.

Evidência: PR #1 e branch de segurança.

### 1. Fundação transacional e segurança

- [x] Registro central de produtos em modo passivo.
- [x] Contrato de pedido V2 e recálculo no servidor.
- [x] Identidade interna baseada em arquivo, produto, variante e tamanho.
- [x] Durable Object SQLite com sequência, pedido, idempotência e outbox atômicos.
- [x] Limite de payload e sanitização de erros.
- [x] Painel administrativo de staging com dados pessoais redigidos.

Evidência: PRs #1, #4, #5, #6, #7 e baselines correspondentes.

### 2. Supabase V2 de staging

- [x] Criar schema privado e tabelas de projeção.
- [x] Restringir RPCs privilegiadas ao `service_role`.
- [x] Ativar projeção sombra não bloqueante.
- [x] Validar criação, replay e projeção exatamente uma vez.
- [x] Permitir pedidos distintos com o mesmo fingerprint comercial.

Evidência: PRs #8, #9, #10, #11, #13, #14 e #29.

### 3. Catálogo real aceito no staging

- [x] Inspecionar integralmente o catálogo real.
- [x] Confirmar versão 49, 486 temas, 499 pastas, 497 produtos virtuais e 4.132 artes.
- [x] Confirmar zero rejeições e zero diferenças sombra.
- [x] Publicar projeção aceita no Supabase de staging.
- [x] Servir o catálogo aceito pelo Worker de staging.
- [x] Verificar automaticamente novas versões a cada seis horas.
- [x] Preservar a última versão aceita quando uma candidata falhar.

Evidência: PRs #19, #20, #21, #22, #23, #25, #27 e #28; issue #16.

### 4. Publicação completa do staging

- [x] Publicar design atual sem transformação.
- [x] Validar assets, catálogo, navegação e health.
- [x] Validar pedido sintético, replay e bloqueios.
- [x] Validar projeção no Supabase.
- [x] Manter rollback automático.

Evidência: commit `318597cfbda45f94364a75a9bb11cb2567bca2c7`.

### 5. Checkout V2 conectado ao catálogo real

- [x] Criar fundação da rota pública de checkout somente no staging.
- [x] Manter a rota desativada por flag até os testes finais desta etapa.
- [x] Resolver cada item contra a versão aceita do catálogo.
- [x] Validar produto, variante, tamanho e vínculo da arte no servidor.
- [x] Recalcular quantidade, preço, desconto e total no servidor.
- [x] Preservar cliente, vendedora, medidas, observações e personalizações.
- [x] Aplicar idempotência contra duplo clique e repetição de requisição.
- [x] Rejeitar arte inexistente, produto incorreto, variante inválida e quantidade inválida.
- [x] Adicionar proteção de origem, limite de requisições e resposta sanitizada.
- [x] Executar smoke remoto sem pedido de cliente real.

Evidência:

- PR #31, `Site V2 Baseline` run `30452012797` e deploy do commit `7ee4c59e4bf76a478d0236e0d75dcc79d1401268`: rota `/api/orders/v2` restrita ao staging, desligada e incapaz de gravar pedidos.
- PR #32, `Site V2 Baseline` run `30452445872`, migration `catalog_checkout_items_rpc` aplicada ao Supabase de staging e validação remota da versão 49: IDs duplicados são deduplicados, itens existentes são resolvidos e ausentes produzem contagem incompleta para rejeição pelo Worker.
- PR #33, `Site V2 Baseline` run `30453757686` e deploy validado no commit `6548a7748ed274316d771f56f9882b33cfa1d742`: arte real aprovada com produto, variante e tamanho corretos; adulterações rejeitadas; nenhuma escrita pela rota seca; produção pública inalterada.
- PR #35, `Site V2 Baseline` run `30455143822`, e PR #36, `Site V2 Baseline` run `30455666318`, com deploy validado no commit `46d0f05219b298b5b1c310d128754caafdc27e2a`: preço de R$ 0,01 e total adulterado ignorados, seis unidades recalculadas para R$ 58,50, quantidades 4 e 7 rejeitadas, checkout público desligado e produção inalterada.
- PR #37, `Site V2 Baseline` run `30457071943` e deploy validado no commit `daacfba330e39f19553fc598bf8ebf1f3f9090fb`: cliente, vendedora, medidas, observações e personalizações preservados no comando canônico, resposta sem dados privados, checkout público desligado e produção inalterada.
- PR #38, `Site V2 Baseline` run `30460033254`, e PR #39, `Site V2 Baseline` run `30460937516`, com deploy validado no commit `bd933dcb6f47cbd1f956deefca377b0af8a43a58`: pedido sintético criado, repetição retornou `REPLAY` com o mesmo número, reutilização conflitante rejeitada com HTTP 409, projeção no Supabase concluída, checkout público desligado e produção inalterada.
- PR #40, `Site V2 Baseline` run `30461919511`, PR #41, `Site V2 Baseline` run `30462322689`, e PR #42, `Site V2 Baseline` run `30462948776`, com deploy validado no commit `11c9cebf8442a4543bb68074a941dcb7a9ea31c5`: arte inexistente, produto incorreto, variante inválida e quantidade inválida rejeitados na prévia e na submissão; replay aguardou propagação ativa sem aceitar nova criação; pedido sintético e projeção aprovados; produção pública inalterada.
- PR #43, `Site V2 Baseline` run `30465273749`, e PR #44, `Site V2 Baseline` run `30465995524`, com deploy validado no commit `e21b60f2740b4516b2172af8a4548f33c448e3b0`: origem obrigatória, allowlist, rate limiter, chave SHA-256, respostas sanitizadas e probe seco aprovados após três respostas estáveis; contrato, rejeições, pedido sintético e projeção também aprovados; produção pública inalterada.

Critério de conclusão satisfeito: checkout do staging cria e reproduz pedido V2 usando arte e produto reais do catálogo aceito, com valores calculados pelo servidor, proteções ativas e sem alterar produção.

### 6. Carrinho e frontend V2 no staging

- [-] Criar identidade inequívoca para linhas do carrinho.
- [ ] Separar códigos iguais em produtos diferentes.
- [ ] Separar variantes e tamanhos da mesma arte.
- [ ] Aplicar mínimo e incremento de cada produto.
- [ ] Migrar ou restaurar carrinho antigo sem perda.
- [ ] Conectar checkout visual à rota V2.
- [ ] Preservar vendedora, medidas e observações.
- [ ] Gerar WhatsApp com itens, variantes, quantidades e medidas corretos.
- [ ] Tratar falha de envio e permitir repetição segura.

Critério de conclusão: fluxo visual integral, da arte ao pedido e WhatsApp, aprovado no staging.

### 7. Compatibilidade e produção V2

- [ ] Ler pedidos antigos sem regressão.
- [ ] Definir e validar estratégia temporária para KV legado.
- [ ] Gerar payload de produção por `itemId`.
- [ ] Preservar arquivo, nome original, produto, variante, tamanho, medidas e observações.
- [ ] Manter separados códigos iguais de produtos distintos.
- [ ] Manter separadas variantes da mesma arte.
- [ ] Validar transições de status e reprocessamento.

Critério de conclusão: pedidos V2 e antigos geram payload de produção correto e inequívoco.

### 8. Testes funcionais, visuais e de acessibilidade

- [ ] Atualizar a matriz de validação com o estado real.
- [ ] Aprovar catálogo, favoritos, carrinho, checkout, pedidos e produção.
- [ ] Aprovar 320x568, 375x667, 390x844, 430x932, 768x1024, 1024x768, 1366x768 e 1920x1080.
- [ ] Validar drawer, modal, teclado móvel, safe area e scroll.
- [ ] Validar navegação por teclado, foco, Escape, nomes acessíveis e contraste.
- [ ] Registrar screenshots de referência e diferenças autorizadas.

Critério de conclusão: nenhuma reprovação em preço, produto, quantidade, identidade, pedido, medidas, WhatsApp, produção, fluxo móvel ou autenticação administrativa.

### 9. Modularização e remoção controlada do legado

- [ ] Extrair JavaScript do `index.html`.
- [ ] Modularizar estado, catálogo, produtos, carrinho, checkout, pedidos e navegação.
- [ ] Eliminar funções duplicadas e globais substituídas.
- [ ] Remover monkey patches comprovadamente substituídos.
- [ ] Remover reescrita de HTML por regex.
- [ ] Consolidar CSS e reduzir `!important`.
- [ ] Remover arquivos legados somente após prova de ausência no runtime.

Critério de conclusão: frontend sem patches temporários críticos, mantendo comportamento e aparência aprovados.

### 10. Segurança e observabilidade de operação

- [ ] Aplicar rate limiting adequado ao checkout público.
- [ ] Validar origem quando aplicável.
- [ ] Completar headers de segurança e CSP progressiva.
- [ ] Registrar logs estruturados com ID de requisição.
- [ ] Monitorar catálogo, Worker, Durable Object, Supabase e integrações.
- [ ] Criar alerta de falha de projeção e crescimento da outbox.
- [ ] Testar indisponibilidade e recuperação das dependências.

Critério de conclusão: falhas rastreáveis, dados sensíveis ausentes dos logs e recuperação testada.

### 11. Produto novo

- [ ] Definir ficha completa do produto novo.
- [ ] Cadastrar preço, mínimo, incremento, variantes, tamanhos e medidas.
- [ ] Configurar Drive e estrutura de pastas.
- [ ] Validar catálogo, carrinho, checkout, WhatsApp e produção.
- [ ] Testar colisões de código.
- [ ] Aprovar desktop e celular.

Critério de conclusão: produto novo percorre o fluxo integral sem regra especial espalhada pelo código.

### 12. Migração controlada para produção

- [ ] Confirmar domínio, branch, bindings e variáveis de produção.
- [ ] Criar ativação administrativa da V2.
- [ ] Liberar para parcela controlada das sessões.
- [ ] Monitorar erros, pedidos, projeções e produção.
- [ ] Tornar V2 padrão mantendo rollback imediato.
- [ ] Remover compatibilidade antiga somente após estabilidade comprovada.

Critério de conclusão: V2 como padrão, operação estável e rollback documentado e testado.

## Definição de pronto

O Site V2 estará concluído somente quando:

- todos os itens obrigatórios acima estiverem marcados como concluídos;
- não houver etapa principal em andamento ou bloqueada;
- catálogo, carrinho, checkout, pedido, WhatsApp e produção estiverem validados de ponta a ponta;
- produção diferenciar corretamente produtos, variantes e tamanhos;
- servidor for autoridade de valores e regras comerciais;
- frontend não depender de monkey patches críticos ou reescrita de HTML por regex;
- testes funcionais, visuais, móveis, acessíveis e de segurança estiverem aprovados;
- migração controlada e rollback tiverem sido comprovados.

## Registro das próximas atualizações

Cada PR posterior deve alterar este arquivo com:

- etapa afetada;
- estado anterior e novo estado;
- evidência de teste;
- pendência restante;
- próximo item objetivo.
