import { lookupOpening } from "./eco.js";

/**
 * Il commento di una mossa può contenere un piccolo set di tag custom per
 * dargli uno stile in fase di visualizzazione:
 *
 *   <opening>Difesa Siciliana</opening>
 *   <variation>Variante Najdorf</variation>
 *   <line>6. Be3</line>
 *   <content>Testo libero del commento...</content>
 *
 * Non è PGN standard: è un formato interno di questa app. Il tab EDIT modifica
 * direttamente il testo grezzo (con i tag); il tab ANALYSIS lo interpreta e lo
 * mostra con uno stile diverso per ciascuna parte. Un commento senza nessun tag
 * riconosciuto viene trattato per intero come "content" libero, così i PGN
 * importati da altre fonti (commenti semplici tra graffe) restano leggibili.
 */

const TAGS = ['opening', 'variation', 'line', 'content'];

/**
 * @param {String} raw - il commento grezzo così com'è salvato sul nodo
 * @returns {{opening: String, variation: String, line: String, content: String}}
 */
export function parseComment(raw) {
    const parts = { opening: '', variation: '', line: '', content: '' };
    if (!raw) return parts;

    // I tag di metadato (frecce/evidenziazioni salvate, vedi più sotto) non
    // vanno mai considerati come "testo del commento": li togliamo prima di
    // decidere se il resto va mostrato come contenuto libero.
    const visibleRaw = raw
        .replace(/<arrows>[\s\S]*?<\/arrows>/i, '')
        .replace(/<highlights>[\s\S]*?<\/highlights>/i, '');

    let foundAny = false;
    for (const tag of TAGS) {
        const match = visibleRaw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
        if (match) {
            parts[tag] = match[1].trim();
            foundAny = true;
        }
    }

    // Nessun tag riconosciuto: tratta l'intero commento (al netto dei metadati)
    // come testo libero.
    if (!foundAny && visibleRaw.trim()) {
        parts.content = visibleRaw.trim();
    }

    return parts;
}

/**
 * @param {String} raw
 * @returns {boolean} true se non c'è alcun contenuto (nessuna parte non vuota)
 */
export function isCommentEmpty(raw) {
    const parts = parseComment(raw);
    return !parts.opening && !parts.variation && !parts.line && !parts.content;
}

/**
 * Estrae solo il testo libero (tag <content>, o l'intero commento se privo
 * di tag riconosciuti) da un commento grezzo, scartando opening/variation/
 * line e i metadati arrows/highlights. Usato dall'export "pulito" del PGN
 * (vedi PGNReader.write con l'opzione clean), che non deve MAI contenere le
 * frecce/evidenziazioni disegnate a mano né i nomi apertura auto-generati —
 * solo le note scritte davvero dall'utente.
 *
 * @param {String} raw
 * @returns {String}
 */
export function extractContentOnly(raw) {
    if (!raw) return '';
    return parseComment(raw).content || '';
}

/**
 * Costruisce l'HTML da mostrare nel tab analysis a partire dal commento
 * grezzo. Ogni parte presente diventa un elemento con la propria classe CSS
 * (cb-comment-opening, cb-comment-variation, cb-comment-line,
 * cb-comment-content) così lo stile si definisce tutto in CSS.
 *
 * Se <opening>/<variation> non sono compilati (tag assente o vuoto), il buco
 * viene riempito automaticamente cercando la posizione nel database ECO
 * (vedi eco.js): serve la sequenza di mosse dalla radice fino a questo nodo.
 * Se non si trova nulla (posizione fuori teoria, Chess960, ecc.) il nome
 * dell'apertura mostra "Unknown opening" in stile smorzato, per segnalare
 * chiaramente che non è un dato compilato — mai un campo che sembra "vero"
 * ma è in realtà un placeholder silenzioso. Il codice ECO (es. "B12") non
 * viene invece più auto-compilato: è un riferimento da database, non
 * un'informazione utile a chi studia — <line> resta disponibile solo se
 * scritta a mano.
 *
 * @param {String} raw
 * @param {String[]} [sanPath] - mosse SAN dalla radice al nodo corrente,
 *        usate solo per l'eventuale auto-fill dal database ECO
 * @returns {String} HTML (stringa vuota se non c'è nulla da mostrare)
 */
export function renderCommentHTML(raw, sanPath = []) {
    const parts = parseComment(raw);
    const blocks = [];

    const needsOpening = !parts.opening;
    const needsVariation = !parts.variation;
    const ecoMatch = (needsOpening || needsVariation)
        ? lookupOpening(sanPath)
        : null;

    let openingText = parts.opening;
    let openingIsFallback = false;
    if (needsOpening) {
        if (ecoMatch) {
            openingText = ecoMatch.family;
        } else {
            openingText = 'Unknown opening';
            openingIsFallback = true;
        }
    }

    let variationText = parts.variation;
    if (needsVariation && ecoMatch && ecoMatch.subVariation) {
        variationText = ecoMatch.subVariation;
    }

    // Il codice ECO (es. "B12") non viene più auto-compilato qui: è un
    // riferimento da database che non serve a chi studia — la riga <line>
    // resta disponibile solo se scritta a mano dall'utente.
    const lineText = parts.line;

    if (openingText) {
        const cls = openingIsFallback
            ? 'cb-comment-opening cb-comment-opening-fallback'
            : 'cb-comment-opening';
        blocks.push(`<div class="${cls}">${escapeHTML(openingText)}</div>`);
    }
    if (variationText) blocks.push(`<div class="cb-comment-variation">${escapeHTML(variationText)}</div>`);
    if (lineText) blocks.push(`<div class="cb-comment-line">${escapeHTML(lineText)}</div>`);
    if (parts.content) blocks.push(`<div class="cb-comment-content">${escapeHTML(parts.content)}</div>`);

    return blocks.join('');
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Template vuoto proposto quando si inizia a scrivere il commento di una mossa
 * da zero nel tab EDIT.
 */
export const EMPTY_COMMENT_TEMPLATE =
`<opening></opening>

<variation></variation>

<line></line>

<content>

</content>`;

// --- METADATI: frecce ed evidenziazioni disegnate a mano ---
//
// Oltre ai tag "di contenuto" sopra, un commento può contenere due tag di
// puro metadato — mai mostrati nel tab analysis, solo usati per ricordare
// cosa avevi disegnato a mano sulla scacchiera quando eri su questa mossa:
//
//   <arrows>e2e4;g1f3</arrows>       (coppie "dacasellaacasella", senza separatore interno)
//   <highlights>e4;f6</highlights>   (caselle, separate da ;)

/**
 * @param {String} raw
 * @returns {{from: String, to: String}[]}
 */
export function parseArrows(raw) {
    if (!raw) return [];
    const match = raw.match(/<arrows>([\s\S]*?)<\/arrows>/i);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(';').filter(Boolean).map(pair => ({
        from: pair.slice(0, 2),
        to: pair.slice(2, 4),
    }));
}

/**
 * @param {String} raw
 * @returns {String[]}
 */
export function parseHighlights(raw) {
    if (!raw) return [];
    const match = raw.match(/<highlights>([\s\S]*?)<\/highlights>/i);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(';').filter(Boolean);
}

/**
 * Aggiorna (o aggiunge, se assenti) i tag <arrows>/<highlights> dentro un
 * commento grezzo, lasciando invariato tutto il resto (opening/variation/
 * line/content, ed eventuali altri tag già presenti).
 *
 * @param {String} raw
 * @param {{from: String, to: String}[]} arrows
 * @param {String[]} highlights
 * @returns {String}
 */
export function saveArrowsAndHighlights(raw, arrows, highlights) {
    const arrowsStr = arrows.map(a => `${a.from}${a.to}`).join(';');
    const highlightsStr = highlights.join(';');

    let updated = upsertTag(raw || '', 'arrows', arrowsStr);
    updated = upsertTag(updated, 'highlights', highlightsStr);
    return updated;
}

function upsertTag(raw, tag, content) {
    const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'i');
    const newTag = `<${tag}>${content}</${tag}>`;
    if (re.test(raw)) return raw.replace(re, newTag);
    return raw ? `${raw}\n${newTag}` : newTag;
}
