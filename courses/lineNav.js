// Navigazione dentro una singola Line (array flat di mosse, senza rami) — la
// controparte semplificata di /reader/navigation.js per il reader
// principale, che invece ricostruisce un ALBERO. Qui basta un indice intero.
//
// Riusa lo stesso approccio del reader principale — "ricostruisci sempre
// dall'inizio con un'istanza chess.js usa-e-getta e applica un solo
// setPosition()" — per lo stesso motivo: chess.js perde la propria history
// interna ad ogni .load() (che board.setPosition() fa), quindi affidarsi a
// undo/redo incrementali dopo un salto arbitrario (es. click sull'outline
// delle sezioni) non è affidabile.

/**
 * @param {Chessboard} board
 * @param {Object} line - { moves: [...] }
 * @param {String|null} startingFen
 * @param {number} index - quante mosse della linea sono state giocate
 * @returns {boolean} true se la ricostruzione è andata a buon fine
 */
export function rebuildToIndex(board, line, startingFen, index) {
    if (typeof window.Chess !== 'function') return false;

    const scratch = startingFen ? new window.Chess(startingFen) : new window.Chess();
    let lastMoveResult = null;

    for (let i = 0; i < index; i++) {
        const moveEntry = line.moves[i];
        if (!moveEntry) return false;
        lastMoveResult = scratch.move(moveEntry.move);
        if (!lastMoveResult) return false;
    }

    const lastMove = lastMoveResult ? { from: lastMoveResult.from, to: lastMoveResult.to } : null;
    board.setPosition(index > 0 ? scratch.fen() : (startingFen || 'start'), lastMove);
    return true;
}

/**
 * Verifica se `san`, giocata nella posizione ATTUALE della board, è legale —
 * usato per validare le mosse in fase di registrazione (linea o preview)
 * senza doverle prima applicare alla board vera.
 *
 * @param {Chessboard} board
 * @param {String} san
 * @returns {{from:String,to:String}|null}
 */
export function sanToFromTo(board, san) {
    if (!board.game || typeof window.Chess !== 'function') return null;
    const scratch = new window.Chess(board.game.fen());
    const result = scratch.move(san);
    return result ? { from: result.from, to: result.to } : null;
}
