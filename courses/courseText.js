// Rende il testo di una mossa (campo MoveEntry.text) in HTML, trasformando i
// token [[preview:ID|Etichetta bottone]] in bottoni cliccabili che avviano
// una digressione temporanea (vedi studyPlayback.js). Il resto del testo è
// semplice testo libero, sempre HTML-escaped — niente altro markup: la
// formattazione ricca non è lo scopo di questo campo, la chiarezza sì.
//
// L'autore non scrive mai il token a mano: lo inserisce il bottone "Insert
// line preview" del tab EDIT (vedi editTab.js), che si occupa anche di
// generare un id univoco e di avviare la registrazione della preview stessa.

const PREVIEW_TOKEN = /\[\[preview:([a-zA-Z0-9_-]+)\|([^\]]*)\]\]/g;

/**
 * @param {String} text
 * @returns {String} HTML pronto per innerHTML
 */
export function renderMoveText(text) {
    if (!text) return '';

    let html = '';
    let lastIndex = 0;
    let match;
    PREVIEW_TOKEN.lastIndex = 0;

    while ((match = PREVIEW_TOKEN.exec(text)) !== null) {
        html += escapeHTML(text.slice(lastIndex, match.index));
        const [, id, label] = match;
        html += `<button type="button" class="preview-btn" data-preview-id="${escapeAttr(id)}">&#9654; ${escapeHTML(label)}</button>`;
        lastIndex = PREVIEW_TOKEN.lastIndex;
    }
    html += escapeHTML(text.slice(lastIndex));

    return html.replace(/\n/g, '<br>');
}

/**
 * Inserisce un nuovo token preview nel testo grezzo, alla posizione del
 * cursore data.
 *
 * @param {String} text
 * @param {number} cursorPos
 * @param {String} id
 * @param {String} label
 * @returns {String}
 */
export function insertPreviewToken(text, cursorPos, id, label) {
    const token = `[[preview:${id}|${label}]]`;
    return text.slice(0, cursorPos) + token + text.slice(cursorPos);
}

/**
 * @param {String} text
 * @returns {String[]} tutti gli id di preview referenziati nel testo
 */
export function extractPreviewIds(text) {
    if (!text) return [];
    const ids = [];
    let match;
    PREVIEW_TOKEN.lastIndex = 0;
    while ((match = PREVIEW_TOKEN.exec(text)) !== null) ids.push(match[1]);
    return ids;
}

/**
 * @returns {String} id breve, univoco a sufficienza per un singolo documento
 */
export function generatePreviewId() {
    return 'p' + Math.random().toString(36).slice(2, 8);
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
}
