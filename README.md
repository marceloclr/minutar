# MINUTAR

Gerador de minutas do **3º Juizado Especial da Fazenda Pública e Saúde Pública do DF**.

O assistente escolhe o tipo de peça na vitrine, preenche o formulário que aquele
modelo define, confere a prévia e baixa o `.docx` pronto para anexar no PJe.

**Ao vivo:** https://marceloclr.github.io/minutar/ (GitHub Pages, atualiza a
cada push na branch `main`).

---

## Estado atual

`npm run tudo`: **84 conferências, 0 reprovadas.**

- O pacote OOXML é montado à mão e comprimido por um JSZip 3.10.1 inlinado no
  próprio HTML — sem servidor, sem internet.
- Prévia e `.docx` nascem da mesma estrutura (`montarDocumento()`); um teste de
  igualdade textual reprova o build se as duas trilhas divergirem.
- Cambria 14pt, recuo de primeira linha 1,25 cm, entrelinha 1,4, A4, margens da
  vara — conferido contra o CSS real das 4 rotas de saúde, não só contra a peça
  real da vara usada para a fonte e as margens.
- Geração determinística: dois downloads produzem bytes idênticos.
- **As 4 rotas de sentença de saúde estão convertidas e alcançáveis pela
  interface**: procedência com prazo (mora do Enunciado 93), procedência com
  tutela já cumprida, extinção por falta de interesse, extinção do cumprimento
  pela satisfação.

Falta a prova de campo: **anexar um arquivo gerado pelo sistema a um processo
real no PJe**. É o único risco que invalidaria o motor inteiro.

---

## Como rodar

```bash
npm run validar    # confere a curadoria — bloqueia o build se houver erro
npm run build      # gera index.html (arquivo único, autocontido)
npm run conferir   # gera um .docx de verdade e o reabre para auditar
npm run tudo       # os três, em ordem
npm run servir     # http://localhost:8378 — só para testar; o arquivo abre por file://
```

O produto é o `index.html`. É o que se entrega aos assistentes: um arquivo, dois
cliques, sem instalação. `npm run build` também grava uma cópia com carimbo de
data/hora (fora do git — é só histórico local, não faz parte do que se entrega).

A interface não tem botão de teste — testar é `npm run tudo` (ou `conferir`).
O assistente só vê a vitrine de modelos e o formulário.

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
| `dados/formatacao.json` | Fonte, margens, entrelinha e estilos de parágrafo. Extraído por inspeção de peça real da vara e conferido contra o CSS das 4 rotas — **não é preferência estética** |
| `dados/orgaos.json` | Cabeçalho institucional, local e cargo |
| `dados/catalogo.json` | Classes, temas e tipos de peça que alimentam o formulário |
| `dados/fundamentos.json` | Indireção de citações: `@ref:cpc_1022` → texto. Corrigir aqui corrige todos os modelos |
| `dados/ordem.json` | Ordem dos modelos na vitrine. A ordem é dado |
| `dados/modelos/*.json` | Um arquivo por tipo de peça: campos do formulário + corpo do documento. As 4 rotas de sentença de saúde já convertidas |

### Blocos do motor

O JS é organizado em namespaces numerados, que fazem o papel de arquivos:

```
[0] TEMA  [1] CONFIG  [2] PROV  [3] U  [4] MODELOS  [5] DADOS
[8] Cond      quando/escolha
[9] Campos    um controle por tipo de campo, crítica ao vivo
[10] Form     monta o formulário, agrupa, calcula pendências
[11] Montagem modelo + valores → IR
[12] Marcador **negrito**/__itálico__ inline
[13] Previa   IR → HTML da folha A4
[14] Ooxml    IR → word/document.xml
[15] Pacote   as 8 partes do .docx
[16] Docx     ZIP → Blob → download
[18] Vitrine  escolha do modelo
[23] App      [24] Testes     [Z] JSZip
```

Os blocos `[6]`/`[7]` (estado central/CNJ com dígito verificador) e `[17]`/`[19]`–`[22]`
(componentes de UI reaproveitáveis, navegação, persistência, rascunhos e
transferência de modelos não-oficiais) seguem fora de escopo até serem pedidos.

---

## Duas decisões que sustentam o resto

**Uma fonte de texto, dois renderizadores.** `montarDocumento()` produz uma única IR
(parágrafos/runs) a partir do modelo e dos valores digitados; a prévia na tela e o
`.docx` são dois renderizadores burros dessa mesma estrutura, sem regra de conteúdo
em nenhum dos dois. Um teste de igualdade textual compara o texto extraído da prévia
com o dos `<w:t>` do `.docx` — se divergirem, o build é reprovado antes de o arquivo
chegar a alguém.

**Formatação direta, sem `w:pStyle`.** A peça real da vara também não usa estilos
nomeados. Emitir a formatação em cada parágrafo elimina a pior armadilha do OOXML: um
`pStyle` apontando para estilo inexistente abre normalmente, sai com a formatação
errada, e nada acusa.

---

## O validador bloqueia o build

`tools/validar-modelos.mjs` é o que transforma "nunca inventar dado" de promessa em
condição de compilação. Entre as regras:

- placeholder `{{x}}` sem campo correspondente
- condição (`quando`/`escolha`) sobre campo inexistente, ou comparando com valor fora
  das opções (o typo clássico: a condição existe, está bem formada, e nunca dispara)
- `campo.derivado` com origem inexistente, ou `diasEntre` fora de campos do tipo data
- `ajuda` ausente ou curta demais — a diretriz do tooltip vira verificável
- `sensivel` não declarado — obriga o curador a classificar cada campo
- qualquer resíduo `#{…}` do PJe: este sistema resolve os valores, não os repassa
- SHA-256 do JSZip divergente
- estilo em `formatacao.json` sem regra correspondente na prévia
- filtro (`|dataExtenso`, `|cnj`, `|moeda`...) usado num tipo de campo incompatível

Erro bloqueia o build. Aviso aparece no terminal e deixa passar.

---

## Dados pessoais

Nomes de partes e quadro clínico, em juizado de saúde pública, são dado pessoal
sensível. Campos marcados `sensivel: true` no schema identificam esses casos, e o
sistema nunca os grava nas propriedades do arquivo (`dc:creator`, `dc:subject` etc.)
— só no corpo do `word/document.xml`, que é o próprio conteúdo da peça. Hoje o
formulário vive só em memória da aba aberta: recarregar a página apaga tudo
digitado, sem nada tocar em `localStorage`/`sessionStorage` do navegador —
persistência de rascunho entre sessões é trabalho futuro, não implementado ainda.

Nada sai do computador do assistente. Não há servidor.

---

## Próximos passos

| | |
|---|---|
| Prova de campo no PJe | ninguém anexou ainda um `.docx` gerado pelo sistema a um processo real — prioridade sobre qualquer coisa nova |
| Dígito verificador (CNJ, SIGTAP) | hoje só o formato é conferido, não o cálculo (Módulo 11 etc.) |
| Persistência de rascunho | `sessionStorage` para não perder preenchimento num reload acidental |
| Rascunhos e transferência | o assistente cria um modelo local não-oficial, exporta; o curador promove à base sem tocar em `src/` |
