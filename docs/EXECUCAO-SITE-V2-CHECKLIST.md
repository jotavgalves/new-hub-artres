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

- [-] Criar fundação da rota pública de checkout somente no staging.
- [ ] Manter a rota desativada por flag até os testes finais desta etapa.
- [ ] Resolver cada item contra a versão aceita do catálogo.
- [ ] Validar produto, variante, tamanho e vínculo da arte no servidor.
- [ ] Recalcular quantidade, preço, desconto e total no servidor.
- [ ] Preservar cliente, vendedora, medidas, observações e personalizações.
- [ ] Aplicar idempotência contra duplo clique e repetição de requisição.
- [ ] Rejeitar arte inexistente, produto incorreto, variante inválida e quantidade inválida.
- [ ] Adicionar proteção de origem, limite de requisições e resposta sanitizada.
- [ ] Executar smoke remoto sem pedido real.

Critério de conclusão: checkout do staging cria e reproduz pedido V2 usando arte e produto reais do catálogo aceito, com valores calculados pelo servidor e sem alterar produção.

### 6. Carrinho e frontend V2 no staging

- [ ] Criar identidade inequívoca para linhas do carrinho.
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
