import { state, onStateChange, notifyChange } from "../state.js";
import { EMPTY_COMMENT_TEMPLATE } from "../commentFormat.js";
import { goBack } from "../navigation.js";
import { syncBoardToCurrentNode } from "../boardSync.js";
import { playSound } from "../sound.js";

let board = null;
let els = {};

// Etichette leggibili per il tooltip di ciascun NAG — Chessboard.js conosce
// solo simbolo+colore (serve a disegnare il badge), non una descrizione
// testuale, quindi la teniamo qui accanto alla UI che la mostra.
const NAG_LABELS = {
    '$1': 'Buona mossa',
    '$2': 'Imprecisione / errore',
    '$3': 'Mossa brillante',
    '$4': 'Svista (blunder)',
    '$5': 'Mossa interessante',
    '$6': 'Mossa dubbia',
    '$7': 'Mossa forzata/unica',
    '$10': 'Posizione pari',
    '$13': 'Posizione poco chiara',
    '$14': 'Leggero vantaggio bianco',
    '$15': 'Leggero vantaggio nero',
    '$16': 'Vantaggio bianco',
    '$17': 'Vantaggio nero',
    '$18': 'Bianco vincente',
    '$19': 'Nero vincente',
    '$101': 'Buona mossa (stile chess.com)',
    '$102': 'Mossa migliore (stile chess.com)',
};

/**
 * @param {Chessboard} chessboard
 */
export function initEditTab(chessboard) {
    board = chessboard;

    els = {
        commentInput: document.getElementById('comment-editor'),
        btnTemplate: document.getElementById('btn-comment-template'),
        nagPalette: document.getElementById('nag-palette'),
        btnSetMainline: document.getElementById('btn-set-mainline'),
        btnDeleteSubtree: document.getElementById('btn-delete-subtree'),
    };

    els.commentInput.addEventListener('input', onCommentInput);
    els.btnTemplate.addEventListener('click', onTemplateClick);
    els.btnSetMainline.addEventListener('click', onSetMainline);
    els.btnDeleteSubtree.addEventListener('click', onDeleteSubtree);

    buildNagPalette();

    onStateChange(() => {
        refreshCommentInput();
        refreshMainlineButtonState();
        refreshDeleteButtonState();
        refreshNagPaletteSelection();
    });

    refreshCommentInput();
    refreshMainlineButtonState();
    refreshDeleteButtonState();
    refreshNagPaletteSelection();
}

// --- COMMENTO ---
// Editabile anche sulla radice (posizione iniziale): è lì che vivono i tag
// <opening>/<variation> di default ("Starting Position" / "Traditional
// game"), e l'utente deve poter cambiarli (es. in "Chess 960").

function onCommentInput() {
    state.tree.current.setComment(els.commentInput.value);
    notifyChange(); // si riflette subito nel tab analysis
}

function onTemplateClick() {
    els.commentInput.value = EMPTY_COMMENT_TEMPLATE;
    onCommentInput();
    els.commentInput.focus();
}

function refreshCommentInput() {
    // Non tocca il valore mentre l'utente ci sta scrivendo dentro (altrimenti
    // ogni onStateChange scatenato dal proprio stesso "input" sposterebbe il
    // cursore); si aggiorna solo quando il campo NON ha il focus, cioè quando
    // il cambiamento arriva da altrove (es. si è navigato a un'altra mossa).
    if (document.activeElement !== els.commentInput) {
        els.commentInput.value = state.tree.current.comment || '';
    }
}

// --- NAG (disabilitati sulla radice: non ha senso annotare "la mossa"
// della posizione iniziale, che una mossa non è) ---

function buildNagPalette() {
    els.nagPalette.innerHTML = '';

    Object.keys(window.Chessboard.DEFAULT_NAG_INFO).forEach(code => {
        const visual = board.getNagVisual(code);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nag-btn';
        btn.dataset.nag = code;
        btn.title = NAG_LABELS[code] ? `${NAG_LABELS[code]} (${code})` : code;
        btn.style.setProperty('--nag-color', visual.color);
        btn.innerHTML = `<img src="${visual.image}" alt="${code}" />`;
        btn.addEventListener('click', () => onNagClick(code));

        els.nagPalette.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'nag-btn nag-btn-clear';
    clearBtn.title = 'Remove NAG from this move';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', () => onNagClick(null));
    els.nagPalette.appendChild(clearBtn);
}

function onNagClick(code) {
    if (state.tree.isAtRoot()) return; // nessuna mossa su cui mettere un NAG

    // Un solo NAG "principale" per mossa in questa palette: un nuovo click
    // sostituisce quello eventualmente già presente invece di accumularli.
    state.tree.current.clearNag();
    if (code) state.tree.current.addNag(code);

    board.setNag(code || null);
    playSound('nag');
    notifyChange();
}

function refreshNagPaletteSelection() {
    const activeNag = state.tree.current.nag && state.tree.current.nag[0];
    els.nagPalette.querySelectorAll('.nag-btn').forEach(btn => {
        btn.classList.toggle('selected', !!activeNag && btn.dataset.nag === activeNag);
    });
    els.nagPalette.classList.toggle('disabled', state.tree.isAtRoot());
}

// --- RENDI MAINLINE ---
// Sposta il nodo corrente in testa all'array dei figli del genitore: essendo
// children[0] a rappresentare ovunque nell'app (move-list, export PGN,
// avanzamento con la freccetta "avanti") la linea principale, questo unico
// riordino basta a "promuovere" una variante a mainline.

function onSetMainline() {
    const node = state.tree.current;
    if (!node.parent) return; // sulla radice non ha senso

    const idx = node.parent.children.indexOf(node);
    if (idx <= 0) return; // già mainline, o non trovato

    node.parent.children.splice(idx, 1);
    node.parent.children.unshift(node);

    playSound('nag');
    notifyChange();
}

function refreshMainlineButtonState() {
    const node = state.tree.current;
    const isMainlineAlready = !node.parent || node.parent.children[0] === node;
    els.btnSetMainline.disabled = isMainlineAlready;
}

// --- CANCELLAZIONE SOTTOALBERO ---

function onDeleteSubtree() {
    if (state.tree.isAtRoot()) return;

    const nodeToDelete = state.tree.current;
    const parent = nodeToDelete.parent;
    const hasVariations = nodeToDelete.children.length > 0;
    const msg = hasVariations
        ? 'Delete this move and every variation that depends on it?'
        : 'Delete this move?';
    if (!confirm(msg)) return;

    // IMPORTANTE: prima si sposta la posizione (board + albero) sul genitore
    // con la stessa ricostruzione "a salto" usata in tutta l'app — non si può
    // più contare su board.undoMove(), che dipende dallo storico interno di
    // chess.js, storico che un salto precedente (es. click su una mossa nella
    // move-list) potrebbe aver già azzerato. SOLO DOPO si stacca il nodo.
    goBack(board, null);
    parent.removeChild(nodeToDelete);
    syncBoardToCurrentNode(board);
    playSound('delete');
    notifyChange();
}

function refreshDeleteButtonState() {
    els.btnDeleteSubtree.disabled = state.tree.isAtRoot();
}
