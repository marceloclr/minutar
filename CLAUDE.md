# MINUTAR — Gerador de minutas (.docx) do 3º JEFPSP/DF

## Contexto

Gerador de minutas de sentença em `.docx` real (OOXML), rodando **inteiramente
no navegador, sem servidor**: um único HTML auto-contido monta o pacote ZIP
(via JSZip vendorizado) e baixa via Blob — pensado para máquina de secretaria
sem saída à internet.

Existe um projeto irmão, `~/Documentos/GitHub/Gerador de Sentencas`, com os
textos jurídicos originais das 4 rotas de saúde (Procedência En.93,
Procedência confirmação, Extinção sem mérito, Extinção do cumprimento) em HTML
solto com `{{placeholders}}` e `data-grupo`/`data-bloco`. Já convertidas para
`dados/modelos/*.json` (ver "Estado atual"); esse projeto irmão só serve de
referência histórica agora, não é mais mantido em paralelo.

Repositório público: https://github.com/marceloclr/minutar (remote `origin`,
branch `main`). Publicado a pedido do usuário em 2026-09-10, antes de a
conversão das 4 rotas estar completa. GitHub Pages ativo, serve o `index.html`
da branch `main` direto: https://marceloclr.github.io/minutar/ (atualiza
sozinho a cada push).

`PROMPT_CONTINUACAO.md` na raiz é o texto para colar como primeira mensagem
de uma nova sessão — mantenha os dois em sincronia quando o estado mudar.

## Arquitetura — autoria modular, distribuição monolítica

```
dados/*.json  ──┐
                ├──► tools/build.mjs ──► index.html   (produto, nome estável)
src/template.html ─┘                      ▲
                                          │
                     vendor/jszip-3.10.1.min.js (inlinado, SHA-256 conferido)
```

- `src/template.html` — o app inteiro (HTML+CSS+JS inline). Três marcadores
  que o build substitui: `/*@MODELOS@*/`, `/*@DADOS@*/`, `/*@JSZIP@*/`. Dá
  para abrir direto no navegador sem build (motor carrega com `MODELOS=[]`,
  sem curadoria) — útil só para depurar o motor isoladamente.
- `dados/formatacao.json` — fonte, página, margens, entrelinha e estilos de
  parágrafo (twips). **Não é preferência estética — é o padrão que a vara
  assina** (Cambria 14pt, recuo 1,25cm, entrelinha 1,4, A4 25/20/25/30mm,
  conferido contra o CSS real das 4 rotas em 2026-09-10). Alterar aqui muda
  toda minuta gerada — nunca sem instrução expressa.
- `dados/orgaos.json` — cabeçalho institucional e dados de assinatura por
  órgão. `dados/catalogo.json` — classes/temas/tipos de peça. `dados/
  fundamentos.json` — indireção de citações (`@ref:chave` → texto; corrigir
  aqui corrige todos os modelos que citam). `dados/ordem.json` — ordem dos
  modelos na vitrine.
- `dados/modelos/*.json` — um arquivo por peça (ver "Schema de um modelo"
  abaixo). **As 4 rotas de saúde já convertidas:**
  - `procedencia_mora_en93.json` (Rota A) — procedência, prazo por
    classificação de risco (mora do Enunciado 93 FONAJUS).
  - `procedencia_confirmacao_tutela.json` (Rota B) — procedência, tutela já
    concedida e cumprida.
  - `extincao_falta_interesse.json` (Rota C) — extinção sem mérito, 5 causas.
  - `extincao_cumprimento_satisfacao.json` (Rota D) — extinção do cumprimento
    pela satisfação da obrigação, com/sem constrição a levantar.
- `vendor/jszip-3.10.1.min.js` — JSZip vendorizado (não é carregado por CDN).
  SHA-256 conferido a cada build; divergência bloqueia.
- `tools/build.mjs` — substitui os marcadores, resolve `@ref:`, respeita
  `ordem.json`, grava `index.html`. `npm run build` também grava uma cópia
  com carimbo de data/hora (`MINUTAR_v*.html`, ignorada pelo git — é só
  histórico local de build, não faz parte do produto entregue).
- `tools/validar-modelos.mjs` — **bloqueia o build**. Schema completo dos
  modelos: marcadores, SHA-256 do JSZip, balanceamento de tags, caractere de
  controle literal no fonte, `campos`/`corpo`/`escolha`/`quando`/`partes`/
  `derivado`, placeholder sem campo, `ajuda` curta, `sensivel` não declarado,
  resíduo `#{}`, filtro incompatível com o tipo do campo.
- `tools/conferir-docx.mjs` — carrega o motor do `index.html` já construído
  num `vm` Node, gera um `.docx` de verdade, reabre e audita. Roda o mesmo
  arnês embutido (`Testes`) que existe no motor. O arnês **não tem mais
  botão na interface** — os cartões "conferência do pacote" e "Verificação"
  (Fase 1/2) foram removidos em 2026-09-10: o assistente real testa gerando
  e baixando pelo Form de verdade, e a suíte roda só por `npm run tudo`/
  `conferir-docx.mjs`. `Testes` continua em `src/template.html`, só não é
  mais alcançável clicando em nada.

Comandos: `npm run validar | build | conferir | tudo | servir`.

### Como o motor funciona (blocos numerados em `src/template.html`)

```
[0] TEMA  [1] CONFIG  [2] PROV  [3] U  [4] MODELOS  [5] DADOS
[8] Cond  [9] Campos  [10] Form  [11] Montagem  [12] Marcador  [13] Previa
[14] Ooxml  [15] Pacote  [16] Docx  [18] Vitrine  [23] App  [24] Testes  [Z] JSZip
```

- **`Ooxml`** gera `word/document.xml` a partir da IR (parágrafos/runs), com
  formatação **direta** por parágrafo (sem `w:pStyle`) — decisão deliberada:
  a peça real da vara também não usa estilos nomeados, e isso elimina a pior
  armadilha do OOXML (`pStyle` para estilo inexistente abre normal e sai
  errado, sem nada acusar).
- **`Pacote`** monta as 8 partes do `.docx` a partir de uma lista única, e
  deriva `[Content_Types].xml` dela.
- **`Docx`** zippa via JSZip com data fixa (geração determinística) e
  `streamFiles:false` (Apache POI, usado no PJe, recusa data descriptors).
- **`Cond`** avalia `quando`/`escolha`: `igual, diferente, preenchido, umDe,
  contem, maiorQue, menorQue, entre, todos, algum, nao`.
- **`Marcador`** faz o parser inline de `**negrito**`/`__itálico__` (escape
  `\`); recebe um resolvedor de `{{...}}` opcional e NUNCA escaneia o valor
  já resolvido por marcador — um `**` num nome de parte não abre negrito no
  resto da peça.
- **`Montagem.montarDocumento(modelo, valores, opcoes)`** é a única função
  que decide o texto da peça — `Previa` e `Ooxml` são dois renderizadores
  burros da mesma IR, sem regra de conteúdo em nenhum dos dois (garantido por
  teste de igualdade textual entre os dois, para cada modelo real). Resolve
  `{{campo}}`, `{{campo|filtro}}`, `{{@hoje}}`/`{{@local}}`/`{{@magistrado}}`/
  `{{@orgao}}`/`{{@alinea:id}}`, `grupoAlineas` (numera as alíneas DEPOIS de
  filtrar por `quando` — nenhuma letra é escrita à mão num JSON), `partes`
  (escolha no meio da frase, não só o parágrafo inteiro) e `campo.derivado`
  (calculado a partir de outros campos, nunca digitado — ver schema abaixo).
- **`Campos`/`Form`/`Vitrine`** — interface: Vitrine lista os modelos, Form
  monta os campos visíveis (`mostrarQuando`) e não-derivados, agrupados por
  `campo.grupo` (sempre visíveis, sem clicar para expandir), com crítica ao
  vivo por tipo (`Campos.validar`/`mascarar`) e bloqueia "Baixar" enquanto
  houver `Form.pendencias` (obrigatório + visível + vazio).
- **`PROV`** (Curado/Digitado/Derivado/Pendente/Rascunho) é a taxonomia de
  proveniência — hoje só usada nos selos da interface (`U.selo`), não
  anotada por run na peça gerada.

### Schema de um modelo (`dados/modelos/*.json`)

```
{ esquema, id, versao, oficial: true,
  metadados: { titulo, tipoPeca, orgao, tema?, classesAplicaveis?, atualizadoEm, curador },
  aplicabilidade: [string], triagem: { excluir: [string] },
  campos: [ { id, tipo, rotulo, ajuda (>=30 car.), obrigatorio, sensivel,
              opcoes?, minimo?, maximo?, grupo?, mostrarQuando?, derivado? } ],
  corpo: [ nó ] }
```

Tipos de campo (`Campos.renderizar`/`validar`/`mascarar` em `src/template.html`):
`processo` (máscara + formato CNJ + dígito verificador — Módulo 97 Base 10,
Resolução CNJ 65/2008, `U.dvCnj`), `cid` (formato CID-10: letra + 2 dígitos +
subcategoria opcional, ex. `F41.1`), `sigtap` (10 dígitos GGSSFFPPPP +
dígito verificador — Módulo 11, `U.dvSigtap`),
`hora` (`<input type="time">`, filtro `|horaExtenso` pra virar "9h30"),
`data`, `numero`, `moeda` (filtro `|moeda`, formata BRL sem depender de
`Intl`), `selecao`, `multipla`, `booleano` (é `<select>` Sim/Não/vazio —
nunca checkbox: desmarcado ficaria indistinguível de "não respondido"),
`parte`, `texto`, `textoLongo`.

Um nó do corpo tem `id`, `estilo` e **um** de: `texto` (string, com
placeholders/marcador), `escolha` (`{campo, casos:[{valor,texto}], padrao}`),
`partes` (`[texto | {escolha}, ...]`, para variação no meio da frase), ou
`tipo:"grupoAlineas"` com `filhos` (nós comuns, cada um pode ter `quando`).

`campo.derivado` (`{tipo:"tabela", origem:[...], tabela:{...}}` ou
`{tipo:"diasEntre", origem:[dataDe, dataAte]}`) — campo nunca digitado, nunca
aparece no Form nem em `Form.pendencias`; calculado por
`Montagem.aplicarDerivados` a partir de outros campos já coletados. Chave da
tabela é o `join('.')` dos valores de `origem`, na ordem declarada.

## Regras de trabalho

- Antes de qualquer alteração não trivial, apresentar entendimento e plano, e
  aguardar confirmação do usuário. Não implementar e depois perguntar.
- Entregar sempre o arquivo completo; nunca trechos soltos.
- Nunca renomear arquivos, chaves de `dados/*.json`, `estilo`/`derivado`/
  identificadores só porque um rótulo mudou.
- Não alterar fundamentos jurídicos, artigos, enunciados, temas ou prazos sem
  instrução expressa; se notar algo inconsistente, apontar e perguntar — e
  quando não houver fonte confiável para um formato/dado, deixar sem
  restrição em vez de inventar (ex.: SISREG, Id. de documento do PJe).
- Não alterar `dados/formatacao.json` sem instrução expressa.
- Rodar `npm run tudo` (verde) antes de considerar qualquer mudança concluída.
- Commits pequenos, mensagens em português, só após aprovação do usuário.
  Push para `origin` só quando pedido explicitamente.
- Repositório público: nunca commitar dado pessoal ou de saúde real — só
  `{{placeholders}}` e valores de exemplo claramente fictícios ("Fulano de
  Tal") em modelos e testes.
- `MINUTAR_v*.html` (build com carimbo) fica fora do git (`.gitignore`) — só
  `index.html` é versionado como produto.

## Estado atual (2026-09-10)

`npm run tudo`: **84 conferências, 0 reprovadas.** As 4 rotas de saúde estão
convertidas e alcançáveis pela Vitrine/Form na interface — não só por
`Testes`. Decisões e achados que valem lembrar (detalhe completo no
histórico do git, commit a commit, se precisar):

- Interface enxuta: os cartões de teste ("Fase 1 — conferência do pacote" e
  "Verificação — Arnês do pacote") foram removidos — redundantes com o Form
  de verdade (que já baixa/mostra prévia de uma peça real) e com `npm run
  tudo`. `App.gerar`/`previaExemplo`/`testar` saíram junto; `Testes`/
  `docExemplo` continuam existindo, só não têm mais botão.
- Alínea com recuo pendente (hanging) vem do `.docx` real da vara — mantido
  mesmo onde o HTML das rotas simplificava para recuo comum.
- Rota A: comandos "c"/"d" dos comandos cartorários continuam sobrepostos,
  como no original — só a pontuação de "c" foi corrigida (ponto → ponto e
  vírgula). `graduacao_mora` tem uma opção "limítrofe" que só o HTML original
  define para a cor azul (90 dias, teto absoluto); para as outras cores, se
  alguém escolher, o prazo fica em branco no texto — lacuna visível é mais
  segura que inventar um número.
- Rota D: cita o CPC por extenso ("do Código de Processo Civil"), diferente
  das outras 3 rotas ("do CPC") — preservado literal, sem `@ref:`.
- `prioridade`, `dias_mora`, `prazo_dias`/`prazo_extenso` (Rota A) são
  `campo.derivado`, não digitados — calculados de `cor_risco`,
  `data_insercao`/`data_ajuizamento` e `graduacao_mora`.
- Campos sem uso real no HTML original (`representacao_autor` na Rota A,
  `autor_idade`/`codigo_sigtap` isolado na Rota B) foram omitidos do schema,
  não inventados.
- Pesquisado antes de implementar: CID-10 e SIGTAP têm formato oficial
  documentado (implementados); SISREG e Id. de documento do PJe não têm
  fonte confiável o bastante — continuam texto livre, de propósito.
- Dígito verificador de `processo` (Módulo 97, `U.dvCnj`) e `sigtap`
  (Módulo 11, `U.dvSigtap`) implementados e conferidos à mão antes do código
  (0700000/2025.8.07.0016 → DD 65; 030101006 → DV 4). Mesmo padrão de
  crítica das demais: aviso visual (`Campos.validar`), não bloqueia "Baixar"
  — só `Form.pendencias` (campo obrigatório vazio) bloqueia.

**Pendente:** ninguém anexou ainda um `.docx` gerado pelo sistema a um
processo real no PJe. É o único risco que invalidaria o motor inteiro — vale
mais que qualquer outra coisa nova até acontecer.

## Próximos passos (a confirmar com o usuário antes de implementar)

Nada em andamento. Candidatos, todos fora de escopo até serem pedidos:
persistência de rascunho em `sessionStorage`, Rascunhos/Transferência de
modelos não-oficiais (`[21]`/`[22]`).
