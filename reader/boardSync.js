import { state } from "./state.js";
import { parseArrows, parseHighlights } from "./commentFormat.js";
import { sanToFromTo } from "./navigation.js";

const DRILL_HINT_DELAY_MS = 30000;

let moveArrowsEnabled = true;
let hintTimeoutId = null;

/**
 * Attiva/disattiva del tutto le frecce che indicano le mosse conosciute dal
 * PGN da questa posizione (quelle blu) — a qualcuno possono dare fastidio.
 *
 * @param {boolean} value
 */
export function setMoveArrowsEnabled(value) {
    moveArrowsEnabled = value;
}

export function areMoveArrowsEnabled() {
    return moveArrowsEnabled;
}

/**
 * Da richiamare ogni volta che state.tree.current cambia, qualunque sia il
 * motivo (mossa, undo, salto a un nodo dalla move-list, mossa del pc in
 * drill, cambio dell'intero albero...). Un unico punto invece di ripetere
 * questa logica in ogni chiamante:
 *
 * - ripristina il NAG della mossa corrente (la board lo azzera ad ogni
 *   spostamento di posizione, va sempre re-impostato esplicitamente);
 * - ripristina le frecce/evidenziazioni salvate nel commento del nodo;
 * - ridisegna le frecce "derivate" (colore diverso) che indicano le mosse
 *   conosciute da questa posizione, come nello study mode di lichess — a
 *   meno che l'utente le abbia disattivate, o si sia in modalità drill (dove
 *   mostrerebbero subito la risposta): lì restano nascoste per 30 secondi,
 *   poi compaiono come suggerimento per chi è bloccato.
 *
 * @param {Chessboard} board
 */
export function syncBoardToCurrentNode(board) {
    const node = state.tree.current;

    const nag = node.nag && node.nag[0];
    board.setNag(nag || null);

    // In drill le frecce/evidenziazioni salvate (gialle) darebbero indizi non
    // richiesti sulla mossa "giusta" — restano nascoste in quella modalità.
    if (state.mode === 'DRILL') {
        board.setArrows([]);
        board.setCustomHighlights([]);
    } else {
        board.setArrows(parseArrows(node.comment));
        board.setCustomHighlights(parseHighlights(node.comment));
    }

    updateAvailableMoveArrows(board);
}

function updateAvailableMoveArrows(board) {
    if (hintTimeoutId) {
        clearTimeout(hintTimeoutId);
        hintTimeoutId = null;
    }

    if (!moveArrowsEnabled) {
        board.clearAvailableMoveArrows();
        return;
    }

    if (state.mode === 'DRILL') {
        board.clearAvailableMoveArrows();
        hintTimeoutId = setTimeout(() => {
            hintTimeoutId = null;
            drawAvailableMoveArrows(board);
        }, DRILL_HINT_DELAY_MS);
        return;
    }

    drawAvailableMoveArrows(board);
}

function drawAvailableMoveArrows(board) {
    const node = state.tree.current;
    const availableMoves = node.children
        .map(child => sanToFromTo(board, child.move))
        .filter(Boolean);
    board.showAvailableMoveArrows(availableMoves);
}
