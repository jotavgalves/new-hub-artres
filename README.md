# Hub de Artes Armazém — Documentação Completa do Sistema

Este README explica como o sistema funciona, quais regras foram definidas, como o Google Drive deve ser lido, como os produtos são normalizados, como funcionam carrinho, preços, sacolinhas, medidas personalizadas, links por vendedora e parâmetros de URL.

Use este arquivo como referência para continuar o projeto em outro chat.

---

## 1. Objetivo do sistema

O sistema é um **site/cardápio digital de artes da Armazém da Estampa**, hospedado em **Cloudflare Pages**, que puxa as artes diretamente de uma pasta pública do **Google Drive**.

O cliente navega assim:

```txt
Temas
→ Subtema, se existir
→ Produtos
→ Artes
→ Carrinho / orçamento
→ WhatsApp da vendedora
```

A ideia principal é permitir que o cliente escolha artes por tema e produto, monte uma seleção, veja o orçamento com desconto e envie tudo organizado pelo WhatsApp.

---

## 2. Estrutura técnica

O projeto roda em Cloudflare Pages com esta estrutura:

```txt
index.html
functions/api/drive.js
_headers
README.md
```

### `index.html`

Contém o front-end completo:

- layout;
- navegação;
- busca;
- carrinho;
- regras de preço;
- regras de quantidade;
- personalização de medidas;
- favoritos;
- links por vendedora;
- mensagem final do WhatsApp.

### `functions/api/drive.js`

É a Cloudflare Pages Function que lê o Google Drive usando a variável:

```txt
GOOGLE_API_KEY
```

A Function conversa com a Google Drive API e lista:

- temas;
- subpastas intermediárias;
- produtos;
- imagens/artes.

---

## 3. Pasta principal do Google Drive

A pasta principal usada no projeto é:

```txt
11cU5yMWafopC0JfMHotRxThpkgbQl-RW
```

Link original:

```txt
https://drive.google.com/drive/folders/11cU5yMWafopC0JfMHotRxThpkgbQl-RW
```

A pasta precisa estar pública:

```txt
Qualquer pessoa com o link pode visualizar
```

E a Google Drive API precisa estar ativada no Google Cloud.

---

## 4. Variável obrigatória no Cloudflare

No Cloudflare Pages, configure:

```txt
GOOGLE_API_KEY = sua chave da Google Drive API
```

Local:

```txt
Cloudflare Pages
→ Settings
→ Variables and Secrets
→ Production
```

Depois de adicionar ou mudar a variável, faça novo deploy.

---

## 5. API interna `/api/drive`

A Function aceita alguns modos.

### 5.1. Listar temas

```txt
/api/drive?mode=themes
```

Retorna as pastas principais dentro da pasta raiz.

### 5.2. Listar produtos ou subpastas dentro de uma pasta

```txt
/api/drive?mode=products&folderId=ID_DA_PASTA
```

Esse modo retorna tanto:

- subpastas intermediárias;
- produtos reais.

A Function decide se uma pasta é produto ou apenas uma pasta intermediária pela normalização do nome.

### 5.3. Listar artes de um produto

```txt
/api/drive?mode=items&folderId=ID_DO_PRODUTO
```

Retorna imagens/artes daquela pasta.

### 5.4. Buscar por código

```txt
/api/drive?mode=search&code=195
```

Busca artes pelo código no nome do arquivo.

---

## 6. Pastas intermediárias

O Drive não é sempre simples. Existem temas com subpastas antes de chegar nos produtos.

Exemplos reais:

```txt
ANIME
→ BLUE LOCK
→ REDONDO 50X50

HEROIS
→ DC
→ BATMAN
→ KIT REDONDO + CILINDROS

PRINCESAS
→ ARIEL
→ REDONDO 1,50
```

Essas pastas intermediárias **devem aparecer no site como etapas navegáveis**.

Elas **não são produtos**.

Exemplos de pastas intermediárias:

```txt
ANIME / BLUE LOCK
ANIME / DEMON SLAYER
HEROIS / DC
HEROIS / DC / BATMAN
HEROIS / MARVEL / HOMEM ARANHA
IDADES / 15 ANOS
PRINCESAS / ARIEL
PROFISSÕES / BOMBEIRO
```

---

## 7. Ordem das pílulas de navegação

A ordem das pílulas deve ser **invariável**, sempre da esquerda para a direita:

```txt
Temas > Tema atual > Subtema, se tiver > Produtos > Nome do produto atual
```

Exemplo sem subtema:

```txt
Temas > Fazendinha > Produtos > Painel 150x150
```

Exemplo com subtema:

```txt
Temas > Princesas > Ariel > Produtos > Painel 150x150
```

Exemplo de sacolinha:

```txt
Temas > Princesas > Ariel > Produtos > Sacolinha P
```

Regras visuais:

- Não usar setas dentro das pílulas.
- Não usar texto “Você está em”.
- A etapa atual deve ficar em **pílula azul pastel**.
- “Temas” não deve ficar rosa.
- No celular, as pílulas devem ficar em uma linha com scroll horizontal.

---

## 8. Normalização de produtos

A pasta real do Drive pode ter erros, variações e nomes diferentes. O sistema normaliza para produtos oficiais.

A lista oficial de produtos é:

```txt
Bolinhas 50x50
Painel 150x150
Cenário
Lateral
Sacolinha de Festa
Cilindros
Kit Painel + Cilindros
Romano
Romano + Lateral
Kit + Romano
```

### 8.1. Bolinhas 50x50

Entram como `50x50`:

```txt
PAINEL REDONDO 0,50
REDONDO 0,50
REDONDO 50X50
50X50
Painel 50
Bolinhas 50x50
```

### 8.2. Painel 150x150

Entram como `painel-150`:

```txt
PAINEL REDONDO 1,50
REDONDO 1,50
REDONDO 150X150
REDONDOS 1,50
REDONDO
PAINEL REDONDO
150
1,5
1.5
1,50
1.50
150x150
```

Importante:

```txt
Painel Redondo = Painel 150x150
```

### 8.3. Cenário

Entra como `cenario`:

```txt
CENÁRIO
CENARIO
Paisagem
Horizontal
```

### 8.4. Lateral

Entra como `lateral`:

```txt
LATERAL
RETANGULAR
REATNGULAR
Vertical
Retrato
Kit + Lateral
```

Importante:

```txt
Retangular = Lateral
```

### 8.5. Sacolinha de Festa

Entra como `sacolinha`:

```txt
SACOLINHA
SACOLINHAS
SACOCLINHAS
SACOLNHAS
Sacola
Sacolas
```

### 8.6. Cilindros

Entra como `cilindros`:

```txt
CILINDROS
CICLINDROS
CILNIDROS
CILINDOS
CILIDROS
```

### 8.7. Kit Painel + Cilindros

Entra como `kit-painel-cilindros`:

```txt
KIT REDONDO + CILINDROS
KIT REDONDO+CILINDROS
KIT REDONDO + CILINDRO
KIT REDONDO + CILIDROS
KIT REDONDO + CILINDOS
KIT REDONDO + CILNIDROS
REDONDO+CILINDROS
CILINDROS + LATERAL
KIT CILINDROS + LATERAL
```

### 8.8. Romano

Entra como `romano`:

```txt
ARCO ROMANO
ROMANO
ROMANOS
RENDONDO + ROMANO
```

### 8.9. Romano + Lateral

Entra como `romano-lateral`:

```txt
ARCO ROMANO + LATERAL
ROMANO + LATERAL
```

### 8.10. Kit + Romano

Entra como `kit-romano`:

```txt
KIT + ROMANO
KIT+ROMANO
KIR + ROMANO
CILINDROS + ROMANO
CILINDRO + ROMANO
KIT CILINDROS + ROMANO
```

---

## 9. Preços oficiais

### 9.1. Bolinhas 50x50

Preço visual no card da arte:

```txt
R$ 9,90 cada
```

Regra do carrinho:

```txt
Mínimo 6 bolinhas.
6 bolinhas custam R$ 58,90.
Depois de 6, só pode adicionar em números pares: 8, 10, 12...
Cada bolinha extra custa R$ 9,90.
```

### 9.2. Painel 150x150

```txt
R$ 59,90
```

### 9.3. Lateral

```txt
R$ 59,90
```

### 9.4. Cenário

```txt
R$ 59,90
```

### 9.5. Cilindros

```txt
R$ 99,00
```

### 9.6. Romano

```txt
R$ 78,00
```

### 9.7. Romano + Lateral

Foi usado como composição:

```txt
R$ 137,90
```

### 9.8. Kit Painel + Cilindros

```txt
R$ 158,90
```

### 9.9. Kit + Romano

```txt
R$ 210,00
```

### 9.10. Sacolinhas

Sacolinhas têm tamanhos e preços próprios:

```txt
P — 15x20 cm — R$ 6,00 cada
M — 20x25 cm — R$ 8,00 cada
G — 25x30 cm — R$ 10,00 cada
```

Regra:

```txt
Mínimo 10 unidades.
Depois do mínimo, a quantidade deve ir de 5 em 5:
10, 15, 20, 25...
```

---

## 10. Desconto

O cliente ganha:

```txt
10% OFF por escolher por aqui
```

O carrinho aplica o desconto automaticamente no total.

O site pode mostrar:

```txt
Você economiza R$ X
Total com desconto: R$ Y
```

Mas a mensagem de WhatsApp **não deve detalhar valores, subtotais nem desconto por item**. Ela deve enviar apenas:

- artes;
- quantidades;
- medidas, se houver;
- observação de personalização, se houver.

---

## 11. Sacolinhas

Quando o cliente clica no produto **Sacolinha**, antes de mostrar as artes deve aparecer uma etapa de escolha de tamanho:

```txt
P — 15x20 cm
M — 20x25 cm
G — 25x30 cm
```

Nessa etapa:

- os cards devem seguir o estilo dos cards de produto;
- os 3 tamanhos devem aparecer na mesma linha no desktop;
- não precisa mostrar preço nessa etapa;
- os botões/cards devem ter mesmo tamanho, alinhamento e tipografia.

Depois que o cliente escolhe P, M ou G, ele entra nas artes de sacolinha.

Nas artes, o card deve mostrar o preço correto:

```txt
Sacolinha P → R$ 6,00 cada
Sacolinha M → R$ 8,00 cada
Sacolinha G → R$ 10,00 cada
```

No carrinho:

- mostrar o tamanho escolhido;
- mostrar botão **Trocar tamanho**;
- as opções P/M/G só aparecem se clicar em **Trocar tamanho**;
- remover mensagem positiva “Quantidade certinha para sacolinhas”.

Ao voltar das artes de sacolinha, deve voltar para a etapa de tamanhos, não direto para produtos.

---

## 12. Personalização de tamanho

A maioria das artes já tem medida padrão.

Portanto:

```txt
O sistema NÃO deve abrir personalização automaticamente.
```

A personalização é opcional.

No carrinho, cada item que pode ser personalizado deve ter botão:

```txt
Personalizar tamanho
```

Não usar ícone sozinho.

Quando o cliente clica em **Personalizar tamanho**, aí sim abre o formulário daquele produto.

Se o cliente cancelar ou não salvar, não deve contar como personalização.

Se a personalização for salva, aparece embaixo do item um resumo pequeno, do tamanho visual parecido com:

```txt
Toque no item para encontrar essa arte.
```

Se passar de duas linhas, deve cortar com `...`.

Para editar/ver completo novamente, o cliente clica em **Personalizar tamanho**.

---

## 13. Aviso de personalização

O aviso de personalização **não deve aparecer dentro de cada item**.

Ele só aparece antes do envio, no carrinho, se houver pelo menos um item com medida personalizada salva.

Texto/ideia:

```txt
Medidas personalizadas

A personalização de medidas é solicitada hoje, mas a produção da arte personalizada acontece a partir do próximo dia útil.

[ ] Li e estou ciente sobre o prazo da personalização.
```

O cliente precisa confirmar que leu para conseguir enviar.

A checkbox deve ser personalizada, alinhada à identidade do site, e não o checkbox padrão fino do navegador.

---

## 14. Regras de personalização por produto

### 14.1. Painéis redondos

Produtos:

```txt
Bolinhas 50x50
Painel 150x150
```

Personalização pede:

```txt
Diâmetro em cm
```

Explicação:

```txt
Diâmetro é a medida de uma ponta à outra do círculo.
```

Regra para painel redondo personalizado:

```txt
Mínimo 90 cm.
Sempre de 10 em 10 cm.
Não pode 121, 135, 157 etc.
Pode 90, 100, 110, 120...
```

### 14.2. Lateral / Cenário

Personalização pede:

```txt
Largura
Altura
```

O cliente pode escolher unidade:

```txt
cm
metro
```

Explicação:

```txt
1 metro = 100 cm
1,5 metro = 150 cm
2 metros = 200 cm
```

Não usar botões predefinidos de 100, 150, 200 etc.

### 14.3. Romano

Personalização pede:

```txt
Largura
Altura
```

### 14.4. Cilindros

Personalização pede para cada cilindro P, M e G:

```txt
Largura
Altura
Diâmetro da tampa
```

### 14.5. Kit Painel + Cilindros

Personalização pede:

```txt
Cilindro P:
- Largura
- Altura
- Diâmetro da tampa

Cilindro M:
- Largura
- Altura
- Diâmetro da tampa

Cilindro G:
- Largura
- Altura
- Diâmetro da tampa

Painel redondo:
- Diâmetro
```

### 14.6. Kit + Romano

Personalização pede:

```txt
Cilindro P:
- Largura
- Altura
- Diâmetro da tampa

Cilindro M:
- Largura
- Altura
- Diâmetro da tampa

Cilindro G:
- Largura
- Altura
- Diâmetro da tampa

Romano:
- Largura
- Altura
```

### 14.7. Romano + Lateral

Personalização pede:

```txt
Romano:
- Largura
- Altura

Lateral:
- Largura
- Altura
```

### 14.8. Sacolinhas

Sacolinhas não usam personalização de medida.

Elas usam apenas tamanho fixo:

```txt
P — 15x20
M — 20x25
G — 25x30
```

---

## 15. Validação de campos de medida

Campos de medida devem aceitar apenas:

```txt
números
vírgula
ponto
```

Exemplos válidos:

```txt
150
1,5
1.5
200
```

Não pode salvar personalização se os campos obrigatórios daquele produto estiverem vazios.

Para redondo personalizado:

```txt
deve validar mínimo 90 cm e múltiplo de 10.
```

Botões do formulário:

```txt
Salvar medidas
Cancelar
```

Devem ter:

- mesmo tamanho;
- alinhamento central;
- espaçamento confortável;
- não ficar colados nas bordas do card.

O sistema não deve exigir dois cliques para salvar.

---

## 16. Carrinho

O carrinho deve:

- salvar automaticamente no navegador;
- persistir até o cliente clicar em **Limpar carrinho**;
- permitir adicionar a mesma arte mais de uma vez;
- permitir aumentar/diminuir quantidade;
- mostrar miniatura da arte;
- permitir clicar no item para localizar a arte;
- no celular, ter botão de voltar no cabeçalho do carrinho junto de “Seu orçamento”.

### Quantidade de uma mesma arte

Se o cliente adiciona a mesma arte duas vezes, conta como duas unidades.

Exemplo para 50x50:

```txt
6 bolinhas fecham o mínimo.
Se adicionar mais 1 unidade da mesma arte, fica 7.
O sistema deve exigir mais 1 para fechar 8.
```

---

## 17. Favoritos

O cliente pode favoritar artes.

Regras visuais:

- **Ver favoritas** e **Adicionar favoritas** devem ser botões neutros;
- não devem parecer etapa atual;
- não devem ficar em destaque rosa.

Regra funcional:

- favoritas devem ser globais;
- se o cliente favoritou em outra pasta, elas devem aparecer ao clicar em “Ver favoritas”;
- limpar busca ao abrir favoritas para não parecer que só existe uma arte.

---

## 18. Busca

A busca deve funcionar por:

```txt
tema
subtema
produto
código da arte
```

Exemplos:

```txt
Ariel
Batman
Blue Lock
195
```

Se estiver na tela de temas e digitar um tema ou subtema, deve mostrar resultado.

Se digitar código da arte logo na busca inicial, deve buscar a arte globalmente.

---

## 19. Links por vendedora / perfis

O sistema aceita link geral e link travado por vendedora.

### Link geral

```txt
https://seusite.pages.dev/
```

Mostra escolha de vendedora.

### Link travado da Ana

```txt
https://seusite.pages.dev/?ana
```

ou:

```txt
https://seusite.pages.dev/?perfil=ana
```

Trava na Ana:

- não mostra Dayane;
- não mostra escolha de vendedora;
- WhatsApp vai direto para Ana.

### Link travado da Dayane

```txt
https://seusite.pages.dev/?dayane
```

ou:

```txt
https://seusite.pages.dev/?perfil=dayane
```

Trava na Dayane.

### Criar novos perfis

No `index.html`, existe um objeto parecido com:

```js
const SELLERS = {
  ana: {
    label: "Ana",
    phone: "5581996763982"
  },
  dayane: {
    label: "Dayane",
    phone: "5581983383002"
  }
};
```

Para adicionar uma nova pessoa:

```js
carla: {
  label: "Carla",
  phone: "5581988888888"
}
```

Aí os links funcionam:

```txt
?carla
?perfil=carla
```

---

## 20. WhatsApp

A mensagem final deve ser natural e comercial, mas sem valores por item.

Modelo desejado:

```txt
Oi, Ana! Separei minhas artes por aqui e quero finalizar minha seleção.

Minha seleção:

Painel 150x150
Tema(s): Princesa
• Arte #220
Diâmetro personalizado: 120 cm

Sacolinha M
Tema(s): Ariel
• Arte #195 (10 un.)
Tamanho: M (20x25 cm)

Observação: há medida personalizada nesta seleção.

Pode conferir para mim e me ajudar a finalizar?
```

Regras:

- não enviar subtotais por item;
- não enviar desconto por item;
- não detalhar valor de cada produto na mensagem;
- se houver personalização, deixar claro que a medida é personalizada;
- se não houver personalização, não inventar medida personalizada;
- se for sacolinha, enviar tamanho e quantidade.

---

## 21. Visual / identidade

O visual segue a identidade da Armazém:

- fundo claro premium;
- cartões arredondados;
- rosa pastel;
- azul pastel para ações positivas;
- amarelo suave em alguns cards;
- tipografia com hierarquia consistente;
- botões sempre alinhados e centralizados.

Regras importantes:

- evitar botões pretos em ações comuns;
- ações positivas podem usar azul pastel;
- rosa deve ser usado com cuidado para não parecer erro;
- toasts positivos preferencialmente em azul pastel;
- botões devem ter espaçamento confortável das bordas;
- cards não devem ter texto colado no arredondado.

---

## 22. Botões e estados

### Botões de arte

Usar texto claro:

```txt
Adicionar arte
```

Quando já estiver no carrinho:

```txt
Adicionar 1 unidade
Tirar 1 unidade
```

Evitar textos confusos como:

```txt
Adicionar mais uma (2)
```

### Botões de personalização

Usar:

```txt
Personalizar tamanho
```

Não usar apenas ícone.

### Botões de sacolinha

Usar:

```txt
Trocar tamanho
```

Opções P/M/G só aparecem ao clicar.

### Botão final

Usar ideia de:

```txt
Enviar pedido com 10% OFF
```

ou:

```txt
Enviar minha seleção com 10% OFF
```

---

## 23. Modo demonstração

Quando o HTML é aberto sozinho ou a API falha, pode entrar em modo demonstração.

O modo demonstração serve para testar fluxo visual sem Drive.

Nunca mostrar erro técnico como:

```txt
Failed to fetch
```

Em vez disso, usar texto humano:

```txt
Não conseguimos carregar as artes agora.
Tente novamente ou fale com uma vendedora.
```

Mas se estiver em teste local, mostrar temas/produtos fake para testar.

---

## 24. Loading

Usar frases fofinhas alternando:

```txt
Buscando artes lindas para você...
Separando os temas com carinho...
Organizando as opções da sua festa...
Preparando uma seleção cheia de possibilidades...
```

Evitar textos técnicos.

---

## 25. Códigos das artes

O código da arte deve ser extraído do nome do arquivo.

Exemplos:

```txt
ARTE-195 → 195
Arte 195 → 195
195.png → 195
```

No card, mostrar:

```txt
Código #195
```

Não mostrar o nome completo do arquivo do Drive.

---

## 26. Ordenação

As artes devem aparecer em ordem decrescente por código:

```txt
220
195
188
177
...
```

Ou seja:

```txt
maior ID primeiro
```

---

## 27. Regras para novo produto

Para criar novo produto, precisa mexer em dois lugares.

### 27.1. Backend

No `functions/api/drive.js`, dentro de:

```js
function normalizeProductInfo(value) {
```

Adicionar a regra.

Exemplo para Totem:

```js
if (s.includes("totem")) {
  return { key: "totem", label: "Totem" };
}
```

Também adicionar na ordem:

```js
function productOrder(key) {
```

Exemplo:

```js
"totem": 11
```

### 27.2. Frontend

No `index.html`, adicionar em `PRODUCT_CONFIG`:

```js
"totem": {
  label: "Totem",
  type: "rectangle",
  unitPrice: 89.90
}
```

E se precisar de personalização própria, criar regra em `measureFields`.

---

## 28. Regras de cache

O site pode usar cache local no navegador para:

- temas;
- produtos;
- itens já carregados.

O carrinho deve ser salvo no `localStorage`.

O carrinho só deve sumir se o cliente clicar em:

```txt
Limpar carrinho
```

---

## 29. Principais problemas já corrigidos no histórico

Problemas que já apareceram e devem ser evitados:

- breadcrumbs invertidos;
- setas em cima do texto das pílulas;
- scripts agressivos quebrando cliques;
- botão de personalização só com ícone;
- aviso de personalização dentro de cada item;
- sacolinha mostrando preço errado;
- favoritos mostrando apenas uma arte por causa da busca;
- campos de medidas fechando ao tentar digitar;
- botão salvar exigindo dois cliques;
- botão cancelar/salvar desalinhados;
- carrinho sem opção de voltar no celular;
- “Failed to fetch” aparecendo no modo demo;
- texto colado nas margens dos cards;
- botões pretos em ações comuns;
- mensagem de WhatsApp com valores demais.

---

## 30. Última versão visual desejada

Última decisão visual importante:

```txt
Breadcrumb/pílulas:
Temas > Tema atual > Subtema > Produtos > Nome do produto
```

- Sem setas.
- Sem “Você está em”.
- Etapa atual em azul pastel.
- Temas neutro.
- Favoritas neutras.
- Uma linha com scroll horizontal no celular.

---

## 31. Observação para outro chat

Se continuar este projeto em outro chat, informe que:

- é um site Cloudflare Pages;
- usa Google Drive API;
- tem `index.html` e `functions/api/drive.js`;
- o Drive tem temas, subtemas e produtos;
- o usuário quer máxima atenção ao mobile;
- o usuário é muito sensível a alinhamento, espaçamento, botões tortos e texto colado;
- qualquer alteração deve preservar cliques e não usar scripts agressivos com MutationObserver reorganizando tudo;
- sempre validar JavaScript antes de entregar.

---

## 32. Checklist antes de entregar nova versão

Antes de gerar ZIP, verificar:

```txt
[ ] JavaScript sem erro de sintaxe.
[ ] Carrinho abre e fecha no mobile.
[ ] Botões continuam clicáveis.
[ ] Breadcrumb na ordem correta.
[ ] Sem setas no breadcrumb.
[ ] Etapa atual azul.
[ ] Sacolinhas com P/M/G e preços corretos.
[ ] Personalização só abre ao clicar.
[ ] Aviso de personalização só antes do envio.
[ ] WhatsApp sem valores por item.
[ ] Busca por tema/subtema/código funcionando.
[ ] Favoritas globais funcionando.
[ ] ZIP inclui index.html e functions/api/drive.js.
```

---

## 33. Arquivos que normalmente devem ser enviados ao Cloudflare

Para evitar incompatibilidade entre front e Function, subir sempre o ZIP inteiro:

```txt
index.html
functions/api/drive.js
_headers
README.md
```

Se o projeto estiver conectado ao GitHub, precisa substituir os arquivos no repositório e fazer commit.

Se for upload manual no Cloudflare Pages, subir o ZIP inteiro.
