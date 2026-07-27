# Segurança e idempotência de pedidos V2

## Finalidade

Definir as proteções obrigatórias antes de substituir o endpoint público atual de pedidos.

Nenhuma rota é criada ou alterada nesta etapa.

## Problemas do endpoint atual

O `POST /api/orders` atual:

- não exige autenticação;
- não exige chave de idempotência;
- não valida origem;
- não aplica rate limit no código;
- não possui CAPTCHA ou desafio equivalente;
- aceita totais enviados pelo navegador;
- aceita produto e preço sem confirmação no catálogo;
- pode gravar no KV e no Supabase separadamente;
- pode retornar o pedido integral na resposta;
- pode criar pedidos repetidos quando o cliente toca novamente ou a rede repete a requisição.

## Objetivos da V2

1. uma ação de finalização deve criar no máximo um pedido;
2. repetição idêntica deve retornar o mesmo resultado;
3. reutilização da mesma chave com conteúdo diferente deve falhar;
4. requisição de origem não autorizada deve falhar;
5. corpo excessivo deve falhar antes da persistência;
6. formato incorreto deve falhar;
7. preço e total devem ser recalculados no servidor;
8. dados sensíveis não devem aparecer em logs;
9. rate limit deve existir por origem técnica e por intenção de pedido;
10. staging e produção devem possuir armazenamentos separados.

# Idempotência

## Cabeçalho

```text
Idempotency-Key: UUID ou token aleatório de 16 a 128 caracteres
```

O navegador criará uma chave ao iniciar a finalização.

A mesma chave será reutilizada quando:

- a requisição expirar;
- a conexão cair;
- o navegador repetir o envio;
- o cliente tocar novamente enquanto o primeiro envio estiver em andamento.

Uma nova tentativa deliberada deverá usar uma nova chave.

## Fingerprint

O servidor calculará um SHA-256 sobre a intenção canônica do pedido.

Campos previstos:

```text
seller.id
customer.whatsapp normalizado
itemId
quantity
productKey
variantKey
sizeKey
catalogVersion
configVersion
```

Os itens serão ordenados antes do cálculo.

Não entram no fingerprint:

```text
nome do cliente
URL de imagem
user agent
horário local do navegador
preço enviado pelo cliente
total enviado pelo cliente
```

## Estados

```text
processing
completed
failed-retryable
```

## Decisões

### Nova chave

```text
ACCEPT_NEW
```

O servidor reserva a chave antes de criar o pedido.

### Mesma chave e mesmo fingerprint, ainda processando

```text
IN_PROGRESS
```

Resposta prevista:

```text
409 ou 202, conforme contrato final
Retry-After informado
```

### Mesma chave e mesmo fingerprint, concluído

```text
REPLAY_COMPLETED
```

Retorna o mesmo número do pedido sem criar outro.

### Mesma chave e fingerprint diferente

```text
REJECT_CONFLICT
```

Resposta:

```text
409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST
```

### Reserva expirada

```text
RETRY_EXPIRED
```

A execução pode ser retomada com controle de versão do registro.

## Armazenamento recomendado

A idempotência precisa de operação atômica.

Ordem de preferência:

1. Durable Object dedicado;
2. D1 ou Postgres com chave única e transação;
3. KV somente como cache de replay, não como autoridade de reserva.

O KV não é adequado como única autoridade para reservar uma chave porque leitura e escrita não formam uma transação atômica global.

# Proteção da requisição

## Método

```text
POST
```

Outros métodos devem receber `405 Method Not Allowed`.

## Content-Type

```text
application/json
```

Corpos de formulário ou texto serão rejeitados.

## Tamanho

Limite inicial previsto:

```text
128 KiB
```

O limite será aplicado por `Content-Length` quando disponível e novamente após leitura limitada do corpo.

## Origem

Produção aceitará somente origens configuradas explicitamente.

Exemplo conceitual:

```text
https://dominio-publico.example
https://preview-aprovado.example
```

Não será utilizado `*`.

Requisições sem `Origin` poderão ser aceitas apenas quando o contexto for comprovadamente same-origin ou cliente confiável previsto pelo contrato.

## Fetch Metadata

Quando disponíveis, serão avaliados:

```text
Sec-Fetch-Site
Sec-Fetch-Mode
```

Valores `cross-site` serão rejeitados no endpoint público do navegador.

## Rate limit

Chaves de rate limit previstas:

```text
IP anonimizado
Idempotency-Key
telefone normalizado com hash
fingerprint da intenção
```

Os valores originais não serão registrados.

Limites serão definidos no staging com carga real. O módulo passivo apenas criará chaves e decisões, sem impor números arbitrários em produção.

## Resposta

A resposta pública de sucesso não deve retornar o pedido integral.

Formato mínimo:

```json
{
  "ok": true,
  "orderNumber": "PED2600001A",
  "replayed": false
}
```

## Logs

Permitido:

```text
requestId
resultado da validação
hash reduzido da chave
status HTTP
latência
ambiente
```

Proibido:

```text
token
senha
service role key
telefone completo
nome completo
corpo integral
URL de WhatsApp com mensagem
```

## Staging

O endpoint V2 só poderá ser ativado quando:

- origem de staging estiver cadastrada;
- armazenamento atômico de idempotência estiver disponível;
- banco de pedidos de staging estiver isolado;
- rate limit estiver configurado;
- respostas não contiverem dados de clientes;
- repetição concorrente tiver teste automatizado;
- rollback estiver validado.

## Casos de teste obrigatórios

1. primeira requisição válida;
2. repetição sequencial idêntica;
3. repetição concorrente idêntica;
4. mesma chave com corpo diferente;
5. chave inválida;
6. origem não autorizada;
7. requisição `cross-site`;
8. corpo acima do limite;
9. Content-Type incorreto;
10. produto ou arte inexistente;
11. preço adulterado;
12. mínimo inválido;
13. falha depois da reserva e antes da gravação;
14. replay depois da gravação;
15. expiração controlada da reserva.
