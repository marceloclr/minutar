# MINUTAR — prompt de continuação

> Cole este arquivo inteiro como primeira mensagem numa nova sessão do Claude Code,
> aberta em `~/Documentos/GitHub/minutar` (repositório git, remote `origin` já
> configurado para `github.com/marceloclr/minutar`, branch `main`).

---

Você vai continuar o **MINUTAR**, gerador de minutas do 3º Juizado Especial da Fazenda
Pública e Saúde Pública do DF (TJDFT). Leia `CLAUDE.md` e `README.md` inteiros antes
de qualquer coisa — este prompt resume o essencial, mas os dois arquivos têm o
detalhe completo e são a fonte de verdade se algo aqui divergir deles.

## 1. O que o sistema é, e onde está

Um assistente escolhe um **tipo de peça** na vitrine, preenche o **formulário que
aquele modelo define**, confere a prévia e baixa a minuta em **`.docx`** para anexar
no PJe. Roda inteiramente no navegador — um HTML único, sem servidor, pensado para
máquina de secretaria sem saída à internet.

- Repositório: https://github.com/marceloclr/minutar (público)
- Publicado também via GitHub Pages: **https://marceloclr.github.io/minutar/**
  (serve o `index.html` da branch `main` direto — atualiza sozinho a cada push)
- Estado: `npm run tudo` fecha em **84 conferências, 0 reprovadas**. As 4 rotas de
  sentença de saúde do projeto irmão (`~/Documentos/GitHub/Gerador de Sentencas` —
  hoje só referência histórica, não mais mantido em paralelo) estão convertidas
  para `dados/modelos/*.json` e alcançáveis pela interface de ponta a ponta:
  Vitrine → Form → Prévia → Baixar `.docx`.

## 2. Decisões já fechadas — não reabra sem instrução expressa

| | |
|---|---|
| Saída | `.docx` real (OOXML montado à mão). Nada de copiar-e-colar, nada de PDF |
| Formatação | Cambria 14pt, recuo de primeira linha 1,25cm, entrelinha 1,4, A4 25/20/25/30mm — conferida contra o CSS real das 4 rotas de saúde |
| Uma fonte, dois renderizadores | `Montagem.montarDocumento()` produz a IR; `Previa` e `Ooxml` só desenham, sem regra de conteúdo. Teste de igualdade textual reprova o build se divergirem |
| Formatação direta no OOXML | Sem `w:pStyle` — decisão deliberada, testada |
| `campo.derivado` | Calculado a partir de outros campos, nunca digitado, nunca aparece no Form. Ex.: `prioridade`/`prazo_dias` da Rota A vêm de `cor_risco`/`graduacao_mora` |
| `partes` no corpo | Escolha **no meio da frase** (não só o parágrafo inteiro) — motivado pela Rota A (teto de 100/180 dias, trecho "CONFIRMO A TUTELA") |
| `grupoAlineas` | Numera as alíneas **depois** de filtrar por `quando` — nenhuma letra escrita à mão, resolve a Rota D (alínea condicional da constrição) sem buraco na sequência |
| Interface enxuta | Só Vitrine + Form + Prévia. Os cartões de teste ("conferência do pacote", "Arnês") foram removidos — redundantes com o Form de verdade e com `npm run tudo` |
| Nunca inventar formato | CID-10, SIGTAP e o dígito verificador de CNJ (Módulo 97) e SIGTAP (Módulo 11) têm fonte oficial pesquisada e implementada; SISREG e "Id. de documento do PJe" não têm fonte confiável o bastante — ficaram texto livre, de propósito |
| Dígito verificador é aviso, não bloqueio | `Campos.validar` acusa CNJ/SIGTAP com dígito errado (borda vermelha + mensagem), mas só `Form.pendencias` (campo obrigatório vazio) impede "Baixar" — mesmo padrão das outras críticas de formato |
| Repositório público | Nunca commitar dado pessoal ou de saúde real — só `{{placeholders}}` e exemplos fictícios ("Fulano de Tal") |

## 3. Arquitetura — resumo (detalhe completo em `CLAUDE.md`)

```
dados/*.json  ──┐
                ├──► tools/build.mjs ──► index.html   (produto, nome estável)
src/template.html ─┘                      ▲
                                          │
                     vendor/jszip-3.10.1.min.js (inlinado, SHA-256 conferido)
```

- **`src/template.html`** — o app inteiro (HTML+CSS+JS inline), organizado em
  namespaces numerados: `Cond`[8] `Campos`[9] `Form`[10] `Montagem`[11]
  `Marcador`[12] `Previa`[13] `Ooxml`[14] `Pacote`[15] `Docx`[16] `Vitrine`[18]
  `App`[23] `Testes`[24]. Blocos `[6]`/`[7]` (estado central/CNJ com dígito
  verificador) e `[17]`/`[19]`–`[22]` (UI reaproveitável, navegação, persistência,
  rascunhos/transferência) seguem fora de escopo até serem pedidos.
- **`dados/modelos/*.json`** — um arquivo por peça. Schema: `campos[]` (tipo,
  rotulo, ajuda, obrigatorio, sensivel, grupo?, mostrarQuando?, derivado?) +
  `corpo[]` (nós com `texto`/`escolha`/`partes`/`grupoAlineas`). Tipos de campo
  disponíveis: `processo`, `cid`, `sigtap`, `hora`, `data`, `numero`, `moeda`,
  `selecao`, `multipla`, `booleano`, `parte`, `texto`, `textoLongo` — cada um com
  máscara e validação ao vivo próprias em `Campos` (ver `CLAUDE.md` para a lista
  completa e os filtros de placeholder: `|dataExtenso`, `|horaExtenso`, `|moeda`,
  `|maiusculas`, `|sintetico`).
- **`tools/validar-modelos.mjs`** bloqueia o build se o schema de um modelo
  estiver incoerente (placeholder sem campo, condição que nunca dispara, `ajuda`
  curta, `sensivel` não declarado, filtro incompatível com o tipo, etc.).
- **`tools/conferir-docx.mjs`** carrega o `index.html` já construído num `vm`
  Node, gera um `.docx` de verdade, reabre e audita — é a mesma suíte (`Testes`)
  que existia com botão na interface antigamente; hoje só roda por aqui.

Comandos: `npm run validar | build | conferir | tudo | servir`.

## 4. Regras de trabalho — obrigatórias

1. **Apresente o entendimento e o plano antes de qualquer alteração não trivial,
   e aguarde confirmação.** Não implemente e depois pergunte.
2. **Entregue sempre o arquivo completo**, nunca trechos para colar à mão.
3. **Edições cirúrgicas:** localize o bloco, troque o bloco. Não reescreva módulos
   inteiros sem necessidade.
4. **Nunca renomeie** arquivos, chaves de `dados/*.json`, valores de `estilo`,
   `derivado` ou identificadores só porque um rótulo visível mudou.
5. **Não altere fundamentos jurídicos, artigos, enunciados, temas ou prazos** sem
   instrução expressa. Se notar inconsistência, aponte e pergunte.
6. **Nunca invente um formato/dado sem fonte confiável** — pesquise antes de
   implementar máscara/validação nova (é o padrão já seguido para CID-10/SIGTAP);
   sem fonte confiável, deixe o campo livre em vez de restringir errado.
7. **Não altere `dados/formatacao.json`** sem instrução expressa.
8. **Valide antes de finalizar:** `npm run tudo` verde.
9. **Tooltip em todo controle** com `ajuda` de verdade (o validador reprova
   `ajuda` ausente ou curta).
10. **Nunca exponha erro técnico ao usuário na interface.**
11. **Tudo em pt-BR:** identificadores, comentários, interface, commits.
12. **Commits pequenos, mensagens em português, só após aprovação do usuário.
    Push para `origin` só quando pedido explicitamente** — não é automático a
    cada commit local.
13. **Repositório público:** nunca commitar dado pessoal ou de saúde real.

## 5. O que falta

Em ordem de prioridade:

1. **Prova de campo no PJe** — ninguém anexou ainda um `.docx` gerado pelo
   sistema a um processo real. É o único risco que invalidaria o motor inteiro;
   pergunte ao usuário se isso já aconteceu antes de investir em qualquer coisa
   nova. Se ainda não, sugira que ele teste antes ou em paralelo.
2. **Persistência de rascunho** (`sessionStorage`) — hoje o formulário vive só em
   memória da aba; um reload acidental perde tudo digitado.
3. **Rascunhos e transferência** — o assistente cria um modelo local
   não-oficial, exporta; o curador promove à base sem tocar em `src/`.

(Dígito verificador de CNJ/SIGTAP — Módulo 97/Módulo 11 — já implementado
em 2026-09-10, `U.dvCnj`/`U.dvSigtap`.)

Nenhum desses está em andamento nem foi pedido — são candidatos. Não comece
nenhum sem confirmar com o usuário primeiro.

## 6. Comece por aqui

1. Leia `CLAUDE.md` e `README.md` inteiros.
2. Rode `npm run tudo` e confirme 84/84 verdes antes de tocar em qualquer coisa.
3. Se o usuário pedir uma mudança, apresente entendimento + plano (regra 1 da
   seção 4) e só implemente depois de aprovado.
