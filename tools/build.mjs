/* ==========================================================================
   build.mjs — autoria modular, distribuição monolítica.

   A curadoria vive em dados/. O motor vive em src/template.html. Este script
   injeta a primeira no segundo e produz o arquivo único que é entregue aos
   assistentes — que abre com dois cliques, sem servidor e sem internet.

   Nenhum passo do build inventa conteúdo: ele só transporta o que já foi
   validado por validar-modelos.mjs. Se um marcador sumir do template ou o
   JSZip não bater o SHA-256, o build para.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...t) => path.join(RAIZ, ...t);

/* SHA-256 do vendor/jszip-3.10.1.min.js, conferido a cada build.
   Uma biblioteca inlinada sem conferência de integridade é um vetor de
   supply chain que ninguém revisa depois da primeira vez. */
const JSZIP_SHA256 = 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e';

const MARCADORES = ['/*@MODELOS@*/', '/*@DADOS@*/', '/*@JSZIP@*/'];

/* --- Leitura -------------------------------------------------------------- */

function lerJson(rel) {
    try {
        return JSON.parse(fs.readFileSync(p(rel), 'utf8'));
    } catch (e) {
        throw new Error('não foi possível ler ' + rel + ': ' + e.message);
    }
}

/* Chaves iniciadas por "_" são notas de curadoria: explicam a decisão para
   quem edita o JSON e não têm função no produto. Ficam na fonte, saem do
   arquivo entregue. */
function semNotas(o) {
    if (Array.isArray(o)) return o.map(semNotas);
    if (o && typeof o === 'object') {
        const r = {};
        Object.keys(o).forEach(k => { if (k[0] !== '_') r[k] = semNotas(o[k]); });
        return r;
    }
    return o;
}

/* --- Resolução de @ref ---------------------------------------------------- */

/* Uma citação corrigida em fundamentos.json corrige todos os modelos que a
   usam. O token que não resolve é erro de compilação, não texto no produto. */
function resolverRefs(o, refs, caminho = '') {
    if (typeof o === 'string') {
        return o.replace(/@ref:([a-z0-9_\-]+)/gi, (todo, chave) => {
            if (!(chave in refs)) {
                throw new Error('@ref:' + chave + ' não existe em dados/fundamentos.json (em ' + caminho + ')');
            }
            return refs[chave];
        });
    }
    if (Array.isArray(o)) return o.map((v, i) => resolverRefs(v, refs, caminho + '[' + i + ']'));
    if (o && typeof o === 'object') {
        const r = {};
        Object.keys(o).forEach(k => { r[k] = resolverRefs(o[k], refs, caminho + '.' + k); });
        return r;
    }
    return o;
}

/* --- Injeção -------------------------------------------------------------- */

/* Um modelo que contenha a sequência "</script" fecharia o bloco antes de
   virar objeto, e o resto do sistema viraria texto na tela. */
const seguro = s => s.split('</script').join('<\\/script');

function literal(valor) {
    return seguro(JSON.stringify(valor, null, 0));
}

function injetar(tpl, marcador, conteudo) {
    /* O template traz "/*@X@*\/ <padrão> /*@FIM@*\/" para continuar sendo um
       arquivo JS válido antes do build — dá para abrir src/template.html no
       navegador e o motor carrega, só que sem curadoria. */
    const re = new RegExp(
        marcador.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[\\s\\S]*?\\/\\*@FIM@\\*\\/'
    );
    if (re.test(tpl)) return tpl.replace(re, () => conteudo);
    return tpl.split(marcador).join(conteudo);
}

/* --- Build ---------------------------------------------------------------- */

function build() {
    const inicio = Date.now();

    /* 1. Template e marcadores. */
    const tplCaminho = p('src', 'template.html');
    let tpl = fs.readFileSync(tplCaminho, 'utf8');

    MARCADORES.forEach(m => {
        if (tpl.indexOf(m) < 0) {
            throw new Error('marcador ausente em src/template.html: ' + m);
        }
    });

    /* 2. JSZip, com integridade conferida. */
    const jszipCaminho = p('vendor', 'jszip-3.10.1.min.js');
    if (!fs.existsSync(jszipCaminho)) {
        throw new Error('vendor/jszip-3.10.1.min.js não encontrado — sem ele não há geração de .docx');
    }
    const jszip = fs.readFileSync(jszipCaminho, 'utf8');
    const sha = crypto.createHash('sha256').update(jszip, 'utf8').digest('hex');
    if (sha !== JSZIP_SHA256) {
        throw new Error(
            'SHA-256 do JSZip não confere.\n' +
            '  esperado: ' + JSZIP_SHA256 + '\n' +
            '  obtido:   ' + sha + '\n' +
            '  A biblioteca foi trocada ou corrompida. O build não continua.'
        );
    }

    /* 3. Curadoria. */
    const fundamentos = lerJson('dados/fundamentos.json');
    const refs = fundamentos.refs || {};

    const DADOS = semNotas(resolverRefs({
        formatacao:  lerJson('dados/formatacao.json'),
        orgaos:      lerJson('dados/orgaos.json'),
        catalogo:    lerJson('dados/catalogo.json'),
        fundamentos: fundamentos
    }, refs, 'dados'));

    /* 4. Modelos, na ordem declarada. A ordem é dado: deixá-la a cargo do
          sistema de arquivos mudaria a vitrine sem mudar um registro sequer. */
    const ordem = lerJson('dados/ordem.json');
    const dirModelos = p('dados', 'modelos');
    const arquivos = fs.existsSync(dirModelos)
        ? fs.readdirSync(dirModelos).filter(f => f.endsWith('.json')).sort()
        : [];

    const porId = new Map();
    arquivos.forEach(f => {
        const m = lerJson(path.join('dados', 'modelos', f));
        const esperado = f.replace(/\.json$/, '');
        if (m.id !== esperado) {
            throw new Error('dados/modelos/' + f + ': o id "' + m.id + '" não bate com o nome do arquivo');
        }
        porId.set(m.id, m);
    });

    const faltando = [...porId.keys()].filter(id => (ordem.modelos || []).indexOf(id) < 0);
    if (faltando.length) {
        throw new Error('modelos ausentes de dados/ordem.json: ' + faltando.join(', '));
    }
    const fantasmas = (ordem.modelos || []).filter(id => !porId.has(id));
    if (fantasmas.length) {
        throw new Error('dados/ordem.json cita modelos que não existem: ' + fantasmas.join(', '));
    }

    const MODELOS = semNotas(resolverRefs(
        (ordem.modelos || []).map(id => porId.get(id)), refs, 'modelos'));

    /* 5. Injeção. */
    let saida = tpl;
    saida = injetar(saida, '/*@DADOS@*/',   literal(DADOS));
    saida = injetar(saida, '/*@MODELOS@*/', literal(MODELOS));
    saida = injetar(saida, '/*@JSZIP@*/',   jszip);

    MARCADORES.forEach(m => {
        if (saida.indexOf(m) >= 0) throw new Error('marcador não resolvido: ' + m);
    });
    if (/@ref:[a-z0-9_\-]+/i.test(saida)) {
        throw new Error('sobrou @ref não resolvido no produto');
    }

    /* 6. Gravação. Nome com carimbo de data/hora, no padrão dos projetos irmãos. */
    const agora = new Date();
    const dd = String(agora.getDate()).padStart(2, '0');
    const mm = String(agora.getMonth() + 1).padStart(2, '0');
    const hh = String(agora.getHours()).padStart(2, '0');
    const mi = String(agora.getMinutes()).padStart(2, '0');

    const versao = (saida.match(/versao:\s*'([^']+)'/) || [])[1] || '0';
    const nome = 'MINUTAR_v' + versao + '_' + dd + mm + '_' + hh + mi + '.html';

    fs.writeFileSync(p(nome), saida, 'utf8');
    /* index.html é o nome estável: abre direto pelo GitHub Pages e ao
       visitar o repositório, além de ser para onde o arnês e o preview
       sempre apontam. O carimbado ao lado é o histórico de cada build. */
    fs.writeFileSync(p('index.html'), saida, 'utf8');

    const kb = (Buffer.byteLength(saida, 'utf8') / 1024).toFixed(0);
    console.log('');
    console.log('  MINUTAR v' + versao + ' — build concluído em ' + (Date.now() - inicio) + ' ms');
    console.log('');
    console.log('  ' + MODELOS.length + ' modelo(s) · ' +
                Object.keys(DADOS.formatacao.estilos).length + ' estilo(s) · ' +
                Object.keys(refs).length + ' referência(s)');
    console.log('  JSZip 3.10.1 inlinado — SHA-256 conferido');
    console.log('');
    console.log('  → ' + nome + '  (' + kb + ' KB)');
    console.log('  → index.html  (mesmo conteúdo, nome estável)');
    console.log('');
}

try {
    build();
} catch (e) {
    console.error('');
    console.error('  ✘ build interrompido: ' + e.message);
    console.error('');
    process.exit(1);
}
