/* ==========================================================================
   validar-modelos.mjs — a curadoria conferida antes de virar produto.

   Enquanto os modelos vivessem dentro do HTML, a única defesa contra um
   registro malformado seria o motor quebrar na frente do assistente, no meio
   do expediente. Separados em arquivos, podem ser conferidos antes — e é aqui
   que "nunca inventar dado" deixa de ser promessa e vira condição de
   compilação.

   Erro impede o build. Aviso não impede, mas fica visível.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...t) => path.join(RAIZ, ...t);

const JSZIP_SHA256 = 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e';
const MARCADORES = ['/*@MODELOS@*/', '/*@DADOS@*/', '/*@JSZIP@*/'];
const ESQUEMA_MODELO = 1;

const TIPOS_CAMPO = ['processo', 'texto', 'textoLongo', 'data', 'numero',
                     'moeda', 'selecao', 'multipla', 'booleano', 'parte'];

const erros = [], avisos = [];
const erro  = (onde, msg) => erros.push({ onde, msg });
const aviso = (onde, msg) => avisos.push({ onde, msg });

const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function lerJson(rel) {
    try { return JSON.parse(fs.readFileSync(p(rel), 'utf8')); }
    catch (e) { erro(rel, 'JSON ilegível: ' + e.message); return null; }
}

/* Toda string de qualquer profundidade — é assim que se pega um @ref perdido
   dentro de um array dentro de um objeto. */
function varrerStrings(o, visita, caminho = '') {
    if (typeof o === 'string') return visita(o, caminho);
    if (Array.isArray(o)) return o.forEach((v, i) => varrerStrings(v, visita, caminho + '[' + i + ']'));
    if (o && typeof o === 'object') {
        Object.keys(o).forEach(k => varrerStrings(o[k], visita, caminho ? caminho + '.' + k : k));
    }
}

/* ========================================================================
   1. Integridade do build
   ======================================================================== */

const tplCaminho = p('src', 'template.html');
if (!fs.existsSync(tplCaminho)) {
    erro('src/template.html', 'motor não encontrado');
} else {
    const tpl = fs.readFileSync(tplCaminho, 'utf8');

    MARCADORES.forEach(m => {
        if (tpl.indexOf(m) < 0) erro('src/template.html', 'marcador ausente: ' + m);
    });

    if (CONTROLE.test(tpl)) {
        erro('src/template.html', 'caractere de controle literal no motor — use escape (\\u000B) em vez do byte');
    }

    /* Balanceamento das tags que já causaram bug crítico nos projetos irmãos. */
    ['div', 'section', 'script', 'style', 'main', 'header'].forEach(t => {
        const ab = (tpl.match(new RegExp('<' + t + '[ >]', 'g')) || []).length;
        const fe = (tpl.match(new RegExp('</' + t + '>', 'g')) || []).length;
        if (ab !== fe) erro('src/template.html', '<' + t + '> desbalanceado: ' + ab + ' abertura(s), ' + fe + ' fechamento(s)');
    });

    /* Todo estilo citado em formatacao.json precisa ter aparência na prévia,
       senão a peça sai certa no .docx e errada na tela — divergência silenciosa. */
    const fmt = lerJson('dados/formatacao.json');
    if (fmt && fmt.estilos) {
        Object.keys(fmt.estilos).forEach(e => {
            if (tpl.indexOf('.est-' + e) < 0) {
                erro('src/template.html', 'estilo "' + e + '" existe em formatacao.json mas não tem regra .est-' + e + ' na prévia');
            }
        });
    }
}

const jszipCaminho = p('vendor', 'jszip-3.10.1.min.js');
if (!fs.existsSync(jszipCaminho)) {
    erro('vendor/', 'jszip-3.10.1.min.js ausente — sem ele não há .docx');
} else {
    const sha = crypto.createHash('sha256')
        .update(fs.readFileSync(jszipCaminho, 'utf8'), 'utf8').digest('hex');
    if (sha !== JSZIP_SHA256) {
        erro('vendor/jszip-3.10.1.min.js',
             'SHA-256 divergente — biblioteca trocada ou corrompida (obtido ' + sha.slice(0, 16) + '…)');
    }
}

/* ========================================================================
   2. Dados de apoio
   ======================================================================== */

const fmt   = lerJson('dados/formatacao.json');
const orgs  = lerJson('dados/orgaos.json');
const cat   = lerJson('dados/catalogo.json');
const fund  = lerJson('dados/fundamentos.json');
const ordem = lerJson('dados/ordem.json');
const refs  = (fund && fund.refs) || {};

if (fmt) {
    ['fonte', 'pagina', 'margensTwips', 'entrelinha', 'estilos'].forEach(k => {
        if (!fmt[k]) erro('dados/formatacao.json', 'seção obrigatória ausente: ' + k);
    });
    if (fmt.estilos && !fmt.estilos.corpo) {
        erro('dados/formatacao.json', 'o estilo "corpo" é o padrão de recurso e não pode faltar');
    }
}

if (orgs && orgs.orgaos) {
    Object.entries(orgs.orgaos).forEach(([id, o]) => {
        if (o.id !== id) erro('dados/orgaos.json', 'chave "' + id + '" não bate com o campo id "' + o.id + '"');
        ['cabecalho', 'local', 'cargoPadrao'].forEach(k => {
            if (!o[k]) erro('dados/orgaos.json', id + ': campo obrigatório ausente: ' + k);
        });
    });
}

/* ========================================================================
   3. Modelos
   ======================================================================== */

const dirModelos = p('dados', 'modelos');
const arquivos = fs.existsSync(dirModelos)
    ? fs.readdirSync(dirModelos).filter(f => f.endsWith('.json')).sort()
    : [];

const idsVistos = new Set();
let totalCampos = 0, totalParagrafos = 0;

arquivos.forEach(arquivo => {
    const rel = 'dados/modelos/' + arquivo;
    const m = lerJson(rel);
    if (!m) return;

    /* --- Identidade --- */
    if (m.esquema !== ESQUEMA_MODELO) {
        erro(rel, 'esquema ' + m.esquema + ' — este build suporta ' + ESQUEMA_MODELO);
    }
    if (!m.id || !/^[a-z0-9_]+$/.test(m.id)) {
        erro(rel, 'id ausente ou fora do formato [a-z0-9_]: ' + m.id);
    } else {
        if (idsVistos.has(m.id)) erro(rel, 'id duplicado: ' + m.id);
        idsVistos.add(m.id);
        if (m.id !== arquivo.replace(/\.json$/, '')) {
            erro(rel, 'o id "' + m.id + '" não bate com o nome do arquivo');
        }
    }
    if (!/^\d+\.\d+\.\d+$/.test(m.versao || '')) erro(rel, 'versao fora do formato semver: ' + m.versao);

    /* Modelo não-oficial vive no localStorage do assistente. dados/modelos/ é
       a base curada, e um rascunho promovido sem revisão anula a curadoria. */
    if (m.oficial !== true) erro(rel, 'dados/modelos/ só recebe modelo com "oficial": true');

    const md = m.metadados || {};
    ['titulo', 'tipoPeca', 'orgao', 'atualizadoEm', 'curador'].forEach(k => {
        if (!md[k]) erro(rel, 'metadados.' + k + ' ausente');
    });
    if (md.tipoPeca && cat && !(cat.tiposPeca || []).some(t => t.id === md.tipoPeca)) {
        erro(rel, 'tipoPeca "' + md.tipoPeca + '" não existe em catalogo.json');
    }
    if (md.orgao && orgs && !(orgs.orgaos || {})[md.orgao]) {
        erro(rel, 'orgao "' + md.orgao + '" não existe em orgaos.json');
    }
    (md.classesAplicaveis || []).forEach(c => {
        if (cat && !(cat.classes || []).some(x => x.id === c)) {
            erro(rel, 'classe "' + c + '" não existe em catalogo.json');
        }
    });

    /* Modelo com tese superada gera dezenas de peças erradas. O próprio modelo
       ADPF 615 avisa que o EAREsp 2.691.422 pode mudar a orientação. */
    if (md.atualizadoEm) {
        const dias = (Date.now() - Date.parse(md.atualizadoEm)) / 86400000;
        if (dias > 180) aviso(rel, 'curadoria com ' + Math.round(dias) + ' dias — reconferir a tese antes de usar');
    }

    if (!(m.aplicabilidade || []).length) aviso(rel, 'sem "aplicabilidade" — modelo sem critério de uso será usado errado');
    if (!m.triagem || !(m.triagem.excluir || []).length) aviso(rel, 'sem critério de triagem "excluir"');

    /* --- Campos --- */
    const campos = m.campos || [];
    const porId = new Map();
    totalCampos += campos.length;

    campos.forEach((c, i) => {
        const onde = rel + ' campo[' + i + ']' + (c.id ? ' "' + c.id + '"' : '');

        if (!c.id || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.id)) erro(onde, 'id ausente ou fora do formato');
        else if (porId.has(c.id)) erro(onde, 'id de campo duplicado no modelo');
        else porId.set(c.id, c);

        if (TIPOS_CAMPO.indexOf(c.tipo) < 0) erro(onde, 'tipo desconhecido: ' + c.tipo);
        if (!c.rotulo) erro(onde, 'rotulo ausente');

        /* A diretriz do tooltip vira verificável quando a ajuda é dado. */
        if (!c.ajuda) erro(onde, 'ajuda ausente — todo controle precisa de tooltip');
        else if (c.ajuda.length < 30) erro(onde, 'ajuda curta demais (' + c.ajuda.length + ' caracteres) para explicar função e efeito');

        if (typeof c.obrigatorio !== 'boolean') erro(onde, '"obrigatorio" precisa ser declarado');

        /* Sem padrão: o curador é obrigado a classificar cada campo. É o que
           sustenta o tratamento de dado pessoal do bloco [20]. */
        if (typeof c.sensivel !== 'boolean') erro(onde, '"sensivel" precisa ser declarado (true/false)');
        if (c.tipo === 'parte' && c.sensivel === false) erro(onde, 'nome de parte é dado pessoal por definição');

        if (c.tipo === 'selecao' || c.tipo === 'multipla') {
            const ops = c.opcoes || [];
            if (ops.length < 2) erro(onde, 'seleção com menos de duas opções');
            const vistos = new Set();
            ops.forEach(o => {
                if (!o.rotulo) erro(onde, 'opção sem rotulo');
                if (vistos.has(o.valor)) erro(onde, 'valor de opção repetido: ' + o.valor);
                vistos.add(o.valor);
            });
        }

        if (c.tipo === 'numero' || c.tipo === 'moeda') {
            if (c.minimo != null && c.maximo != null && c.minimo > c.maximo) erro(onde, 'minimo maior que maximo');
            if (c.padrao != null && c.minimo != null && c.padrao < c.minimo) erro(onde, 'padrao abaixo do minimo');
            if (c.padrao != null && c.maximo != null && c.padrao > c.maximo) erro(onde, 'padrao acima do maximo');
        }

        if (c.tipo === 'booleano' && c.padrao != null && typeof c.padrao !== 'boolean') {
            erro(onde, 'padrao de booleano precisa ser true/false, veio ' + JSON.stringify(c.padrao));
        }
        if (c.tipo === 'data' && c.padrao && c.padrao !== '@hoje' && !/^\d{4}-\d{2}-\d{2}$/.test(c.padrao)) {
            erro(onde, 'padrao de data precisa ser "@hoje" ou ISO');
        }
    });

    /* --- Condições --- */
    const OPERADORES = ['igual', 'diferente', 'preenchido', 'umDe', 'contem', 'maiorQue', 'menorQue', 'entre'];

    function validarCond(cond, onde) {
        if (!cond || typeof cond !== 'object') { erro(onde, 'condição inválida'); return; }

        if (cond.todos || cond.algum) {
            const lista = cond.todos || cond.algum;
            if (!Array.isArray(lista) || !lista.length) { erro(onde, '"todos"/"algum" com lista vazia'); return; }
            lista.forEach((c, i) => validarCond(c, onde + '.' + (cond.todos ? 'todos' : 'algum') + '[' + i + ']'));
            return;
        }
        if (cond.nao) { validarCond(cond.nao, onde + '.nao'); return; }

        if (!cond.campo) { erro(onde, 'condição sem "campo"'); return; }
        const def = porId.get(cond.campo);
        if (!def) { erro(onde, 'condição sobre campo inexistente: "' + cond.campo + '"'); return; }

        const usados = OPERADORES.filter(o => o in cond);
        if (usados.length !== 1) {
            erro(onde, 'condição precisa de exatamente um operador, veio ' + usados.length + ' (' + usados.join(', ') + ')');
            return;
        }
        const op = usados[0];

        if (op === 'contem' && def.tipo !== 'multipla') erro(onde, '"contem" só se aplica a campo de múltipla escolha');
        if ((op === 'maiorQue' || op === 'menorQue') && ['numero', 'moeda', 'data'].indexOf(def.tipo) < 0) {
            erro(onde, '"' + op + '" só se aplica a número, moeda ou data');
        }
        if (op === 'entre' && (!Array.isArray(cond.entre) || cond.entre.length !== 2)) {
            erro(onde, '"entre" precisa de exatamente dois valores');
        }

        /* O typo clássico: a condição existe, está bem formada, e nunca dispara. */
        if (def.tipo === 'selecao' && (op === 'igual' || op === 'umDe')) {
            const validos = (def.opcoes || []).map(o => o.valor);
            const alvos = op === 'umDe' ? cond.umDe : [cond.igual];
            alvos.forEach(v => {
                if (validos.indexOf(v) < 0) {
                    erro(onde, 'valor "' + v + '" não existe nas opções de "' + def.id + '" — a condição nunca será verdadeira');
                }
            });
        }
        if (def.tipo === 'booleano' && op === 'igual' && typeof cond.igual !== 'boolean') {
            erro(onde, 'comparação de booleano com ' + JSON.stringify(cond.igual) + ' — use true/false');
        }
    }

    /* --- Corpo --- */
    const idsNo = new Set();
    const usados = new Set();
    const FILTROS = ['cnj', 'dataExtenso', 'sintetico', 'maiusculas', 'moeda', 'percentual', 'extenso'];
    const estilosValidos = fmt && fmt.estilos ? Object.keys(fmt.estilos) : [];

    function validarNo(no, onde, dentroDeAlineas) {
        if (!no.id) erro(onde, 'nó do corpo sem id');
        else if (idsNo.has(no.id)) erro(onde, 'id de parágrafo duplicado: ' + no.id);
        else idsNo.add(no.id);

        totalParagrafos++;

        if (no.estilo && estilosValidos.indexOf(no.estilo) < 0) {
            erro(onde, 'estilo "' + no.estilo + '" não existe em formatacao.json');
        }
        if (no.texto != null && no.escolha) erro(onde, 'nó com "texto" e "escolha" ao mesmo tempo');
        if (no.quando) validarCond(no.quando, onde + '.quando');

        if (no.tipo === 'grupoAlineas') {
            if (no.texto != null) erro(onde, 'grupoAlineas não tem texto próprio');
            if (!(no.filhos || []).length) erro(onde, 'grupoAlineas sem filhos');
            (no.filhos || []).forEach((f, i) => validarNo(f, onde + '.filhos[' + i + ']', true));
            return;
        }

        const textos = [];
        if (typeof no.texto === 'string') textos.push(no.texto);
        if (no.escolha) {
            const e = no.escolha;
            if (!e.campo) erro(onde, 'escolha sem "campo"');
            else if (!porId.has(e.campo)) erro(onde, 'escolha sobre campo inexistente: ' + e.campo);
            else usados.add(e.campo);

            if (!('padrao' in e)) erro(onde, 'escolha sem "padrao" — ausência de padrão é ambiguidade');
            const vistos = new Set();
            (e.casos || []).forEach((c, i) => {
                if (vistos.has(JSON.stringify(c.valor))) erro(onde, 'caso repetido: ' + JSON.stringify(c.valor));
                vistos.add(JSON.stringify(c.valor));
                if (typeof c.texto === 'string') textos.push(c.texto);
                const def = porId.get(e.campo);
                if (def && def.tipo === 'selecao') {
                    const validos = (def.opcoes || []).map(o => o.valor);
                    if (validos.indexOf(c.valor) < 0) erro(onde + '.casos[' + i + ']', 'valor fora das opções de ' + e.campo);
                }
                if (def && def.tipo === 'booleano' && typeof c.valor !== 'boolean') {
                    erro(onde + '.casos[' + i + ']', 'caso de booleano precisa ser true/false');
                }
            });
            /* Uma opção sem caso e sem padrão faz o parágrafo sumir sem que
               ninguém tenha decidido isso. */
            const def = porId.get(e.campo);
            if (def && def.tipo === 'selecao' && e.padrao === null) {
                const cobertos = (e.casos || []).map(c => c.valor);
                (def.opcoes || []).forEach(o => {
                    if (cobertos.indexOf(o.valor) < 0) {
                        aviso(onde, 'escolher "' + o.rotulo + '" faz o parágrafo "' + no.id + '" desaparecer da peça');
                    }
                });
            }
        }

        textos.forEach(t => {
            if (CONTROLE.test(t)) erro(onde, 'caractere de controle no texto');

            /* A decisão do usuário: o sistema resolve tudo, nada de #{} chega ao PJe. */
            if (t.indexOf('#{') >= 0) erro(onde, 'resíduo de placeholder do PJe (#{…}) — este sistema resolve os valores');

            /* Marcador inline não fechado abre negrito e nunca fecha. */
            const semEscape = t.replace(/\\[*_]/g, '');
            if (((semEscape.match(/\*\*/g) || []).length) % 2 !== 0) erro(onde, 'marcador ** não fechado');
            if (((semEscape.match(/__/g) || []).length) % 2 !== 0) erro(onde, 'marcador __ não fechado');

            (t.match(/\{\{([^}]*)\}\}/g) || []).forEach(ph => {
                const dentro = ph.slice(2, -2).trim();
                const [alvo, filtro] = dentro.split('|').map(s => s && s.trim());

                if (filtro && FILTROS.indexOf(filtro) < 0) erro(onde, 'filtro inexistente: |' + filtro);

                if (alvo.startsWith('@')) {
                    const sist = alvo.slice(1).split(':')[0];
                    if (['hoje', 'local', 'magistrado', 'orgao', 'alinea'].indexOf(sist) < 0) {
                        erro(onde, 'valor de sistema desconhecido: ' + alvo);
                    }
                    if (sist === 'alinea') {
                        const ref = alvo.split(':')[1];
                        if (!ref) erro(onde, '{{@alinea:…}} sem id de referência');
                    }
                    return;
                }

                if (!porId.has(alvo)) { erro(onde, 'placeholder {{' + alvo + '}} sem campo correspondente'); return; }
                usados.add(alvo);

                const def = porId.get(alvo);
                if (filtro === 'sintetico' && def.tipo !== 'parte') erro(onde, '|sintetico só se aplica a campo do tipo parte');
                if (filtro === 'dataExtenso' && def.tipo !== 'data') erro(onde, '|dataExtenso só se aplica a campo de data');
                if (filtro === 'cnj' && def.tipo !== 'processo') erro(onde, '|cnj só se aplica a campo do tipo processo');
                if (filtro === 'moeda' && ['moeda', 'numero'].indexOf(def.tipo) < 0) erro(onde, '|moeda só se aplica a valor numérico');
            });
        });
    }

    (m.corpo || []).forEach((no, i) => validarNo(no, rel + ' corpo[' + i + ']', false));
    if (!(m.corpo || []).length) erro(rel, 'modelo sem corpo');

    /* mostrarQuando depois de conhecer todos os campos. */
    campos.forEach(c => {
        if (!c.mostrarQuando) return;
        const onde = rel + ' campo "' + c.id + '".mostrarQuando';
        validarCond(c.mostrarQuando, onde);
        if (c.mostrarQuando.campo === c.id) erro(onde, 'campo condicionado a si mesmo');
        if (c.mostrarQuando.campo) usados.add(c.mostrarQuando.campo);
    });

    /* Campo órfão: aviso, porque pode ser preparação. Mas obrigar alguém a
       preencher um campo que não afeta a peça é maltratar quem usa. */
    campos.forEach(c => {
        if (usados.has(c.id)) return;
        if (c.obrigatorio) erro(rel, 'campo "' + c.id + '" é obrigatório mas não afeta a peça');
        else aviso(rel, 'campo "' + c.id + '" não é usado por nenhum parágrafo ou condição');
    });

    /* Coerência da peça. */
    if (md.tipoPeca === 'sentenca') {
        const estilos = new Set();
        const colher = n => { if (n.estilo) estilos.add(n.estilo); (n.filhos || []).forEach(colher); };
        (m.corpo || []).forEach(colher);
        if (!estilos.has('assinatura')) aviso(rel, 'sentença sem parágrafo de assinatura');
        if (!estilos.has('secao')) aviso(rel, 'sentença sem parágrafo de seção (I – RELATÓRIO etc.)');
    }

    /* @ref não resolvido em qualquer profundidade. */
    varrerStrings(m, (s, caminho) => {
        (s.match(/@ref:([a-z0-9_\-]+)/gi) || []).forEach(t => {
            const chave = t.slice(5);
            if (!(chave in refs)) erro(rel, t + ' não existe em fundamentos.json (em ' + caminho + ')');
        });
    });
});

/* --- Ordem --- */
if (ordem) {
    const listados = ordem.modelos || [];
    [...idsVistos].forEach(id => {
        if (listados.indexOf(id) < 0) erro('dados/ordem.json', 'modelo ausente da ordem: ' + id);
    });
    listados.forEach(id => {
        if (!idsVistos.has(id)) erro('dados/ordem.json', 'cita modelo inexistente: ' + id);
    });
}

/* ========================================================================
   Relatório
   ======================================================================== */

console.log('');
console.log('  ' + arquivos.length + ' modelo(s) · ' + totalCampos + ' campo(s) · ' +
            totalParagrafos + ' parágrafo(s) · ' + Object.keys(refs).length + ' referência(s)');
console.log('');

avisos.forEach(a => console.log('  ⚠  ' + a.onde + ' — ' + a.msg));
erros.forEach(e  => console.log('  ✘  ' + e.onde + ' — ' + e.msg));

if (erros.length) {
    console.log('');
    console.log('  ' + erros.length + ' erro(s) — build bloqueado.' +
                (avisos.length ? '  ' + avisos.length + ' aviso(s).' : ''));
    console.log('');
    process.exit(1);
}

console.log('  Curadoria aprovada' + (avisos.length ? ' com ' + avisos.length + ' aviso(s)' : '') + '.');
console.log('');
process.exit(0);
