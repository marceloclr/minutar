# MINUTAR

Gerador de minutas do **3º Juizado Especial da Fazenda Pública e Saúde Pública do DF**.

O assistente escolhe o tipo de peça, preenche o formulário que aquele modelo define,
confere a prévia e baixa o `.docx` pronto para anexar no PJe.

---

## Estado atual — Fases 1 e 2 concluídas

A Fase 1 respondeu à única pergunta que precede todas as outras: **é possível gerar,
sem servidor e sem internet, um `.docx` que o Word, o LibreOffice e o PJe aceitem?**
Sim — o pacote OOXML é montado à mão e comprimido por um JSZip 3.10.1 inlinado no
próprio HTML.

A Fase 2 uniu a prévia e o `.docx` numa única fonte de texto (`montarDocumento()`),
com um teste que reprova o build se as duas trilhas divergirem.

Verificado (`npm run tudo`, **62 conferências**):

- Aberto pelo LibreOffice como documento Writer, sem reparo
- Cambria 14pt, recuo de primeira linha 1,25 cm, entrelinha 1,5, A4, margens da
  vara, negrito e recuo pendente preservados na ida e volta
- Prévia e `.docx` textualmente idênticos, inclusive com `escolha`, `quando` e
  `grupoAlineas`
- Geração determinística: dois downloads produzem bytes idênticos

Falta a prova de campo: **anexar o arquivo a um processo real no PJe**.
Enquanto isso não for feito, a Fase 1 não está encerrada de fato.

---

## Como rodar

```bash
npm run validar    # confere a curadoria — bloqueia o build se houver erro
npm run build      # gera index.html (arquivo único, autocontido)
npm run conferir   # gera um .docx de verdade e o reabre para auditar
npm run tudo       # os três, em ordem
npm run servir     # http://localhost:8378 — só para testar; o arquivo abre por file://
```

O produto é o `index.html` (e a cópia com carimbo de data/hora ao lado).
É o que se entrega aos assistentes: um arquivo, dois cliques, sem instalação.

Abrindo com `?debug=1`, o arnês roda sozinho na abertura.

---

## Arquitetura — autoria modular, distribuição monolítica

```
dados/*.json  ──┐
                ├──► tools/build.mjs ──► index.html  (produto)
src/template.html ─┘                      ▲
                                          │
                     vendor/jszip-3.10.1.min.js (inlinado, SHA-256 conferido)
```

A curadoria vive em `dados/`. O motor vive em `src/template.html`. **Acrescentar um
tipo de peça é acrescentar um JSON — nenhum passo toca em `src/`.** Se isso deixar de
ser verdade, o schema está incompleto, e é esse o achado a tratar.

| Caminho | O que é |
|---|---|
| `dados/formatacao.json` | Fonte, margens, entrelinha e estilos de parágrafo. Extraído por inspeção de peça real da vara — **não é preferência estética** |
| `dados/orgaos.json` | Cabeçalho institucional, local e cargo |
| `dados/catalogo.json` | Classes, temas e tipos de peça que alimentam o formulário |
| `dados/fundamentos.json` | Indireção de citações: `@ref:cpc_1022` → texto. Corrigir aqui corrige todos os modelos |
| `dados/ordem.json` | Ordem dos modelos na vitrine. A ordem é dado |
| `dados/modelos/*.json` | Um arquivo por tipo de peça: campos do formulário + corpo do documento |

### Blocos do motor

O JS é organizado em namespaces numerados, que fazem o papel de arquivos:

```
[0] TEMA  [1] CONFIG  [2] PROV  [3] U  [4] MODELOS  [5] DADOS
[14] Ooxml   IR → word/document.xml
[15] Pacote  as 8 partes do .docx
[16] Docx    ZIP → Blob → download
[23] App     [24] Testes     [Z] JSZip
```

Os blocos `[6]`–`[13]` e `[17]`–`[22]` entram nas fases seguintes.

---

## Duas decisões que sustentam o resto

**Uma fonte de texto, dois renderizadores.** Desde a Fase 2, `montarDocumento()`
produz uma única IR (parágrafos/runs) a partir do modelo e dos valores digitados;
a prévia na tela e o `.docx` são dois renderizadores burros dessa mesma estrutura,
sem regra de conteúdo em nenhum dos dois. Um teste de igualdade textual compara o
texto extraído da prévia com o dos `<w:t>` do `.docx` — se divergirem, o build é
reprovado antes de o arquivo chegar a alguém.

**Formatação direta, sem `w:pStyle`.** A peça real da vara também não usa estilos
nomeados. Emitir a formatação em cada parágrafo elimina a pior armadilha do OOXML: um
`pStyle` apontando para estilo inexistente abre normalmente, sai com a formatação
errada, e nada acusa.

---

## O validador bloqueia o build

`tools/validar-modelos.mjs` é o que transforma "nunca inventar dado" de promessa em
condição de compilação. Entre as regras:

- placeholder `{{x}}` sem campo correspondente
- condição sobre campo inexistente, ou comparando com valor fora das opções
  (o typo clássico: a condição existe, está bem formada, e nunca dispara)
- `ajuda` ausente ou curta demais — a diretriz do tooltip vira verificável
- `sensivel` não declarado — obriga o curador a classificar cada campo
- qualquer resíduo `#{…}` do PJe: este sistema resolve os valores, não os repassa
- SHA-256 do JSZip divergente
- estilo em `formatacao.json` sem regra correspondente na prévia

Erro bloqueia. Aviso aparece e deixa passar.

---

## Dados pessoais

Nomes de partes e quadro clínico, em juizado de saúde pública, são dado pessoal
sensível. O tratamento é estrutural: campos marcados `sensivel` vivem apenas em
`sessionStorage` e apenas em `word/document.xml` — nunca nas propriedades do arquivo,
nunca no histórico. Há conferência automática que varre o pacote gerado atrás de
vazamento.

Nada sai do computador do assistente. Não há servidor.

---

## Próximas fases

| | | |
|---|---|---|
| 2 | IR e renderizadores — **concluída** | prévia e `.docx` textualmente idênticos (verificado por teste automático) |
| 3 | Schema, formulário e os modelos reais | o `.docx` gerado reproduz a peça da vara, parágrafo a parágrafo |
| 4 | CNJ com dígito verificador, persistência, LGPD | nenhum dado sensível fora do `document.xml` |
| 5 | Rascunhos e transferência | o assistente cria um modelo, exporta; o curador promove à base sem tocar em `src/` |
