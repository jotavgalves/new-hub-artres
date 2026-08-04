# Catálogo privado autenticado do Google Drive

## Objetivo

Ler recursivamente os Drives privados de Bolinhas e Painel 150, publicar uma versão atômica no catálogo aceito e servir as miniaturas sem tornar as pastas públicas.

## Raízes autorizadas

| Produto | Pasta raiz |
|---|---|
| Bolinhas 50x50 | `193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae` |
| Painel 150 cm | `18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-` |

Nenhuma terceira raiz será aceita pelo checkout ou pelo proxy de imagens.

## 1. Criar a identidade de leitura

No Google Cloud:

1. Selecione ou crie um projeto exclusivo para a integração do catálogo.
2. Ative a Google Drive API.
3. Crie uma conta de serviço, por exemplo `catalog-reader`.
4. Não atribua papéis administrativos ao projeto. O acesso aos arquivos será concedido diretamente nas pastas do Drive.
5. Crie uma chave JSON para essa conta de serviço e salve o arquivo em local seguro.
6. Copie apenas o e-mail `client_email` da conta para compartilhar as pastas.

Nunca envie o JSON por chat, e-mail ou issue. Nunca faça commit do arquivo.

## 2. Compartilhar as duas pastas

Em cada pasta raiz do Google Drive:

1. Abra **Compartilhar**.
2. Adicione o `client_email` da conta de serviço.
3. Defina a permissão como **Leitor**.
4. Mantenha o acesso geral privado.

As permissões das subpastas e arquivos precisam ser herdadas ou concedidas à mesma identidade.

## 3. Cadastrar o segredo no GitHub

No repositório, ambiente `site-v2-staging`, crie o segredo:

```text
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
```

O valor deve ser o conteúdo integral do arquivo JSON, sem modificações.

O ambiente já usa:

```text
SUPABASE_V2_STAGING_SERVICE_ROLE_KEY
```

A conta de serviço e o service role nunca devem aparecer em logs ou artefatos públicos.

## 4. Executar a primeira sincronização

Execute manualmente o workflow:

```text
Sincronizar Catálogo Privado V2
```

Na primeira execução válida, o processo deve:

1. autenticar com o escopo `drive.readonly`;
2. percorrer as duas raízes recursivamente;
3. resolver atalhos de arquivos e pastas;
4. excluir temas internos e temas sem artes válidas;
5. gerar o relatório detalhado privado;
6. publicar uma nova versão por `begin → batch → accept`;
7. verificar contagens e fingerprint após a aceitação.

A versão anterior continua ativa se qualquer etapa falhar.

## 5. Conferir o relatório

O artefato privado do workflow contém:

- temas encontrados e publicados;
- pastas publicadas;
- artes publicadas;
- atalhos resolvidos;
- formatos não suportados;
- arquivos com padrão de código não convencional;
- temas removidos por estarem vazios;
- erros de acesso.

A issue recebe somente contagens e códigos sanitizados. IDs de arquivos, URLs privadas, e-mail da conta de serviço, tokens e chaves não são publicados.

## 6. Configurar o Cloudflare Pages

Somente depois de uma sincronização aceita, cadastrar no projeto de produção:

### Segredos

```text
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
SUPABASE_V2_SERVICE_ROLE_KEY
```

### Variáveis

```text
SUPABASE_V2_URL=https://kueklnkznwpbobqwugns.supabase.co
USE_AUTHENTICATED_CATALOG_V2=true
```

O `SUPABASE_V2_SERVICE_ROLE_KEY` deve pertencer ao projeto `kueklnkznwpbobqwugns`.

## 7. Ordem de ativação

A ordem obrigatória é:

1. criar a conta de serviço;
2. compartilhar as duas raízes como leitor;
3. cadastrar o JSON no GitHub;
4. executar e validar a sincronização;
5. cadastrar os segredos no Cloudflare;
6. ativar `USE_AUTHENTICATED_CATALOG_V2=true`;
7. publicar o Pages;
8. validar temas, artes, imagens e checkout nos dois produtos.

Não ativar a flag pública antes de existir uma versão autenticada aceita.

## 8. Formatos

Publicáveis:

- JPG e JPEG;
- PNG;
- WEBP;
- TIF e TIFF;
- PDF quando o Google Drive fornecer miniatura.

Relatados, mas não publicados diretamente:

- PSD e PSB;
- AI;
- EPS;
- CDR;
- outros formatos sem imagem ou miniatura compatível.

## 9. Segurança da imagem

A rota `/api/catalog-image` não é um proxy genérico. Ela:

1. recebe o ID público do item do catálogo;
2. consulta a versão aceita no Supabase;
3. confirma o produto e a ancestralidade dentro de uma das duas raízes;
4. resolve o arquivo-fonte, inclusive quando o item é um atalho;
5. usa a conta de serviço somente no servidor;
6. limita o tamanho da resposta e aplica cache de imagem.

Arquivos que não estejam no catálogo aceito não podem ser acessados pela rota.

## 10. Revogação

Em caso de suspeita de exposição:

1. revogue a chave da conta de serviço no Google Cloud;
2. gere uma nova chave;
3. substitua os segredos no GitHub e Cloudflare;
4. execute nova sincronização;
5. valide a produção antes de descartar a versão anterior.
