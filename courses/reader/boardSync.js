import { state, currentLine } from "./state.js";

// La board azzera NAG, frecce ed evidenziazioni ad ogni cambio di posizione
// (vedi /reader/boardSync.js, che fa lo stesso per il reader ad albero): vanno
// quindi ri-applicate ogni volta che cambia la mossa mostrata, che si arrivi
// lì con i bottoni, la tastiera, l'outline, uno skip automatico o una preview.

/**
 * Applica alla board NAG, frecce ed evidenziazioni salvati su una mossa
 * (`null` = nessuna mossa, es. inizio linea: la board viene ripulita).
 * setArrows/setCustomHighlights sono "silenziosi": non scatenano
 * onAnnotationChange, quindi non si ri-salvano su se stessi.
 *
 * @param {Chessboard} board
 * @param {Object|null} move - MoveEntry
 */
export function applyMoveAnnotations(board, move) {
    const nag = move && move.nag && move.nag[0];
    board.setNag(nag || null);
    board.setArrows((move && move.arrows) || []);
    board.setCustomHighlights((move && move.highlights) || []);
}

/**
 * Come sopra, ma per la mossa della linea principale su cui ci si trova ora.
 *
 * @param {Chessboard} board
 */
export function syncBoardToCurrentMove(board) {
    const line = currentLine();
    const move = line && state.currentIndex > 0 ? line.moves[state.currentIndex - 1] : null;
    applyMoveAnnotations(board, move);
}
