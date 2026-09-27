// Modello dati di un corso (.pgnc) e (de)serializzazione JSON.
//
// A differenza dei PGN "puri" letti/scritti da /reader/PGNReader.js (usati
// dal reader principale su un MoveTree ad albero), qui il formato è JSON e
// ogni Linea (Line) è FLAT, senza rami: le uniche diramazioni possibili sono
// le "preview" agganciate a singole mosse (vedi courseText.js +
// studyPlayback.js), che sono digressioni temporanee di sola lettura, mai
// vere e proprie continuazioni della linea.
//
// Struttura di un documento .pgnc:
//
// {
//   version: 1,
//   meta: { title, editable, startingFen, side },   // side: 'white' | 'black'
//   progress: { sectionPath: [0,1], moveIndex: 3 },
//   sections: [
//     { type: 'section', title, children: [ Section | Line, ... ] },
//     { type: 'line', title, moves: [ MoveEntry, ... ] },
//   ]
// }
//
// MoveEntry:
// { move, skip, text, nag: [], arrows: [{from,to}], highlights: [sq],
//   previews: { id: { label, moves: [MoveEntry, ...] } } }
//
// Le mosse dentro una preview sono a loro volta MoveEntry (possono avere
// testo e persino skip proprio), ma MAI un campo `previews` a loro volta:
// una preview non può contenere un'altra preview, per tenere la UI di
// registrazione semplice e senza livelli di annidamento da gestire.
//
// meta.editable NON è (più) una spunta libera: è derivato dall'ESTENSIONE del
// file caricato/esportato — .pgnce = editabile, .pgnc = corso "chiuso" per lo
// studente (vedi ui/fileTab.js). Viene comunque salvato anche nel JSON così
// lo stato resta coerente subito dopo la creazione di un corso nuovo, prima
// di qualunque salvataggio su disco.

export const PGNC_VERSION = 1;

export function createEmptyCourse(title = 'Untitled course') {
    return {
        version: PGNC_VERSION,
        meta: { title, editable: true, startingFen: null, side: 'white' },
        progress: { sectionPath: [], moveIndex: 0 },
        sections: [],
    };
}

export function createSection(title) {
    return { type: 'section', title, children: [] };
}

export function createLine(title) {
    return { type: 'line', title, moves: [] };
}

export function createMove(move, opts = {}) {
    const { skip = false, text = '', nag = [], arrows = [], highlights = [], previews = {} } = opts;
    return { move, skip, text, nag, arrows, highlights, previews };
}

/**
 * @param {String} json
 * @returns {Object} course
 */
export function parseCourse(json) {
    let course;
    try {
        course = JSON.parse(json);
    } catch (err) {
        throw new Error('Invalid .pgnc file: not valid JSON.');
    }
    if (!course || !Array.isArray(course.sections)) {
        throw new Error('Invalid .pgnc file: missing "sections" array.');
    }
    course.meta = course.meta || {};
    if (typeof course.meta.title !== 'string') course.meta.title = 'Untitled course';
    course.meta.editable = course.meta.editable !== false;
    course.meta.startingFen = course.meta.startingFen || null;
    course.meta.side = course.meta.side === 'black' ? 'black' : 'white';
    course.progress = course.progress || { sectionPath: [], moveIndex: 0 };
    course.progress.sectionPath = course.progress.sectionPath || [];
    course.progress.moveIndex = course.progress.moveIndex || 0;
    return course;
}

/**
 * @param {Object} course
 * @returns {String}
 */
export function serializeCourse(course) {
    return JSON.stringify(course, null, 2);
}

// --- Navigazione dell'outline (sections/children annidati) ---

/**
 * Risolve un "sectionPath" (array di indici, uno per livello di annidamento)
 * nel nodo Section/Line puntato.
 *
 * @param {Object} course
 * @param {number[]} path
 * @returns {Object|null}
 */
export function resolvePath(course, path) {
    let node = { type: 'root', children: course.sections };
    for (const idx of path) {
        if (!node.children || !node.children[idx]) return null;
        node = node.children[idx];
    }
    return node;
}

/**
 * Trova la prima Line raggiungibile a partire da un nodo dell'outline: se il
 * nodo è già una Line, ritorna quella; se è una Section (o la radice),
 * scende nel primo figlio finché non trova una Line. Utile per "click su una
 * Section nell'outline" o per aprire il corso sulla primissima linea.
 *
 * @param {Object} node
 * @param {number[]} [basePath]
 * @returns {{node: Object, path: number[]}|null}
 */
export function firstLineFrom(node, basePath = []) {
    if (!node) return null;
    if (node.type === 'line') return { node, path: basePath };
    for (let i = 0; i < (node.children || []).length; i++) {
        const found = firstLineFrom(node.children[i], [...basePath, i]);
        if (found) return found;
    }
    return null;
}

/**
 * Elenca in ordine (depth-first) tutte le Line del corso, col proprio path
 * completo e la profondità di annidamento — usato dal pannello sezioni per
 * costruire l'outline piatto-ma-indentato senza dover ricorrere ricorsivamente
 * anche lì.
 *
 * @param {Object} course
 * @returns {{node: Object, path: number[], depth: number, isLine: boolean}[]}
 */
export function flattenOutline(course) {
    const out = [];
    (function walk(children, base, depth) {
        children.forEach((child, i) => {
            const path = [...base, i];
            const isLine = child.type === 'line';
            out.push({ node: child, path, depth, isLine });
            if (!isLine) walk(child.children || [], path, depth + 1);
        });
    })(course.sections, [], 0);
    return out;
}

/**
 * @param {Object} course
 * @param {number[]} path
 * @returns {{node: Object, path: number[]}|null} la Line successiva rispetto
 *          a quella indicata (depth-first), o null se era l'ultima
 */
export function nextLine(course, path) {
    const lines = flattenOutline(course).filter(e => e.isLine);
    const idx = lines.findIndex(e => samePath(e.path, path));
    if (idx === -1 || idx === lines.length - 1) return null;
    return lines[idx + 1];
}

function samePath(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}
