# Atual Versão de Segurança

## Finalidade

A **Atual Versão de Segurança** é a fotografia preservada do site que estava em produção no início da reconstrução da versão 2.

Ela existe para garantir recuperação imediata caso uma alteração futura provoque falha no catálogo, carrinho, checkout, pedidos, integração com WhatsApp, painel administrativo ou produção.

## Referência imutável

- Repositório: `jotavgalves/new-hub-artres`
- Branch de produção no momento da preservação: `main`
- Commit preservado: `a51b6bc530473a09e5c561b7a54643535f82f174`
- Mensagem do commit: `Corrige payload async no teste da API de producao`
- Branch de preservação: `safety/atual-versao-de-seguranca`
- Branch inicial da reconstrução: `agent/site-v2-defensive-foundation`

A branch `safety/atual-versao-de-seguranca` não deve receber commits de desenvolvimento, refatoração ou produto novo.

## Regras de proteção

1. Nenhuma reconstrução será feita diretamente na `main`.
2. Nenhum arquivo da branch de segurança será removido ou atualizado.
3. Correções emergenciais da produção devem ser pequenas, isoladas e documentadas.
4. Toda correção emergencial feita na produção deve ser replicada na versão 2.
5. O produto novo não será adicionado à Atual Versão de Segurança.
6. Mudanças estruturais exigem validação em staging antes de qualquer publicação.
7. O site atual permanecerá disponível como rota de rollback até a conclusão da migração.

## O que precisa ser preservado

- Navegação por temas e subtemas.
- Busca de artes.
- Favoritos.
- Carrinho e quantidades.
- Personalizações e medidas.
- Seleção de vendedora.
- Geração da mensagem para WhatsApp.
- Salvamento e recuperação de pedidos.
- Integração com Supabase e KV.
- Consulta e envio para produção.
- Aparência aprovada em desktop e dispositivos móveis.

## Problemas conhecidos que não devem ser confundidos com comportamento aprovado

A Atual Versão de Segurança possui falhas conhecidas. Sua preservação não significa que essas falhas sejam regras do negócio.

Entre os pontos já identificados estão:

- produtos e artes tratados como bolinhas em partes do backend;
- fallback silencioso para produto diferente do solicitado;
- preços duplicados e divergentes;
- regras de quantidade aplicadas incorretamente no carrinho;
- itens agrupados somente pelo código visual;
- perda de detalhes e medidas em partes do fluxo de pedido;
- scripts de correção que substituem funções globais;
- HTML alterado por Function durante a resposta;
- CSS duplicado e excesso de `!important`;
- catálogo demonstrativo exibido em situações de falha;
- ausência de validação integral do pedido no servidor.

Esses comportamentos deverão ser corrigidos na versão 2, não reproduzidos por compatibilidade.

## Procedimento de rollback

Em uma falha grave após futura publicação:

1. Suspender novas alterações.
2. Confirmar se o problema afeta catálogo, preço, carrinho, pedido, WhatsApp ou produção.
3. Restaurar o deployment correspondente ao commit preservado.
4. Caso seja necessário restaurar por Git, apontar a branch de publicação para `safety/atual-versao-de-seguranca`.
5. Validar um pedido completo de teste.
6. Registrar a falha encontrada antes de retomar a migração.

## Condições que exigem rollback imediato

- catálogo vazio ou incompleto;
- produto identificado incorretamente;
- preço ou total incorreto;
- quantidade mínima ou incremento incorreto;
- pedido sem item, variante ou medida;
- colisão entre artes com o mesmo código;
- falha no WhatsApp;
- falha no painel administrativo;
- falha no payload de produção;
- regressão grave no celular;
- aumento anormal de erros nas APIs.

## Verificação mínima após rollback

- abrir a página inicial;
- abrir um tema;
- abrir um produto;
- buscar uma arte por código;
- adicionar ao carrinho;
- alterar quantidade;
- preencher personalização;
- selecionar vendedora;
- gerar a mensagem do WhatsApp;
- salvar um pedido de teste;
- recuperar o pedido;
- gerar o payload de produção.

## Observação sobre configurações externas

Segredos, tokens e chaves não devem ser registrados neste arquivo.

O inventário de bindings e variáveis deve conter apenas nomes, finalidade, ambiente e responsável. Valores secretos permanecem exclusivamente no ambiente seguro do Cloudflare e dos serviços relacionados.
