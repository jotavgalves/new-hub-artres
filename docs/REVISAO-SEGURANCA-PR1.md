# Revisão de segurança do PR 1

## Escopo

A revisão foi realizada sobre o diff entre `main` e `agent/site-v2-defensive-foundation`, com atenção especial a:

- autenticação das rotas internas;
- leitura e validação de requisições;
- idempotência;
- persistência transacional no Durable Object;
- exposição de dados nas respostas HTTP;
- projeção futura para Supabase;
- workflows de CI e deploy;
- isolamento em relação à Atual Versão de Segurança.

## Correções aplicadas

### Chave de idempotência

A chave recebida no cabeçalho não é mais enviada ou armazenada em formato bruto no ledger.

Antes de chegar à persistência, ela é normalizada e transformada em uma chave derivada por SHA-256 no formato:

```text
idempotency:v2:<64 caracteres hexadecimais>
```

O port do ledger rejeita qualquer chave que não esteja nesse formato derivado.

### Rota técnica de submissão

A rota interna de baixo nível:

```text
POST /internal/v2/ledger/submit
```

permanece no código apenas para diagnóstico técnico, mas está desabilitada por padrão por uma segunda trava independente:

```text
STAGING_LOW_LEVEL_LEDGER_ENABLED=false
```

Mesmo que a escrita sintética seja habilitada futuramente, essa rota continuará indisponível até uma alteração explícita de configuração.

### Limite do corpo da requisição

O Worker não utiliza mais `request.text()` para carregar o corpo inteiro antes de validar o tamanho.

A leitura agora ocorre por streaming e é interrompida quando ultrapassa 128 KiB.

### Respostas e logs

- identificadores de requisição são sanitizados;
- erros inesperados retornam apenas `STAGING_INTERNAL_ERROR`;
- mensagens arbitrárias de exceções não são devolvidas ao cliente;
- respostas possuem `Cache-Control: no-store`, CSP restritiva, CORP, `nosniff` e política de referência;
- logs não incluem corpo da requisição, token ou dados do cliente.

### Dados pessoais

As rotas HTTP de inspeção de pedido e outbox não retornam nome, telefone ou WhatsApp do cliente.

A resposta apresenta:

```json
{"customer":{"redacted":true}}
```

O pedido canônico completo continua armazenado internamente no Durable Object e na outbox, pois é necessário para a operação e futura projeção. A remoção aplica-se apenas à visualização HTTP de diagnóstico.

### Projeção Supabase

O adapter passivo limita respostas remotas a 64 KiB, inclusive durante leitura por streaming. Respostas maiores são rejeitadas antes da desserialização.

A chave secreta continua exclusivamente no servidor e é removida de mensagens de erro sanitizadas.

### GitHub Actions

As actions críticas foram fixadas por SHA imutável:

- `actions/checkout`;
- `actions/setup-node`.

O checkout usa:

```yaml
persist-credentials: false
```

Os workflows mantêm apenas permissão `contents: read`.

## Validação executada

Os testes cobrem:

- rejeição de chave de idempotência bruta;
- persistência apenas da chave derivada;
- replay e conflito;
- bloqueio da rota técnica;
- limite por streaming;
- redaction de dados pessoais;
- limite de resposta do Supabase;
- pinagem das actions;
- ausência de credencial Git persistida;
- smoke test local do Worker e Durable Object.

Run de referência após todas as correções:

```text
Site V2 Baseline
Run 30282072598
Conclusão: success
```

## Riscos residuais e condições

1. O endpoint `workers.dev` será acessível pela internet quando o staging for publicado, embora todas as rotas internas exijam token de alta entropia.
2. O environment `site-v2-staging` foi configurado externamente pelo proprietário, mas esta revisão não valida os valores armazenados nos secrets.
3. Required reviewers e restrição de branch do environment são proteções externas opcionais que ainda podem ser endurecidas.
4. O workflow manual de deploy só ficará normalmente disponível quando estiver presente na branch padrão.
5. A rota de baixo nível não deve ser habilitada para tráfego comercial ou dados reais.
6. O Supabase correto ainda não foi identificado. Nenhuma migration ou conexão foi ativada.
7. A escrita remota permanece desabilitada por configuração.

## Estado ao concluir a revisão

- PR aberto e em rascunho;
- `main` inalterada;
- Atual Versão de Segurança inalterada;
- nenhum merge realizado;
- nenhum Worker V2 publicado;
- nenhum Durable Object remoto criado;
- nenhuma alteração no KV ou Supabase;
- nenhum pedido real processado.
