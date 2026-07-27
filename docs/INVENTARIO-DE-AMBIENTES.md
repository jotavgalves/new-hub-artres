# Inventário de Ambientes

## Regra de segurança

Este documento registra apenas nomes, finalidades e vínculos. Valores de tokens, chaves, senhas e segredos não devem ser incluídos no repositório.

## Produção

- Nome oficial: **Atual Versão de Segurança**
- Branch de origem atual: `main`
- Commit preservado: `a51b6bc530473a09e5c561b7a54643535f82f174`
- Branch de recuperação: `safety/atual-versao-de-seguranca`
- Recebe pedidos reais: sim
- Pode receber refatoração estrutural: não
- Pode receber produto novo: não

### Dados a confirmar no painel do Cloudflare

- nome do projeto Pages;
- domínio principal;
- domínios personalizados;
- branch configurada para produção;
- comando de build;
- diretório de saída;
- versão de compatibilidade;
- bindings de KV;
- variáveis públicas;
- segredos;
- integrações de deployment;
- política de rollback;
- retenção de logs.

## Staging V2

- Nome oficial: **Staging Site V2**
- Branch inicial: `agent/site-v2-defensive-foundation`
- Recebe pedidos reais: não
- Pode utilizar catálogo real: somente leitura e com identificação de ambiente
- Pedidos devem possuir prefixo ou namespace de teste
- WhatsApp deve operar em modo seguro de teste
- Deve possuir aviso visual de ambiente
- Deve impedir indexação por mecanismos de busca

### Requisitos antes da ativação

- URL separada da produção;
- variáveis e bindings revisados;
- namespace ou tabela de teste para pedidos;
- nenhuma chave secreta copiada para documentação;
- logs habilitados;
- identificação de ambiente em toda gravação;
- procedimento de limpeza dos dados de teste.

## Desenvolvimento local

- Recebe pedidos reais: não
- Pode utilizar fixtures e respostas gravadas
- Deve funcionar sem escrever no banco de produção
- Deve possuir configuração explícita de ambiente

## Serviços externos a inventariar

### Cloudflare Pages e Functions

Registrar:

- nome de cada binding;
- tipo do binding;
- ambiente em que existe;
- arquivos que o utilizam;
- comportamento esperado em falha.

### Supabase

Registrar sem valores secretos:

- URL do projeto por ambiente;
- nomes das tabelas utilizadas;
- finalidade de cada tabela;
- políticas de acesso;
- colunas consumidas pelo site;
- colunas consumidas pela administração;
- colunas consumidas pela produção;
- estratégia de backup;
- estratégia de migração.

### KV

Registrar:

- nome lógico de cada binding;
- padrão das chaves;
- finalidade;
- prazo de retenção;
- estratégia de compatibilidade com pedidos antigos;
- comportamento quando a gravação falhar.

### Google Drive

Registrar:

- `root_drive_id` por catálogo ou produto;
- finalidade de cada raiz;
- padrão de pastas;
- padrão de nomes de arquivos;
- relação entre Drive e produto;
- forma de atualização do índice;
- comportamento para arquivos removidos ou renomeados.

### WhatsApp

Registrar:

- origem do número público;
- regra de escolha da vendedora;
- formato da mensagem;
- comportamento quando não houver vendedora;
- modo de teste no staging.

## Tabela de bindings

Preencher sem registrar valores secretos.

| Nome do binding | Tipo | Produção | Staging | Consumidores | Confirmado |
|---|---|---:|---:|---|---|
| A confirmar | Supabase/KV/variável | Sim/Não | Sim/Não | Arquivos | Não |

## Tabela de persistência

| Dado | Origem | Destino | Chave de identidade | Compatibilidade antiga | Confirmado |
|---|---|---|---|---|---|
| Pedido | Checkout | Supabase | A confirmar | Sim | Não |
| Pedido | Checkout | KV | A confirmar | Sim | Não |
| Catálogo | Drive/índice | Supabase | A confirmar | Não aplicável | Parcial |
| Regras | Administração | Configuração/índice | A confirmar | Sim | Parcial |

## Critério para considerar o staging seguro

O Staging Site V2 somente será considerado seguro quando:

- não puder gravar pedidos reais;
- não puder enviar mensagens comerciais por engano;
- não compartilhar namespace de pedido sem marcação de teste;
- possuir logs distinguíveis da produção;
- possuir URL e aviso visual próprios;
- possuir procedimento de limpeza;
- não expuser segredos ao navegador ou ao repositório.
