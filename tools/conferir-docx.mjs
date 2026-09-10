/* ==========================================================================
   conferir-docx.mjs — o arnês do pacote, rodando fora do navegador.

   Carrega o motor do arquivo JÁ CONSTRUÍDO (index.html), não do template:
   o que interessa conferir é exatamente aquilo que o assistente vai abrir.
   O script principal roda num vm com o mínimo de ambiente — sem DOM, sem
   localStorage — porque nada no motor depende do navegador em tempo de carga.

   Gera um .docx de verdade em /tmp e o reabre para conferir estrutura,
   conteúdo e determinismo.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALVO = process.argv[2] || path.join(RAIZ, 'index.html');

let falhas = 0, passes = 0;
const ok = (cond, nome, detalhe) => {
    if (cond) { passes++; console.log('  ✓ ' + nome); }
    else      { falhas++; console.log('  ✘ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
};

/* --------------------------------------------------------------------------
   Verificador de boa-formação de XML.
   Node não tem DOMParser. Em vez de puxar uma dependência para o produto,
   um analisador de pilha resolve o que precisamos saber: tags balanceadas,
   atributos com aspas fechadas, entidades conhecidas.
   -------------------------------------------------------------------------- */
function xmlBemFormado(xml) {
    const pilha = [];
    const re = /<[!?\/]?([A-Za-z_][\w.:-]*)?([^>]*?)(\/?)>/g;
    let m, i = 0;

    while ((m = re.exec(xml)) !== null) {
        const bruto = m[0];
        if (bruto.startsWith('<?') || bruto.startsWith('<!')) { i = re.lastIndex; continue; }

        const nome = m[1];
        if (!nome) return 'tag sem nome na posição ' + m.index;

        const aspas = (m[2].match(/"/g) || []).length;
        if (aspas % 2 !== 0) return 'aspas ímpares em <' + nome + '>';

        if (bruto[1] === '/') {
            const topo = pilha.pop();
            if (topo !== nome) return 'fechamento </' + nome + '> sem abertura correspondente (topo: ' + topo + ')';
        } else if (m[3] !== '/') {
            pilha.push(nome);
        }
        i = re.lastIndex;
    }
    if (pilha.length) return 'tag(s) sem fechamento: ' + pilha.join(', ');

    const ent = xml.match(/&[^;\s]*;?/g) || [];
    const conhecidas = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);$/;
    for (const e of ent) if (!conhecidas.test(e)) return 'entidade desconhecida: ' + e;

    return null;
}

/* --------------------------------------------------------------------------
   Carga do motor
   -------------------------------------------------------------------------- */

if (!fs.existsSync(ALVO)) {
    console.error('\n  ✘ arquivo não encontrado: ' + ALVO + '\n    rode "npm run build" antes.\n');
    process.exit(1);
}
const html = fs.readFileSync(ALVO, 'utf8');

/* Blocos <script> sem atributo. O maior é o motor; o do JSZip vem logo depois. */
const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (blocos.length < 2) {
    console.error('\n  ✘ não encontrei os blocos de script esperados em ' + path.basename(ALVO) + '\n');
    process.exit(1);
}
const porTamanho = [...blocos].sort((a, b) => b.length - a.length);
const fonteJszip = porTamanho.find(b => b.indexOf('JSZip') >= 0 && b.indexOf('const Ooxml') < 0);
const fonteMotor = porTamanho.find(b => b.indexOf('const Ooxml') >= 0);

if (!fonteMotor) { console.error('\n  ✘ bloco do motor não localizado\n'); process.exit(1); }
if (!fonteJszip) { console.error('\n  ✘ bloco do JSZip não localizado — o build inlinou a biblioteca?\n'); process.exit(1); }

const ctx = vm.createContext({
    console, Blob, URL, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, String, Number,
    /* O JSZip agenda o trabalho de compressão em fatias. No navegador ele usa
       MutationObserver; aqui, setImmediate. Sem isso, generateAsync trava. */
    setImmediate, clearImmediate, queueMicrotask,
    Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Error, RegExp, isNaN, parseInt, parseFloat,
    /* Shim: só o que o arnês do navegador usa. */
    DOMParser: class {
        parseFromString(s) {
            const erro = xmlBemFormado(s);
            return { querySelector: sel => (sel === 'parsererror' && erro) ? { textContent: erro } : null };
        }
    },
    /* O JSZip lê um Blob por FileReader, que só existe no navegador. O Blob do
       Node já sabe entregar o próprio conteúdo, então o shim é uma casca fina
       por cima de blob.arrayBuffer() — o suficiente para o mesmo caminho de
       código do navegador rodar aqui, em vez de ficar sem cobertura. */
    FileReader: class {
        readAsArrayBuffer(blob) {
            blob.arrayBuffer().then(
                ab => this.onload && this.onload({ target: { result: ab } }),
                er => this.onerror && this.onerror({ target: { error: er } })
            );
        }
    },
    document: { createElement: () => ({ click() {}, remove() {}, style: {} }),
                body: { appendChild() {} }, getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '' }
});
ctx.globalThis = ctx;

/* Sem "window" no contexto de propósito: o wrapper UMD do JSZip escolhe onde
   se pendurar nesta ordem — window, global, self, this. No navegador, window
   É o objeto global e tudo funciona. Aqui, um window de mentira faria a
   biblioteca se instalar num canto que o motor não enxerga, e o .docx falharia
   com "biblioteca-ausente" — sem window, ela cai no "this", que é o global
   deste vm, exatamente como no navegador. */
vm.runInContext(fonteJszip, ctx, { filename: 'jszip.js' });
if (typeof ctx.JSZip === 'undefined') {
    console.error('\n  ✘ JSZip não se instalou no contexto — o wrapper UMD mudou de forma?\n');
    process.exit(1);
}
vm.runInContext(fonteMotor, ctx, { filename: 'motor.js' });

/* --------------------------------------------------------------------------
   Conferências
   -------------------------------------------------------------------------- */

const run = async () => {
    console.log('\n  Conferindo ' + path.basename(ALVO) + '\n');

    /* 1. O arnês embutido, o mesmo que roda em ?debug=1. */
    console.log('  Arnês do motor');
    const res = await vm.runInContext('Testes.rodar()', ctx);
    res.forEach(r => ok(r.ok, r.nome, r.motivo));

    /* 2. O pacote de verdade. */
    console.log('\n  Pacote gerado');
    ctx.__doc  = await vm.runInContext('Testes.docExemplo()', ctx);
    ctx.__meta = await vm.runInContext('Testes.metaExemplo()', ctx);

    const blob = await vm.runInContext('Docx.blob(__doc, __meta)', ctx);
    const buf  = Buffer.from(await blob.arrayBuffer());
    const saida = path.join(os.tmpdir(), 'minutar-conferencia.docx');
    fs.writeFileSync(saida, buf);

    ok(buf.length > 1000, 'pacote tem tamanho plausível', buf.length + ' bytes');
    ok(buf[0] === 0x50 && buf[1] === 0x4B, 'assinatura ZIP (PK) presente');

    /* Data descriptor (bit 3 do flag de propósito geral) faz o Apache POI —
       que é o que roda no backend do PJe — recusar o arquivo. */
    const flag = buf.readUInt16LE(6);
    ok((flag & 0x08) === 0, 'sem data descriptor (streamFiles desligado)', 'flag=0x' + flag.toString(16));

    const zip = await vm.runInContext('JSZip.loadAsync(__buf)', Object.assign(ctx, { __buf: buf }));
    const nomes = Object.keys(zip.files);

    [ '[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml',
      'word/settings.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'docProps/app.xml'
    ].forEach(n => ok(nomes.indexOf(n) >= 0, 'parte presente: ' + n));

    ok(!nomes.some(n => n.endsWith('/')), 'sem entradas de diretório no ZIP');

    for (const n of nomes) {
        const txt = await zip.files[n].async('string');
        ok(xmlBemFormado(txt) === null, 'XML bem formado: ' + n, xmlBemFormado(txt));
    }

    /* 3. Conteúdo. */
    console.log('\n  Conteúdo da peça');
    const doc = await zip.files['word/document.xml'].async('string');

    ok(doc.indexOf('#{') < 0, 'nenhum placeholder #{} do PJe na minuta');
    ok(doc.indexOf('INSTRUÇÕES DE USO') < 0, 'bloco de instruções não vazou para a peça');
    ok(doc.indexOf('<w:pStyle') < 0, 'nenhum w:pStyle (formatação é direta, por projeto)');
    ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(doc), 'nenhum caractere de controle');

    const wt = (doc.match(/<w:t[ >]/g) || []).length;
    const wtp = (doc.match(/<w:t xml:space="preserve">/g) || []).length;
    ok(wt === wtp, 'xml:space="preserve" em todos os ' + wt + ' w:t');

    /* Lido do produto, não escrito aqui: a conferência precisa acusar quando o
       .docx destoa da curadoria, e não quando destoa de um número que alguém
       digitou nesta ferramenta e esqueceu de atualizar. */
    const fmt = await vm.runInContext('DADOS.formatacao', ctx);
    const meiaPonto = fmt.fonte.tamanhoMeioPonto;

    ok(doc.indexOf('w:ascii="' + fmt.fonte.familia + '"') >= 0, 'fonte ' + fmt.fonte.familia);
    ok(doc.indexOf('<w:sz w:val="' + meiaPonto + '"/>') >= 0, 'corpo ' + (meiaPonto / 2) + 'pt');
    ok(doc.indexOf('w:line="' + fmt.entrelinha.linhaTwips + '"') >= 0,
       'entrelinha ' + (fmt.entrelinha.linhaTwips / 240).toFixed(1).replace('.', ','));
    ok(doc.indexOf('w:w="' + fmt.pagina.larguraTwips + '" w:h="' + fmt.pagina.alturaTwips + '"') >= 0, 'página A4');
    ok(doc.indexOf('w:left="' + fmt.margensTwips.esquerda + '"') >= 0 &&
       doc.indexOf('w:right="' + fmt.margensTwips.direita + '"') >= 0, 'margens da vara');

    const hang = Math.abs(fmt.estilos.alinea.recuoPrimeiraLinhaTwips || 0);
    ok(doc.indexOf('w:hanging="' + hang + '"') >= 0, 'recuo pendente da alínea');

    const rec = fmt.estilos.corpo.recuoPrimeiraLinhaTwips || 0;
    ok(rec === 0 || doc.indexOf('w:firstLine="' + rec + '"') >= 0,
       'recuo de primeira linha do corpo (' + (rec / 566.93).toFixed(2).replace('.', ',') + ' cm)');

    /* Override × parte: a divergência que produz "conteúdo ilegível". */
    const ct = await zip.files['[Content_Types].xml'].async('string');
    const declarados = (ct.match(/PartName="\/([^"]+)"/g) || []).map(s => s.slice(11, -1));
    ok(declarados.every(d => nomes.indexOf(d) >= 0), 'todo Override tem parte correspondente');
    ok(nomes.filter(n => n.endsWith('.xml') && !n.startsWith('[') && !n.includes('_rels'))
            .every(n => declarados.indexOf(n) >= 0), 'toda parte .xml tem Override');

    /* 4. Privacidade: nada de dado pessoal nas propriedades do arquivo. */
    console.log('\n  Privacidade');
    const core = await zip.files['docProps/core.xml'].async('string');
    ok(core.indexOf('<dc:creator>MINUTAR</dc:creator>') >= 0, 'autor do arquivo é o sistema, não a pessoa');
    ok(/<dc:subject><\/dc:subject>|<dc:subject\/>/.test(core), 'dc:subject vazio quando não informado');

    /* 5. Determinismo. */
    console.log('\n  Determinismo');
    const b2 = await vm.runInContext('Docx.blob(__doc, __meta)', ctx);
    const buf2 = Buffer.from(await b2.arrayBuffer());
    ok(buf.equals(buf2), 'duas gerações produzem bytes idênticos');

    /* --- Relatório --- */
    console.log('');
    console.log('  ' + passes + ' conferência(s) aprovada(s)' + (falhas ? ', ' + falhas + ' reprovada(s)' : ''));
    console.log('  → ' + saida);
    console.log('');
    if (falhas) {
        console.log('  Abra o arquivo acima no Word e no LibreOffice antes de considerar a Fase 1 concluída.');
        console.log('');
    }
    process.exit(falhas ? 1 : 0);
};

run().catch(e => {
    console.error('\n  ✘ conferência interrompida: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
});
