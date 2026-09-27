import { createEmptyCourse } from "./Course.js";

/**
 * Stato centrale del reader-corsi, sullo stesso pattern di /reader/state.js
 * (listener + notifyChange) ma con dati più semplici: qui non c'è un albero,
 * solo un documento .pgnc e "dove ci si trova dentro di esso".
 *
 * - course: l'intero documento .pgnc caricato
 * - currentPath: sectionPath (array di indici) della Line attualmente aperta
 * - currentIndex: quante mosse di quella Line sono state giocate (0 = inizio linea)
 * - mode: 'EDIT' | 'STUDY'
 * - preview: null, oppure { label, moves, stepIndex, playing } mentre si sta
 *   guardando una digressione temporanea agganciata alla mossa corrente
 * - recording: null, oppure { id, label } mentre in EDIT si sta registrando
 *   una nuova preview (le mosse giocate finiscono nella preview, non nella linea)
 */
export const state = {
    course: createEmptyCourse(),
    currentPath: [],
    currentIndex: 0,
    mode: 'EDIT',
    preview: null,
    recording: null,
};

const listeners = new Set();

export function onStateChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function notifyChange() {
    listeners.forEach(fn => fn(state));
}

/**
 * @param {Object} course
 * @param {{path:number[], index:number}} [openAt] - dove aprire il corso;
 *        default: il progresso salvato nel file stesso
 */
export function setCourse(course, openAt = null) {
    state.course = course;
    state.currentPath = openAt ? openAt.path : (course.progress.sectionPath || []);
    state.currentIndex = openAt ? openAt.index : (course.progress.moveIndex || 0);
    state.preview = null;
    state.recording = null;
    state.mode = course.meta.editable ? 'EDIT' : 'STUDY';
    notifyChange();
}

export function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    state.preview = null;
    state.recording = null;
    notifyChange();
}

/**
 * Sposta il "cursore" su un'altra Line/indice e salva subito il progresso
 * nel documento in memoria (persistito su disco solo al download, come il
 * resto del corso: niente backend, il file .pgnc È il salvataggio).
 *
 * @param {number[]} path
 * @param {number} index
 */
export function setPosition(path, index) {
    state.currentPath = path;
    state.currentIndex = index;
    state.preview = null;
    state.course.progress.sectionPath = path;
    state.course.progress.moveIndex = index;
    notifyChange();
}

export function setPreview(preview) {
    state.preview = preview;
    notifyChange();
}

export function setRecording(recording) {
    state.recording = recording;
    notifyChange();
}

/**
 * @returns {Object|null} la Line attualmente aperta (risolta da currentPath)
 */
export function currentLine() {
    let node = { children: state.course.sections };
    for (const idx of state.currentPath) {
        if (!node.children || !node.children[idx]) return null;
        node = node.children[idx];
    }
    return node && node.type === 'line' ? node : null;
}

/**
 * @returns {Object|null} la mossa corrente (quella appena giocata), o null se
 *          si è all'inizio della linea
 */
export function currentMove() {
    const line = currentLine();
    if (!line || state.currentIndex === 0) return null;
    return line.moves[state.currentIndex - 1] || null;
}
