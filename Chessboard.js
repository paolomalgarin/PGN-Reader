/**
 * PGN Reader board controller backed by cm-chessboard.
 *
 * cm-chessboard owns the SVG board, piece set, pointer interaction and move
 * animations. This adapter keeps the legacy API used by the PGN reader and
 * courses views (chess.js state, premoves, annotations and Stockfish).
 */
import {
    Chessboard as CmChessboard,
    COLOR as CM_COLOR,
    INPUT_EVENT_TYPE
} from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.15.4/src/Chessboard.js';

const CM_ASSETS_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.15.4/assets/';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MOVE_DOTS_STORAGE_KEY = 'pgn-reader-show-move-dots';

function readMoveDotsPreference() {
    try {
        const saved = localStorage.getItem(MOVE_DOTS_STORAGE_KEY);
        return saved === null ? true : saved === 'true';
    } catch (_) {
        return true;
    }
}

const DEFAULT_COLORS = {
    selected: 'var(--chess-last-move-light, #4f91b5)',
    lastMove: 'var(--chess-last-move-light, #4f91b5)',
    suggestion: 'rgba(17, 0, 28, 0.38)',
    customHighlight: 'var(--chess-annotation, #00e676)',
    manualArrow: 'var(--chess-manual-arrow, #00c875)',
    pgnArrow: 'var(--chess-pgn-arrow, #d3c9d3)',
    premove: 'var(--chess-highlight-dark, #00b866)',
    nag: {}
};

const DEFAULT_NAG_INFO = {
    '$3':   { symbol: '!!',     color: '#1baca6' },
    '$1':   { symbol: '!',      color: '#5c8bb0' },
    '$102': { icon: 'star',     color: '#81b64c' },
    '$101': { icon: 'thumbsup', color: '#96bc4b' },
    '$6':   { symbol: '?!',     color: '#f0c33d' },
    '$2':   { symbol: '?',      color: '#e6912c' },
    '$4':   { symbol: '??',     color: '#fa412d' },
    '$5':   { symbol: '!?',     color: '#3593d6' },
    '$7':   { symbol: '➡',      color: '#6fa06f' },
    '$10':  { symbol: '=',      color: '#8a8a8a' },
    '$13':  { symbol: '∞',      color: '#5c7cba' },
    '$14':  { symbol: '⩲',      color: '#9aa5ab' },
    '$15':  { symbol: '⩱',      color: '#9aa5ab' },
    '$16':  { symbol: '±',      color: '#4c8f3c' },
    '$17':  { symbol: '∓',      color: '#a34a4a' },
    '$18':  { symbol: '+−',     color: '#2f6e26' },
    '$19':  { symbol: '−+',     color: '#7a2e2e' }
};

class Chessboard {
    constructor(containerSelector, config = {}) {
        this.container = typeof containerSelector === 'string'
            ? document.querySelector(containerSelector)
            : containerSelector;
        if (!this.container) throw new Error('Contenitore della scacchiera non trovato.');

        this.config = {
            ...config,
            colors: {
                ...DEFAULT_COLORS,
                ...(config.colors || {}),
                nag: { ...DEFAULT_COLORS.nag, ...(config.colors?.nag || {}) }
            },
            images: {
                nags: { ...(config.images?.nags || {}) }
            },
            showSuggestions: config.showSuggestions === undefined
                ? readMoveDotsPreference()
                : config.showSuggestions !== false,
            orientation: config.orientation || 'white'
        };

        this.onMoveCallback = null;
        this.onAnnotationChange = null;
        this.engine = null;
        this.engineMessageQueue = [];
        this.calculationCallback = null;
        this.game = null;
        this.cmBoard = null;
        this.highlightLayer = null;
        this.arrowLayer = null;
        this.errorLayer = null;
        this.brilliantBoardLayer = null;
        this.brilliantDimLayer = null;
        this.brilliantLayer = null;
        this._brilliantNagPending = false;
        this._brilliantToken = 0;
        this._brilliantMovePending = false;
        this._pendingPositionTimer = null;
        this._pendingPositionToken = 0;
        this.showNags = this.config.showNags !== false;
        this.selectedSquare = null;
        this.lastMove = null;
        this.currentNag = null;
        this._lastRenderedCheckSquare = null;
        this._checkCrownImage = null;
        this._checkCrownAnimationActive = false;
        this._checkCrownAnimationTimer = null;
        this.arrowsMap = new Map();
        this.availableMoveArrowsMap = new Map();
        this.customHighlights = new Set();
        this.premoveColor = null;
        this.premoveQueue = [];
        this.pendingPromotion = null;
        this.drawingArrowFrom = null;
        this.isFlipped = this.config.orientation === 'black';
        this._nagImageCache = new Map();
        this._pendingInputMove = null;
        this._pendingPremoveFlush = false;

        this._initLogic().then(() => {
            this._initDOM();
            this._initEngine();
            this.render();
        }).catch((error) => {
            console.error('Impossibile inizializzare la scacchiera:', error);
            this.container.textContent = 'Errore durante il caricamento della scacchiera.';
        });
    }

    async _initLogic() {
        if (typeof window.Chess !== 'function') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error('Caricamento di chess.js non riuscito.'));
                document.head.appendChild(script);
            });
        }
        this.game = new window.Chess();
    }

    _initDOM() {
        this.container.classList.add('pgn-cm-board');
        this.cmBoard = new CmChessboard(this.container, {
            position: this.game.fen(),
            orientation: this.isFlipped ? CM_COLOR.black : CM_COLOR.white,
            assetsUrl: CM_ASSETS_URL,
            assetsCache: true,
            style: {
                cssClass: 'default',
                showCoordinates: true,
                borderType: 'none',
                aspectRatio: 1,
                pieces: {
                    type: 'svgSprite',
                    file: 'pieces/staunty.svg',
                    tileSize: 40
                },
                animationDuration: 260
            }
        });

        // Keep highlights below pieces and arrows above them in cm-chessboard's
        // own SVG coordinate system. This keeps annotations aligned on resize
        // and when the orientation changes.
        const view = this.cmBoard.view;
        const svg = view.svg;
        this.highlightLayer = document.createElementNS(SVG_NS, 'g');
        this.highlightLayer.setAttribute('class', 'pgn-board-highlights');
        svg.insertBefore(this.highlightLayer, view.piecesLayer);

        this.arrowLayer = document.createElementNS(SVG_NS, 'g');
        this.arrowLayer.setAttribute('class', 'pgn-board-arrows');
        svg.insertBefore(this.arrowLayer, view.markersTopLayer);

        this.errorLayer = document.createElementNS(SVG_NS, 'g');
        this.errorLayer.setAttribute('class', 'pgn-board-errors');
        svg.appendChild(this.errorLayer);

        // Il path luminoso sta sopra le caselle ma sotto i pezzi, così i
        // pezzi non vengono coperti dal verde delle tessere.
        this.brilliantBoardLayer = document.createElementNS(SVG_NS, 'g');
        this.brilliantBoardLayer.setAttribute('class', 'pgn-brilliant-board-layer');
        svg.insertBefore(this.brilliantBoardLayer, view.piecesLayer);

        // L'overlay scuro sta sopra i pezzi. Una maschera SVG apre soltanto
        // il percorso (a tempo) e la finestra mobile del pezzo celebrato.
        this.brilliantDimLayer = document.createElementNS(SVG_NS, 'g');
        this.brilliantDimLayer.setAttribute('class', 'pgn-brilliant-dim-layer');
        svg.appendChild(this.brilliantDimLayer);

        // Badge celebrativo sopra tutti i layer, indipendente dalla scacchiera.
        this.brilliantLayer = document.createElementNS(SVG_NS, 'g');
        this.brilliantLayer.setAttribute('class', 'pgn-brilliant-layer');
        svg.appendChild(this.brilliantLayer);

        this.cmBoard.enableMoveInput((event) => this._handleCmMoveInput(event));

        this._onRightPointerDown = (event) => {
            if (event.button !== 2) return;
            const square = event.target?.closest?.('[data-square]')?.getAttribute('data-square');
            this.drawingArrowFrom = square || null;
            event.preventDefault();
            event.stopPropagation();
        };
        this._onRightPointerUp = (event) => {
            if (event.button !== 2 || !this.drawingArrowFrom) return;
            const to = event.target?.closest?.('[data-square]')?.getAttribute('data-square');
            const from = this.drawingArrowFrom;
            this.drawingArrowFrom = null;
            if (!to) return;
            if (from === to) this._toggleCustomHighlight(to);
            else this.drawArrow(from, to);
            event.preventDefault();
            event.stopPropagation();
        };
        this._onContextMenu = (event) => event.preventDefault();
        this.container.addEventListener('pointerdown', this._onRightPointerDown, true);
        document.addEventListener('pointerup', this._onRightPointerUp, true);
        this.container.addEventListener('contextmenu', this._onContextMenu);

        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                // cm-chessboard updates its own SVG metrics in the same resize
                // cycle; refresh our overlays on the next paint.
                window.requestAnimationFrame(() => this.render());
            });
            this._resizeObserver.observe(this.container);
        }
    }

    _handleCmMoveInput(event) {
        switch (event.type) {
            case INPUT_EVENT_TYPE.moveInputStarted: {
                const piece = this.game.get(event.squareFrom);
                if (!piece || (piece.color !== this.game.turn() && piece.color !== this.premoveColor)) {
                    return false;
                }
                this.selectedSquare = event.squareFrom;
                this.clearArrows();
                this.clearCustomHighlights();
                if (this.config.showSuggestions && piece.color === this.game.turn()) {
                    this._showSuggestions(event.squareFrom);
                } else {
                    this.render();
                }
                return true;
            }
            case INPUT_EVENT_TYPE.validateMoveInput: {
                const { squareFrom: from, squareTo: to } = event;
                const piece = this.game.get(from);
                if (!piece) return false;

                // A premove is stored, not committed to the game position.
                if (this.premoveColor && piece.color === this.premoveColor && piece.color !== this.game.turn()) {
                    this._queuePremove(from, to);
                    return false;
                }

                const candidate = this.game.moves({ square: from, verbose: true })
                    .filter(move => move.to === to);
                if (!candidate.length) return false;

                if (candidate.some(move => move.promotion)) {
                    this._showPromotionMenu(from, to);
                    return false;
                }

                const move = this.game.move({ from, to });
                if (!move) return false;
                this._afterMovePrepared(move);
                this._pendingInputMove = move;
                this._pendingPremoveFlush = !!(this.premoveColor && this.game.turn() === this.premoveColor && this.premoveQueue.length);
                // Lascia a cm-chessboard la posizione SVG precedente: nel
                // moveInputFinished la aggiorniamo con setPosition(animated)
                // per animare anche il completamento dei trascinamenti.
                return false;
            }
            case INPUT_EVENT_TYPE.moveInputFinished: {
                this.selectedSquare = null;
                if (this._pendingInputMove) {
                    const move = this._pendingInputMove;
                    const shouldFlushPremove = this._pendingPremoveFlush;
                    const moveFen = this.game.fen();
                    this._pendingInputMove = null;
                    this._pendingPremoveFlush = false;

                    // Prima aggiorniamo il modello e le annotazioni. Se la mossa
                    // è Brilliant, setNag() prende il controllo della vista e
                    // fa partire UN SOLO movimento dopo aver costruito il path.
                    if (this.onMoveCallback) this.onMoveCallback(move);

                    // Il callback può aver annullato/rifiutato la mossa (es. Drill)
                    // oppure aver avviato la sequenza Brilliant.
                    if (this.game.fen() !== moveFen) {
                        this.render();
                    } else if (!this._brilliantMovePending) {
                        this._cancelPendingPositionSync();
                        Promise.resolve(this.cmBoard.setPosition(moveFen, true)).then(() => this.render());
                    }
                    if (shouldFlushPremove && this.game.fen() === moveFen) {
                        const delay = this._brilliantMovePending ? 2500 : 0;
                        window.setTimeout(() => this._flushNextPremove(), delay);
                    }
                } else {
                    this.render();
                }
                return true;
            }
            case INPUT_EVENT_TYPE.moveInputCanceled:
                this.selectedSquare = null;
                this.render();
                return true;
            case INPUT_EVENT_TYPE.movingOverSquare:
                return true;
            default:
                return true;
        }
    }

    _afterMovePrepared(move) {
        // La nuova posizione verrà sincronizzata subito dopo da cm-chessboard.
        this._clearBrilliantAnimation(false);
        this.selectedSquare = null;
        this.lastMove = { from: move.from, to: move.to };
        this.currentNag = null;
        this.arrowsMap.clear();
        this.availableMoveArrowsMap.clear();
        this.customHighlights.clear();
        this.render();
    }

    _squareTopLeft(square) {
        if (!this.cmBoard?.view || !/^[a-h][1-8]$/.test(square || '')) return null;
        return this.cmBoard.view.squareToPoint(square);
    }

    _squareCenter(square) {
        const topLeft = this._squareTopLeft(square);
        if (!topLeft) return null;
        const { squareWidth, squareHeight } = this.cmBoard.view;
        return { x: topLeft.x + squareWidth / 2, y: topLeft.y + squareHeight / 2 };
    }

    _squareIsLight(square) {
        const file = square.charCodeAt(0) - 97;
        const rank = Number(square[1]) - 1;
        return (file + rank) % 2 === 1;
    }

    _appendSquareHighlight(square, kind = 'custom') {
        const point = this._squareTopLeft(square);
        if (!point) return;
        const { squareWidth: w, squareHeight: h } = this.cmBoard.view;
        const rect = document.createElementNS(SVG_NS, 'rect');
        // Copre l'intera casella: niente filetto del colore originale ai bordi.
        rect.setAttribute('x', point.x);
        rect.setAttribute('y', point.y);
        rect.setAttribute('width', w + 0.1);
        rect.setAttribute('height', h + 0.1);
        rect.setAttribute('class', `pgn-square-highlight ${kind}`);

        const isLight = this._squareIsLight(square);
        let fill;
        let opacity;
        if (kind === 'last-move' || kind === 'selected') {
            fill = isLight
                ? 'var(--chess-last-move-light, #4f91b5)'
                : 'var(--chess-last-move-dark, #087b86)';
            opacity = kind === 'selected' ? '0.62' : '0.56';
        } else if (kind === 'premove') {
            fill = isLight
                ? 'var(--chess-highlight-light, #00e676)'
                : 'var(--chess-highlight-dark, #00b866)';
            opacity = '0.62';
        } else {
            fill = isLight
                ? 'var(--chess-highlight-light, #00e676)'
                : 'var(--chess-highlight-dark, #00b866)';
            opacity = '0.88';
        }
        rect.setAttribute('fill', fill);
        rect.setAttribute('fill-opacity', opacity);
        this.highlightLayer.appendChild(rect);
    }

    _appendSuggestion(square, isCapture = false) {
        const center = this._squareCenter(square);
        if (!center) return;
        const size = this.cmBoard.view.squareWidth;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', center.x);
        circle.setAttribute('cy', center.y);
        circle.setAttribute('r', size * (isCapture ? 0.36 : 0.13));
        if (isCapture) {
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', 'var(--chess-annotation, #00e676)');
            circle.setAttribute('stroke-width', Math.max(2, size * 0.055));
        } else {
            circle.setAttribute('fill', 'var(--chess-annotation, #00e676)');
            circle.setAttribute('fill-opacity', '0.58');
        }
        circle.setAttribute('class', 'pgn-move-suggestion');
        this.highlightLayer.appendChild(circle);
    }

    _arrowGeometry(from, to) {
        const start = this._squareCenter(from);
        const end = this._squareCenter(to);
        if (!start || !end) return null;

        const size = this.cmBoard.view.squareWidth;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.hypot(dx, dy);
        if (!distance) return null;

        // Tutte le frecce seguono una singola retta centro-centro, anche per
        // le mosse di cavallo. La punta è parte della stessa sagoma SVG:
        // niente marker separati, trasformazioni o bordi doppi che possano
        // deformarsi e diventare più spessi sulla punta.
        const ux = dx / distance;
        const uy = dy / distance;
        const px = -uy;
        const py = ux;
        const shaftHalf = size * 0.060;
        const headHalf = size * 0.205;
        const headLength = size * 0.285;
        const startInset = size * 0.16;
        const tipInset = size * 0.10;

        const sx = start.x + ux * startInset;
        const sy = start.y + uy * startInset;
        const tx = end.x - ux * tipInset;
        const ty = end.y - uy * tipInset;
        const bx = tx - ux * headLength;
        const by = ty - uy * headLength;
        const shaftBaseX = bx - ux * 0.01 * size;
        const shaftBaseY = by - uy * 0.01 * size;

        const point = (x, y, side, halfWidth) =>
            `${(x + px * halfWidth * side).toFixed(2)},${(y + py * halfWidth * side).toFixed(2)}`;

        const points = [
            point(sx, sy, 1, shaftHalf),
            point(shaftBaseX, shaftBaseY, 1, shaftHalf),
            point(bx, by, 1, headHalf),
            `${tx.toFixed(2)},${ty.toFixed(2)}`,
            point(bx, by, -1, headHalf),
            point(shaftBaseX, shaftBaseY, -1, shaftHalf),
            point(sx, sy, -1, shaftHalf)
        ];
        return points.join(' ');
    }

    _appendArrow(from, to, color = this.config.colors.manualArrow, kind = 'manual') {
        const points = this._arrowGeometry(from, to);
        if (!points) return;

        const arrow = document.createElementNS(SVG_NS, 'polygon');
        arrow.setAttribute('points', points);
        arrow.setAttribute('fill', color);
        arrow.setAttribute('stroke', 'var(--chess-arrow-outline, #1b3a4b)');
        arrow.setAttribute('stroke-width', String(this.cmBoard.view.squareWidth * 0.035));
        arrow.setAttribute('stroke-linecap', 'round');
        arrow.setAttribute('stroke-linejoin', 'round');
        arrow.setAttribute('class', `pgn-arrow pgn-arrow--${kind}`);
        this.arrowLayer.appendChild(arrow);
    }

    _getCheckCrownImage() {
        if (this._checkCrownImage) return this._checkCrownImage;
        // Corona rossa semplice, leggibile anche quando si riduce al badge.
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <path d="M12 28 L31 43 L48 14 L67 43 L88 27 L80 78 Q50 88 20 78 Z"
                  fill="#ed334f" stroke="#641629" stroke-width="7" stroke-linejoin="round"/>
            <path d="M20 78 Q50 87 80 78 L78 88 Q50 96 22 88 Z"
                  fill="#c91f3c" stroke="#641629" stroke-width="5" stroke-linejoin="round"/>
            <circle cx="12" cy="25" r="7" fill="#ff8a9a" stroke="#641629" stroke-width="4"/>
            <circle cx="48" cy="12" r="7" fill="#ff8a9a" stroke="#641629" stroke-width="4"/>
            <circle cx="88" cy="24" r="7" fill="#ff8a9a" stroke="#641629" stroke-width="4"/>
            <path d="M27 58 H73" stroke="#ffb3bd" stroke-width="4" stroke-linecap="round" opacity=".82"/>
        </svg>`;
        this._checkCrownImage = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        return this._checkCrownImage;
    }

    _appendCheckCrown(square, animateFromCenter = false) {
        const point = this._squareTopLeft(square);
        const center = this._squareCenter(square);
        if (!point || !center || !this.errorLayer) return;

        const squareWidth = this.cmBoard.view.squareWidth;
        const size = squareWidth * 0.43;
        const margin = squareWidth * 0.025;
        const targetX = point.x + squareWidth - size - margin;
        const targetY = point.y + margin;
        const image = document.createElementNS(SVG_NS, 'image');
        image.setAttribute('href', this._getCheckCrownImage());
        image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        image.setAttribute('class', 'pgn-check-crown');
        image.dataset.square = square;

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (animateFromCenter && !reduceMotion) {
            // Entra al centro della casella, grande, poi si assesta nella stessa
            // posizione occupata normalmente dal badge NAG.
            const startSize = squareWidth * 0.88;
            const startX = center.x - startSize / 2;
            const startY = center.y - startSize / 2;
            image.setAttribute('x', startX);
            image.setAttribute('y', startY);
            image.setAttribute('width', startSize);
            image.setAttribute('height', startSize);

            const animations = [
                ['x', startX, targetX],
                ['y', startY, targetY],
                ['width', startSize, size],
                ['height', startSize, size]
            ];
            for (const [attribute, from, to] of animations) {
                const animation = document.createElementNS(SVG_NS, 'animate');
                animation.setAttribute('attributeName', attribute);
                animation.setAttribute('from', String(from));
                animation.setAttribute('to', String(to));
                animation.setAttribute('dur', '720ms');
                animation.setAttribute('begin', '0s');
                animation.setAttribute('calcMode', 'spline');
                animation.setAttribute('keyTimes', '0;1');
                animation.setAttribute('keySplines', '0.18 0.78 0.22 1');
                animation.setAttribute('fill', 'freeze');
                image.appendChild(animation);
            }
        } else {
            image.setAttribute('x', targetX);
            image.setAttribute('y', targetY);
            image.setAttribute('width', size);
            image.setAttribute('height', size);
        }

        this.errorLayer.appendChild(image);
        if (animateFromCenter && !reduceMotion) {
            this._checkCrownAnimationActive = true;
            if (this._checkCrownAnimationTimer) window.clearTimeout(this._checkCrownAnimationTimer);
            this._checkCrownAnimationTimer = window.setTimeout(() => {
                this._checkCrownAnimationActive = false;
                this._checkCrownAnimationTimer = null;
            }, 760);
        }
    }

    _getBrilliantPathSquares(from, to) {
        if (!/^[a-h][1-8]$/.test(from || '') || !/^[a-h][1-8]$/.test(to || '')) return [];
        const startFile = from.charCodeAt(0) - 97;
        const startRank = Number(from[1]) - 1;
        const endFile = to.charCodeAt(0) - 97;
        const endRank = Number(to[1]) - 1;
        const dx = endFile - startFile;
        const dy = endRank - startRank;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const stepX = Math.sign(dx);
        const stepY = Math.sign(dy);
        const squares = [from];

        // Le mosse di cavallo disegnano un corridoio a L; tutte le altre mosse
        // seguono le caselle attraversate sulla linea che unisce origine e meta.
        if ((absX === 2 && absY === 1) || (absX === 1 && absY === 2)) {
            if (absX === 2) {
                squares.push(`${String.fromCharCode(97 + startFile + stepX)}${startRank + 1}`);
                squares.push(`${String.fromCharCode(97 + startFile + 2 * stepX)}${startRank + 1}`);
            } else {
                squares.push(`${String.fromCharCode(97 + startFile)}${startRank + 1 + stepY}`);
                squares.push(`${String.fromCharCode(97 + startFile)}${startRank + 1 + 2 * stepY}`);
            }
            squares.push(to);
            return [...new Set(squares)];
        }

        if (dx === 0 || dy === 0 || absX === absY) {
            const steps = Math.max(absX, absY);
            for (let i = 1; i <= steps; i++) {
                squares.push(`${String.fromCharCode(97 + startFile + stepX * i)}${startRank + stepY * i + 1}`);
            }
            return [...new Set(squares)];
        }

        // Fallback robusto per mosse non allineate non standard.
        let x = startFile;
        let y = startRank;
        const deltaX = absX;
        const deltaY = absY;
        const sx = dx < 0 ? -1 : 1;
        const sy = dy < 0 ? -1 : 1;
        let error = deltaX - deltaY;
        while (x !== endFile || y !== endRank) {
            const twiceError = 2 * error;
            if (twiceError > -deltaY) { error -= deltaY; x += sx; }
            if (twiceError < deltaX) { error += deltaX; y += sy; }
            squares.push(`${String.fromCharCode(97 + x)}${y + 1}`);
        }
        return [...new Set(squares)];
    }

    _appendBrilliantPath(from, to, squareSize, pathStartDelayMs, pathStepMs, pathRevealMs) {
        const squares = this._getBrilliantPathSquares(from, to);
        if (!squares.length) return squares;

        squares.forEach((square, index) => {
            const point = this._squareTopLeft(square);
            if (!point) return;
            const tile = document.createElementNS(SVG_NS, 'rect');
            // La tessera copre la casella intera: la corrispondente apertura
            // nella maschera ha esattamente le stesse dimensioni.
            tile.setAttribute('x', point.x);
            tile.setAttribute('y', point.y);
            tile.setAttribute('width', this.cmBoard.view.squareWidth);
            tile.setAttribute('height', this.cmBoard.view.squareHeight);
            tile.setAttribute('class', 'pgn-brilliant-path-square');
            tile.style.setProperty('--path-reveal-delay', `${pathStartDelayMs + index * pathStepMs}ms`);
            tile.style.setProperty('--path-reveal-duration', `${pathRevealMs}ms`);
            this.brilliantBoardLayer.appendChild(tile);
        });
        return squares;
    }

    _appendBrilliantDimMask(
        from, to, pathSquares, squareSize,
        pathStartDelayMs, pathStepMs, pathRevealMs, moveDurationMs
    ) {
        const points = [];
        for (let rank = 1; rank <= 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const square = `${String.fromCharCode(97 + file)}${rank}`;
                const point = this._squareTopLeft(square);
                if (point) points.push(point);
            }
        }
        if (!points.length) return null;

        const squareWidth = this.cmBoard.view.squareWidth;
        const squareHeight = this.cmBoard.view.squareHeight;
        const minX = Math.min(...points.map(point => point.x));
        const minY = Math.min(...points.map(point => point.y));
        const maxX = Math.max(...points.map(point => point.x)) + squareWidth;
        const maxY = Math.max(...points.map(point => point.y)) + squareHeight;
        const width = maxX - minX;
        const height = maxY - minY;

        const defs = document.createElementNS(SVG_NS, 'defs');
        const mask = document.createElementNS(SVG_NS, 'mask');
        const maskId = `pgn-brilliant-mask-${this._brilliantToken}`;
        mask.setAttribute('id', maskId);
        mask.setAttribute('maskUnits', 'userSpaceOnUse');
        mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
        mask.setAttribute('x', minX);
        mask.setAttribute('y', minY);
        mask.setAttribute('width', width);
        mask.setAttribute('height', height);
        mask.setAttribute('style', 'mask-type:luminance');

        const maskBase = document.createElementNS(SVG_NS, 'rect');
        maskBase.setAttribute('x', minX);
        maskBase.setAttribute('y', minY);
        maskBase.setAttribute('width', width);
        maskBase.setAttribute('height', height);
        maskBase.setAttribute('fill', '#ffffff');
        mask.appendChild(maskBase);

        // Apertura mobile grande esattamente una casella. Segue il pezzo
        // durante il tragitto (utile soprattutto per il salto del cavallo).
        // Le aperture statiche delle caselle, aggiunte dopo, restano comunque
        // aperte per tutta la celebrazione: il percorso non viene mai oscurato.
        const start = this._squareTopLeft(from);
        const end = this._squareTopLeft(to);
        const movingHole = document.createElementNS(SVG_NS, 'rect');
        movingHole.setAttribute('x', start.x);
        movingHole.setAttribute('y', start.y);
        movingHole.setAttribute('width', squareWidth);
        movingHole.setAttribute('height', squareHeight);
        movingHole.setAttribute('fill', '#000000');

        const animate = document.createElementNS(SVG_NS, 'animateTransform');
        animate.setAttribute('attributeName', 'transform');
        animate.setAttribute('type', 'translate');
        animate.setAttribute('from', '0 0');
        animate.setAttribute('to', `${end.x - start.x} ${end.y - start.y}`);
        animate.setAttribute('dur', `${moveDurationMs}ms`);
        animate.setAttribute('begin', 'indefinite');
        animate.setAttribute('fill', 'freeze');
        movingHole.appendChild(animate);
        mask.appendChild(movingHole);

        // Ogni casella si apre con easing in/out insieme alla tessera verde.
        // Una volta aperta, resta completamente libera dal grigio fino alla
        // rimozione finale dell'overlay: non si richiude dietro al pezzo.
        pathSquares.forEach((square, index) => {
            const point = this._squareTopLeft(square);
            if (!point) return;
            const hole = document.createElementNS(SVG_NS, 'rect');
            hole.setAttribute('x', point.x);
            hole.setAttribute('y', point.y);
            hole.setAttribute('width', squareWidth);
            hole.setAttribute('height', squareHeight);
            hole.setAttribute('fill', '#ffffff');

            const revealHole = document.createElementNS(SVG_NS, 'animate');
            revealHole.setAttribute('attributeName', 'fill');
            revealHole.setAttribute('from', '#ffffff');
            revealHole.setAttribute('to', '#000000');
            revealHole.setAttribute('begin', `${pathStartDelayMs + index * pathStepMs}ms`);
            revealHole.setAttribute('dur', `${pathRevealMs}ms`);
            revealHole.setAttribute('calcMode', 'spline');
            revealHole.setAttribute('keyTimes', '0;1');
            revealHole.setAttribute('keySplines', '0.42 0 0.58 1');
            revealHole.setAttribute('fill', 'freeze');
            hole.appendChild(revealHole);
            mask.appendChild(hole);
        });

        defs.appendChild(mask);
        this.brilliantDimLayer.appendChild(defs);

        const dim = document.createElementNS(SVG_NS, 'rect');
        dim.setAttribute('x', minX);
        dim.setAttribute('y', minY);
        dim.setAttribute('width', width);
        dim.setAttribute('height', height);
        dim.setAttribute('class', 'pgn-brilliant-dim');
        dim.setAttribute('mask', `url(#${maskId})`);
        this.brilliantDimLayer.appendChild(dim);

        return { animate, movingHole, pathBounds: { minX, minY, width, height } };
    }

    _appendBrilliantLabel(square, squareSize) {
        const labelCenter = this._squareCenter(square);
        if (!labelCenter) return;
        const labelPosition = document.createElementNS(SVG_NS, 'g');
        labelPosition.setAttribute('class', 'pgn-brilliant-label-position');
        labelPosition.setAttribute('transform', `translate(${labelCenter.x} ${labelCenter.y - squareSize * 0.66})`);
        this.brilliantLayer.appendChild(labelPosition);

        const label = document.createElementNS(SVG_NS, 'g');
        label.setAttribute('class', 'pgn-brilliant-label');
        labelPosition.appendChild(label);

        const width = squareSize * 2.02;
        const height = squareSize * 0.48;
        const left = -width / 2;
        const pill = document.createElementNS(SVG_NS, 'rect');
        pill.setAttribute('x', left);
        pill.setAttribute('y', -height / 2);
        pill.setAttribute('width', width);
        pill.setAttribute('height', height);
        pill.setAttribute('rx', height * 0.32);
        pill.setAttribute('class', 'pgn-brilliant-pill');
        label.appendChild(pill);

        const nagBoxWidth = squareSize * 0.43;
        const nagBoxHeight = squareSize * 0.34;
        const nagBox = document.createElementNS(SVG_NS, 'rect');
        nagBox.setAttribute('x', left + squareSize * 0.075);
        nagBox.setAttribute('y', -nagBoxHeight / 2);
        nagBox.setAttribute('width', nagBoxWidth);
        nagBox.setAttribute('height', nagBoxHeight);
        nagBox.setAttribute('rx', nagBoxHeight * 0.2);
        nagBox.setAttribute('class', 'pgn-brilliant-nag-box');
        label.appendChild(nagBox);

        const nagText = document.createElementNS(SVG_NS, 'text');
        nagText.setAttribute('x', left + squareSize * 0.075 + nagBoxWidth / 2);
        nagText.setAttribute('y', '0');
        nagText.setAttribute('text-anchor', 'middle');
        nagText.setAttribute('dominant-baseline', 'central');
        nagText.setAttribute('font-size', String(squareSize * 0.205));
        nagText.setAttribute('class', 'pgn-brilliant-nag-text');
        nagText.textContent = '!!';
        label.appendChild(nagText);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', left + squareSize * 0.60);
        text.setAttribute('y', '0');
        text.setAttribute('text-anchor', 'start');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('class', 'pgn-brilliant-text');
        text.setAttribute('font-size', String(squareSize * 0.19));
        text.textContent = 'BRILLIANT';
        label.appendChild(text);
    }

    _cancelPendingPositionSync() {
        if (this._pendingPositionTimer !== null) {
            window.clearTimeout(this._pendingPositionTimer);
            this._pendingPositionTimer = null;
        }
        this._pendingPositionToken += 1;
    }

    _schedulePositionSync(animated = true) {
        this._cancelPendingPositionSync();
        const token = this._pendingPositionToken;
        const fen = this.game.fen();
        // Lasciamo una micro-finestra ai sync delle annotazioni: setNag('$3')
        // può quindi intercettare la mossa prima che cm-chessboard la animi.
        this._pendingPositionTimer = window.setTimeout(() => {
            this._pendingPositionTimer = null;
            if (token !== this._pendingPositionToken || this._brilliantMovePending) return;
            if (this.game?.fen() !== fen) return; // una mossa più recente ha già sostituito questa posizione
            Promise.resolve(this.cmBoard?.setPosition(fen, animated)).then(() => this.render());
        }, 35);
    }

    _clearBrilliantAnimation(restorePosition = false) {
        this._brilliantToken += 1;
        this._brilliantNagPending = false;
        this._brilliantMovePending = false;
        this.brilliantBoardLayer?.replaceChildren();
        this.brilliantDimLayer?.replaceChildren();
        this.brilliantLayer?.replaceChildren();
        this.container?.classList.remove('pgn-brilliant-active');
        this.cmBoard?.view?.piecesLayer?.classList.remove('pgn-brilliant-pieces-shake');
        if (restorePosition && this.cmBoard && this.game?.fen) {
            this._cancelPendingPositionSync();
            this.cmBoard.setPosition(this.game.fen(), false);
        }
    }

    async _playBrilliantAnimation(square) {
        if (!this.brilliantLayer || !this.brilliantBoardLayer || !this.cmBoard) return;
        const from = this.lastMove?.from;
        const to = square || this.lastMove?.to;
        if (!from || !to) return;
        if (!this._squareCenter(to)) return;

        this._clearBrilliantAnimation(false);
        const token = this._brilliantToken;
        const squareSize = this.cmBoard.view.squareWidth;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (reduceMotion) {
            this._cancelPendingPositionSync();
            this.cmBoard.setPosition(this.game.fen(), false);
            this.render();
            return;
        }

        // Se la posizione visiva è ancora quella precedente, la mossa verrà
        // eseguita una sola volta dopo la costruzione del percorso. Se il NAG
        // viene assegnato a posteriori, non facciamo rewind né un secondo move.
        const canAnimatePiece = !!this.cmBoard.getPiece?.(from);
        this._brilliantMovePending = canAnimatePiece;
        if (canAnimatePiece) this._cancelPendingPositionSync();
        this._brilliantNagPending = true;
        this.container.classList.add('pgn-brilliant-active');

        const pathSquares = this._getBrilliantPathSquares(from, to);
        const dimDurationMs = 440;
        const pathStartDelayMs = 120;
        const pathStepMs = 54;
        const pathRevealMs = 300;
        const moveDurationMs = 260;
        const pathBuildMs = Math.max(
            dimDurationMs,
            pathStartDelayMs + Math.max(0, pathSquares.length - 1) * pathStepMs + pathRevealMs
        );

        const maskDetails = this._appendBrilliantDimMask(
            from, to, pathSquares, squareSize,
            pathStartDelayMs, pathStepMs, pathRevealMs, moveDurationMs
        );
        if (!canAnimatePiece && maskDetails?.movingHole) {
            // NAG applicato a una mossa già mostrata: il foro mobile resta
            // esattamente sulla casella d'arrivo, senza ripetere il movimento.
            const endPoint = this._squareTopLeft(to);
            maskDetails.movingHole.setAttribute('x', endPoint.x);
            maskDetails.movingHole.setAttribute('y', endPoint.y);
            maskDetails.animate?.remove();
        }
        this._appendBrilliantPath(from, to, squareSize, pathStartDelayMs, pathStepMs, pathRevealMs);
        this.brilliantLayer.setAttribute('data-active-square', to);
        this.render();

        // Fase 1: il terreno si forma con easing. La scacchiera si scurisce,
        // poi le caselle si aprono una alla volta e restano tutte luminose.
        await new Promise(resolve => window.setTimeout(resolve, pathBuildMs + 35));
        if (token !== this._brilliantToken) return;

        // Fase 2: un solo movimento, soltanto dopo che l'intero percorso è pronto.
        const piecesLayer = this.cmBoard.view.piecesLayer;
        if (canAnimatePiece) {
            try {
                maskDetails?.animate?.beginElement?.();
                await Promise.resolve(this.cmBoard.movePiece(from, to, true));
            } catch (error) {
                console.warn('Animazione della mossa Brilliant non riuscita:', error);
            }
        }
        if (token !== this._brilliantToken) return;

        // La posizione logica resta l'unica fonte di verità (catture, arrocco,
        // promozioni). Questo riallineamento non anima e quindi non duplica la mossa.
        await Promise.resolve(this.cmBoard.setPosition(this.game.fen(), false));
        this._brilliantMovePending = false;

        // Fase 3: solo all'arrivo tremano tutti i pezzi e appare il badge.
        // La scacchiera non trema e il NAG standard resta nascosto fino alla fine.
        piecesLayer.classList.remove('pgn-brilliant-pieces-shake');
        void piecesLayer.getBoundingClientRect();
        piecesLayer.classList.add('pgn-brilliant-pieces-shake');
        this.render();
        this._appendBrilliantLabel(to, squareSize);

        await new Promise(resolve => window.setTimeout(resolve, 1420));
        if (token === this._brilliantToken) {
            // Tutti gli effetti celebrativi spariscono insieme. Il NAG normale
            // viene ridisegnato per ultimo e resta come unica annotazione visibile.
            this.brilliantBoardLayer?.replaceChildren();
            this.brilliantDimLayer?.replaceChildren();
            this.brilliantLayer?.replaceChildren();
            this._brilliantNagPending = false;
            this.container.classList.remove('pgn-brilliant-active');
            piecesLayer.classList.remove('pgn-brilliant-pieces-shake');
            this.render();
        }
    }

    render() {
        if (!this.cmBoard || !this.game || !this.highlightLayer) return;
        this.highlightLayer.replaceChildren();
        this.arrowLayer.replaceChildren();

        const highlights = new Map();
        if (this.lastMove) {
            highlights.set(this.lastMove.from, 'last-move');
            highlights.set(this.lastMove.to, 'last-move');
        }
        if (this.selectedSquare) highlights.set(this.selectedSquare, 'selected');
        for (const square of this.customHighlights) highlights.set(square, 'custom');
        for (const premove of this.premoveQueue) {
            highlights.set(premove.from, 'premove');
            highlights.set(premove.to, 'premove');
        }
        for (const [square, kind] of highlights) this._appendSquareHighlight(square, kind);

        if (this.config.showSuggestions && this.selectedSquare && this.game.get(this.selectedSquare)?.color === this.game.turn()) {
            const targets = new Map();
            this.game.moves({ square: this.selectedSquare, verbose: true }).forEach(move => {
                targets.set(move.to, targets.get(move.to) || move.flags.includes('c') || move.flags.includes('e'));
            });
            for (const [square, isCapture] of targets) this._appendSuggestion(square, isCapture);
        }

        let checkSquare = null;
        if (this.game.in_check()) {
            const board = this.game.board();
            const turn = this.game.turn();
            for (let row = 0; row < 8 && !checkSquare; row++) {
                for (let col = 0; col < 8; col++) {
                    const piece = board[row][col];
                    if (piece?.type === 'k' && piece.color === turn) {
                        checkSquare = 'abcdefgh'[col] + (8 - row);
                        break;
                    }
                }
            }
        }
        const existingCrown = this.errorLayer.querySelector('.pgn-check-crown');
        const keepRunningCrown = !!checkSquare
            && existingCrown?.dataset.square === checkSquare
            && this._checkCrownAnimationActive;
        if (keepRunningCrown) {
            // Non rimuovere un nodo SVG con animazioni SMIL ancora in corso:
            // il sync NAG successivo alla navigazione richiama render() subito.
            Array.from(this.errorLayer.children).forEach(child => {
                if (child !== existingCrown) child.remove();
            });
        } else {
            this.errorLayer.replaceChildren();
            if (checkSquare) {
                const isNewCheck = checkSquare !== this._lastRenderedCheckSquare;
                this._appendCheckCrown(checkSquare, isNewCheck);
            } else if (this._checkCrownAnimationTimer) {
                window.clearTimeout(this._checkCrownAnimationTimer);
                this._checkCrownAnimationTimer = null;
                this._checkCrownAnimationActive = false;
            }
        }
        this._lastRenderedCheckSquare = checkSquare;

        for (const arrow of this.availableMoveArrowsMap.values()) {
            this._appendArrow(arrow.from, arrow.to, arrow.color, 'pgn');
        }
        for (const arrow of this.arrowsMap.values()) {
            this._appendArrow(arrow.from, arrow.to, arrow.color, 'manual');
        }

        // La corona occupa il badge del re. Un NAG su un'altra casella può
        // comparire senza sovrapporsi; se coincide con il re, vince la corona.
        if (this.showNags && this.currentNag
            && (!checkSquare || this.currentNag.square !== checkSquare)
            && !(this._brilliantNagPending && this.currentNag.nag === '$3')) {
            const point = this._squareTopLeft(this.currentNag.square);
            if (point) {
                const visual = this._getNagVisual(this.currentNag.nag);
                const squareWidth = this.cmBoard.view.squareWidth;
                const size = squareWidth * 0.43;
                const badge = document.createElementNS(SVG_NS, 'image');
                badge.setAttribute('href', visual.image);
                badge.setAttribute('x', point.x + squareWidth - size - squareWidth * 0.025);
                badge.setAttribute('y', point.y + squareWidth * 0.025);
                badge.setAttribute('width', size);
                badge.setAttribute('height', size);
                badge.setAttribute('class', 'pgn-nag-badge');
                this.arrowLayer.appendChild(badge);
            }
        }
    }

    flipBoard() {
        this.isFlipped = !this.isFlipped;
        if (!this.cmBoard) return;
        return this.cmBoard.setOrientation(this.isFlipped ? CM_COLOR.black : CM_COLOR.white, true)
            .then(() => this.render());
    }

    _showPromotionMenu(from, to) {
        if (!this.container) return;
        this.pendingPromotion = { from, to };
        this.container.querySelector('.cm-promotion-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'cm-promotion-menu';
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', 'Scegli il pezzo per la promozione');
        ['q', 'r', 'b', 'n'].forEach(piece => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cm-promotion-choice';
            button.textContent = ({ q: 'Donna', r: 'Torre', b: 'Alfiere', n: 'Cavallo' })[piece];
            button.addEventListener('click', () => {
                const pending = this.pendingPromotion;
                this.pendingPromotion = null;
                menu.remove();
                if (pending) this._executeMove({ from: pending.from, to: pending.to, promotion: piece });
            });
            menu.appendChild(button);
        });
        this.container.appendChild(menu);
    }

    _queuePremove(from, to) {
        if (from !== to) this.premoveQueue.push({ from, to });
        this.selectedSquare = null;
        this.render();
        return true;
    }

    _flushNextPremove() {
        if (!this.premoveQueue.length || !this.game) return;
        const next = this.premoveQueue.shift();
        const legal = this.game.moves({ verbose: true }).some(move => move.from === next.from && move.to === next.to);
        if (!legal) {
            this.premoveQueue = [];
            this.render();
            this.flashSquareError(next.from);
            return;
        }
        this._executeMove({ from: next.from, to: next.to, promotion: next.promotion || 'q' });
    }

    _executeMove(moveObject) {
        if (!this.game) return null;
        const move = this.game.move({ ...moveObject, promotion: moveObject.promotion || 'q' });
        if (!move) return null;
        this._afterMovePrepared(move);
        const moveFen = this.game.fen();
        if (this.onMoveCallback) this.onMoveCallback(move);
        if (this.game.fen() === moveFen && !this._brilliantMovePending) {
            Promise.resolve(this.cmBoard?.setPosition(moveFen, true)).then(() => this.render());
        }
        if (this.premoveColor && this.game.turn() === this.premoveColor && this.premoveQueue.length) {
            const delay = this._brilliantMovePending ? 2500 : 0;
            window.setTimeout(() => this._flushNextPremove(), delay);
        }
        return move;
    }

    setPremoveColor(color) {
        const normalized = color || null;
        if (normalized !== this.premoveColor) this.premoveQueue = [];
        this.premoveColor = normalized;
        this.render();
    }

    clearPremoves() {
        if (!this.premoveQueue.length) return;
        this.premoveQueue = [];
        this.render();
    }

    hasPremoves() {
        return this.premoveQueue.length > 0;
    }

    undoMove() {
        if (!this.game) return null;
        this._clearBrilliantAnimation(true);
        const move = this.game.undo();
        if (move) {
            const history = this.game.history({ verbose: true });
            this.lastMove = history.length ? { from: history.at(-1).from, to: history.at(-1).to } : null;
            this.selectedSquare = null;
            this.currentNag = null;
            this.arrowsMap.clear();
            this.availableMoveArrowsMap.clear();
            this.customHighlights.clear();
            this.cmBoard?.setPosition(this.game.fen(), true);
            this.render();
            if (this.onMoveCallback) this.onMoveCallback(null);
        }
        return move;
    }

    undoSilently() {
        if (!this.game) return null;
        // Può essere chiamato subito dopo game.move() (es. risposta errata in
        // Drill): non sincronizzare prima la posizione appena rifiutata.
        this._clearBrilliantAnimation(false);
        const move = this.game.undo();
        if (move) {
            const history = this.game.history({ verbose: true });
            this.lastMove = history.length ? { from: history.at(-1).from, to: history.at(-1).to } : null;
            this.selectedSquare = null;
            this.currentNag = null;
            this.arrowsMap.clear();
            this.availableMoveArrowsMap.clear();
            this.customHighlights.clear();
            this.cmBoard?.setPosition(this.game.fen(), true);
            this.render();
        }
        return move;
    }

    flashSquareError(square) {
        const point = this._squareTopLeft(square);
        if (!point || !this.errorLayer) return;
        const { squareWidth: w, squareHeight: h } = this.cmBoard.view;
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', point.x);
        rect.setAttribute('y', point.y);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('class', 'pgn-error-flash');
        this.errorLayer.appendChild(rect);
        rect.addEventListener('animationend', () => rect.remove(), { once: true });
    }

    setPosition(fen, lastMove = null) {
        if (!this.game) return false;
        this._clearBrilliantAnimation(true);
        this._cancelPendingPositionSync();
        const ok = (!fen || fen === 'start') ? (this.game.reset(), true) : this.game.load(fen);
        if (!ok) return false;
        if (lastMove) {
            this.lastMove = lastMove;
        } else {
            const history = this.game.history({ verbose: true });
            this.lastMove = history.length ? { from: history.at(-1).from, to: history.at(-1).to } : null;
        }
        this.selectedSquare = null;
        this.currentNag = null;
        this.arrowsMap.clear();
        this.availableMoveArrowsMap.clear();
        this.customHighlights.clear();
        this.container.querySelector('.cm-promotion-menu')?.remove();
        this.pendingPromotion = null;
        this._schedulePositionSync(true);
        this.render();
        if (this.premoveColor && this.game.turn() === this.premoveColor && this.premoveQueue.length) {
            this._flushNextPremove();
        }
        return true;
    }

    makeMove(pgnMove) {
        if (!this.game) return null;
        const move = this.game.move(pgnMove);
        if (move) {
            this._afterMovePrepared(move);
            const moveFen = this.game.fen();
            if (this.onMoveCallback) this.onMoveCallback(move);
            if (this.game.fen() === moveFen && !this._brilliantMovePending) {
                Promise.resolve(this.cmBoard?.setPosition(moveFen, true)).then(() => this.render());
            }
        }
        return move;
    }

    drawArrow(from, to) {
        const key = `${from}-${to}`;
        if (this.arrowsMap.has(key)) this.arrowsMap.delete(key);
        else this.arrowsMap.set(key, { from, to, color: this.config.colors.manualArrow });
        this.render();
        if (this.onAnnotationChange) this.onAnnotationChange();
    }

    clearArrows() {
        this.arrowsMap.clear();
        this.render();
    }

    getArrows() {
        return Array.from(this.arrowsMap.values()).map(({ from, to }) => ({ from, to }));
    }

    setArrows(arrows = []) {
        this.arrowsMap.clear();
        // Le frecce persistite nei commenti/corsi sono annotazioni disegnate
        // dall'utente: devono mantenere il colore manuale anche dopo il reload.
        arrows.forEach(({ from, to }) => this.arrowsMap.set(`${from}-${to}`, {
            from, to, color: this.config.colors.manualArrow
        }));
        this.render();
    }

    showAvailableMoveArrows(moves = [], color = this.config.colors.pgnArrow) {
        this.availableMoveArrowsMap.clear();
        moves.forEach(({ from, to }) => this.availableMoveArrowsMap.set(`${from}-${to}`, { from, to, color }));
        this.render();
    }

    clearAvailableMoveArrows() {
        this.availableMoveArrowsMap.clear();
        this.render();
    }

    _toggleCustomHighlight(square) {
        if (this.customHighlights.has(square)) this.customHighlights.delete(square);
        else this.customHighlights.add(square);
        this.render();
        if (this.onAnnotationChange) this.onAnnotationChange();
    }

    clearCustomHighlights() {
        this.customHighlights.clear();
        this.render();
    }

    getCustomHighlights() {
        return Array.from(this.customHighlights);
    }

    setCustomHighlights(squares = []) {
        this.customHighlights = new Set(squares);
        this.render();
    }

    _showSuggestions(square) {
        this.selectedSquare = square;
        this.render();
    }

    /** Current preference for legal-move destination dots. */
    areMoveSuggestionsVisible() {
        return Boolean(this.config.showSuggestions);
    }

    /**
     * Show or hide the dots displayed after selecting a piece. The preference
     * is shared by Reader and Courses and survives page reloads.
     * @param {boolean} visible
     * @param {boolean} persist
     */
    setMoveSuggestionsVisible(visible, persist = true) {
        this.config.showSuggestions = Boolean(visible);
        if (persist) {
            try {
                localStorage.setItem(MOVE_DOTS_STORAGE_KEY, String(this.config.showSuggestions));
            } catch (_) { /* Keep the setting for the current session. */ }
        }
        this.render();
    }

    hideMovesSuggestions() {
        this.setMoveSuggestionsVisible(false);
    }

    showMovesSuggestions() {
        this.setMoveSuggestionsVisible(true);
    }

    setOnMoveCallback(callback) { this.onMoveCallback = callback; }
    setOnAnnotationChange(callback) { this.onAnnotationChange = callback; }

    getNagVisual(nagCode) {
        return this._getNagVisual(nagCode);
    }

    setNagsVisible(visible) {
        this.showNags = Boolean(visible);
        if (!this.showNags) this._clearBrilliantAnimation(true);
        this.render();
    }

    setNag(nagCode) {
        if (!nagCode) {
            this.currentNag = null;
            this._clearBrilliantAnimation(false);
            this.render();
            return;
        }
        if (!this.lastMove) {
            console.warn('setNag: nessuna mossa sulla scacchiera a cui associare il NAG.');
            return;
        }
        if (nagCode !== '$3') this._clearBrilliantAnimation(false);
        const nextNag = { square: this.lastMove.to, nag: nagCode };
        const shouldPlayBrilliant = this.showNags && nagCode === '$3'
            && (this.currentNag?.nag !== '$3' || this.currentNag?.square !== nextNag.square);
        this.currentNag = nextNag;
        if (shouldPlayBrilliant) {
            // Se una posizione è stata appena caricata, annulla l'animazione
            // standard ancora in attesa: il movimento verrà eseguito solo dopo
            // che tutte le caselle del percorso saranno apparse.
            this._cancelPendingPositionSync();
            void this._playBrilliantAnimation(nextNag.square).catch(error => {
                console.warn('Animazione Brilliant non riuscita:', error);
                this._brilliantNagPending = false;
                this._brilliantMovePending = false;
                this.brilliantBoardLayer?.replaceChildren();
                this.brilliantDimLayer?.replaceChildren();
                this.brilliantLayer?.replaceChildren();
                this.container?.classList.remove('pgn-brilliant-active');
                this.cmBoard?.view?.piecesLayer?.classList.remove('pgn-brilliant-pieces-shake');
                this.cmBoard?.setPosition(this.game.fen(), false);
                this.render();
            });
        }
        else this.render();
    }

    _getNagVisual(nagCode) {
        const info = DEFAULT_NAG_INFO[nagCode];
        const color = this.config.colors.nag[nagCode] || info?.color || '#707070';
        const image = this.config.images.nags[nagCode] || this._getDefaultNagImage(nagCode, color);
        return { color, image };
    }

    _getDefaultNagImage(nagCode, color) {
        const key = `${nagCode}|${color}`;
        if (this._nagImageCache.has(key)) return this._nagImageCache.get(key);
        const info = DEFAULT_NAG_INFO[nagCode];
        // Tutti i glifi NAG sono bianchi, anche sui badge chiari:
        // il bordo esterno e il colore del badge ne mantengono la leggibilità.
        const ink = '#ffffff';
        let glyph;
        if (info?.icon === 'star') {
            glyph = `<polygon points="${this._starPoints(50, 51, 28, 11)}" fill="${ink}" stroke="#253238" stroke-width="5" stroke-linejoin="round"/>`;
        } else if (info?.icon === 'thumbsup') {
            glyph = `<path d="M34 45h-12v34h12V45Zm9 34h29c5 0 8-4 9-8l5-22c1-5-3-9-8-9H59l3-14c1-5-2-9-7-9-2 0-4 1-5 3L39 41c-1 2-2 4-2 6v25c0 4 2 7 6 7Z" fill="${ink}" stroke="#253238" stroke-width="4" stroke-linejoin="round"/>`;
        } else {
            const symbol = info?.symbol || String(nagCode).replace('$', '');
            glyph = `<text x="50" y="54" text-anchor="middle" dominant-baseline="middle" font-family="Inter" font-weight="700" font-size="${symbol.length > 1 ? 46 : 62}" fill="${ink}" stroke="#253238" stroke-width="7" paint-order="stroke fill" stroke-linejoin="round">${symbol}</text>`;
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect x="4" y="4" width="92" height="92" rx="18" fill="${color}" stroke="#17121e" stroke-width="8"/>
            <rect x="9" y="9" width="82" height="82" rx="13" fill="none" stroke="#ffffff" stroke-opacity=".88" stroke-width="4"/>
            ${glyph}
        </svg>`;
        const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        this._nagImageCache.set(key, uri);
        return uri;
    }

    _starPoints(cx, cy, outerRadius, innerRadius) {
        const points = [];
        for (let i = 0; i < 10; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (Math.PI / 5) * i - Math.PI / 2;
            points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
        }
        return points.join(' ');
    }

    _getContrastColor(hex) {
        const value = String(hex).replace('#', '');
        if (value.length !== 6) return '#ffffff';
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#20232a' : '#ffffff';
    }

    destroy() {
        this._clearBrilliantAnimation(false);
        this._cancelPendingPositionSync();
        this._resizeObserver?.disconnect();
        this.container.removeEventListener('pointerdown', this._onRightPointerDown, true);
        this.container.removeEventListener('contextmenu', this._onContextMenu);
        document.removeEventListener('pointerup', this._onRightPointerUp, true);
        this.stopCalculating();
        this.engine?.terminate();
        this.cmBoard?.destroy();
        this.container.classList.remove('pgn-cm-board');
    }

    _initEngine() {
        this.engine = new Worker('engine/stockfish-18-lite-single.js');

        // Stato interno per sincronizzare correttamente stop/go (evita crash "unreachable")
        this._isEngineSearching = false;
        this._pendingSearch = null;

        this.engine.onmessage = (event) => {
            let msg = event.data;
            if (typeof msg === 'object') {
                msg = msg.text || msg.data || msg.message || "";
            }
            msg = String(msg).trim();

            if (!msg) return;

            // console.log("[SF-OUT]", msg);

            if (this.calculationCallback && msg.startsWith('info') && (msg.includes('score cp') || msg.includes('score mate'))) {
                this._parseEngineInfo(msg);
            }

            // Il motore conferma con "bestmove" che una ricerca precedente è DAVVERO finita.
            // Solo a quel punto è sicuro avviarne una nuova.
            if (msg.startsWith('bestmove')) {
                this._isEngineSearching = false;
                if (this._pendingSearch) {
                    const fn = this._pendingSearch;
                    this._pendingSearch = null;
                    fn();
                }
            }

            if (this.engineMessageQueue.length > 0) {
                this.engineMessageQueue[0](msg);
            }
        };

        this.engine.onerror = function (error) {
            console.error("Error inside the Web Worker:", error);
        };

        this.engine.postMessage('uci');
    }


    _askEngine(command, checkFunction) {
        return new Promise((resolve) => {
            this.engineMessageQueue.push((msg) => {
                const res = checkFunction(msg);
                if (res !== undefined) {
                    this.engineMessageQueue.shift();
                    resolve(res);
                }
            });
            this.engine.postMessage(command);
        });
    }

    async getEvaluation(depth = 12) {
        if (!this.game) return null;
        this.engine.postMessage(`position fen ${this.game.fen()}`);
        return await this._askEngine(`go depth ${depth}`, (msg) => {
            if (msg.includes(`depth ${depth}`) && msg.includes('score cp')) {
                const match = msg.match(/score cp (-?\d+)/);
                if (match) {
                    let score = parseInt(match[1]) / 100;
                    if (this.game.turn() === 'b') score = -score;
                    return score;
                }
            } else if (msg.includes(`depth ${depth}`) && msg.includes('score mate')) {
                const match = msg.match(/score mate (-?\d+)/);
                if (match) return `M${match[1]}`;
            }
        });
    }

    async getBestLines(numLines, depth = 12) {
        if (!this.game) return [];
        this.engine.postMessage('setoption name MultiPV value ' + numLines);
        this.engine.postMessage(`position fen ${this.game.fen()}`);

        let lines = [];
        return await this._askEngine(`go depth ${depth}`, (msg) => {
            if (msg.startsWith('info') && msg.includes('multipv')) {
                const pvMatch = msg.match(/multipv (\d+).*?score (cp|mate) (-?\d+).*?pv (.*)/);
                if (pvMatch) {
                    const idx = parseInt(pvMatch[1]) - 1;
                    const type = pvMatch[2];
                    const val = parseInt(pvMatch[3]);
                    let evalScore = type === 'cp' ? (val / 100) : `M${val}`;
                    if (this.game.turn() === 'b' && type === 'cp') evalScore = -evalScore;

                    lines[idx] = { evaluation: evalScore, moves: pvMatch[4].split(' ') };
                }
            }
            if (msg.includes('bestmove')) {
                this.engine.postMessage('setoption name MultiPV value 1');
                return lines.filter(l => l != null);
            }
        });
    }

    // Converte una variante principale (mosse UCI tipo "e2e4") in testo leggibile tipo
    // "14.Nf3 Nc6 15.Bb5 a6" giocandola su una copia della posizione attuale.
    _formatPvLine(uciMoves, maxPlies = 8) {
        if (!uciMoves || uciMoves.length === 0 || typeof Chess === 'undefined') return '';

        let tempGame;
        try {
            tempGame = new Chess(this.game.fen());
        } catch (e) {
            return '';
        }

        const fenParts = this.game.fen().split(' ');
        let turn = fenParts[1] === 'b' ? 'b' : 'w';
        let moveNumber = parseInt(fenParts[5], 10) || 1;

        const parts = [];
        for (let i = 0; i < Math.min(uciMoves.length, maxPlies); i++) {
            const u = uciMoves[i];
            if (!u || u.length < 4) break;

            const from = u.slice(0, 2);
            const to = u.slice(2, 4);
            const promotion = u.length > 4 ? u[4] : undefined;
            const res = tempGame.move(promotion ? { from, to, promotion } : { from, to });
            if (!res) break; // mossa non valida (fine variante o dato inatteso): interrompi qui

            if (turn === 'w') {
                parts.push(moveNumber + '.' + res.san);
            } else {
                parts.push(i === 0 ? (moveNumber + '...' + res.san) : res.san);
                moveNumber++;
            }
            turn = turn === 'w' ? 'b' : 'w';
        }
        return parts.join(' ');
    }

    // --- METODI PER IL CALCOLO CONTINUO (TIPO LICHESS) ---
    _parseEngineInfo(msg) {
        // Usa regex più tolleranti per estrapolare i dati ovunque si trovino nella stringa
        const depthMatch = msg.match(/\bdepth (\d+)/);
        const multipvMatch = msg.match(/\bmultipv (\d+)/);
        const scoreCpMatch = msg.match(/score cp (-?\d+)/);
        const scoreMateMatch = msg.match(/score mate (-?\d+)/);
        const pvMatch = msg.match(/ pv (.+)/);

        // Se non c'è l'informazione sulla profondità o sul punteggio, ignoriamo la riga
        if (!depthMatch || (!scoreCpMatch && !scoreMateMatch)) return;

        const depth = parseInt(depthMatch[1], 10);
        const pvIndex = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
        let score = 0;
        let type = 'cp';

        if (scoreCpMatch) {
            score = parseInt(scoreCpMatch[1], 10) / 100;
            type = 'cp';
        } else if (scoreMateMatch) {
            score = parseInt(scoreMateMatch[1], 10);
            type = 'mate';
        }

        // Adatta il punteggio dal punto di vista del bianco.
        // IMPORTANTE: usiamo il turno "congelato" al momento in cui è partita QUESTA
        // ricerca (this._searchTurn), non this.game.turn() letto ora. Altrimenti, se nel
        // frattempo è già stata giocata una nuova mossa (es. il matto finale) e arriva un
        // messaggio "info" in ritardo della ricerca precedente, il segno verrebbe invertito
        // e la eval bar mostrerebbe il colore sbagliato.
        const searchTurn = this._searchTurn || this.game.turn();
        if (searchTurn === 'b') {
            score = -score;
        }

        const moves = pvMatch ? pvMatch[1].trim().split(' ') : [];
        const bestMove = moves.length > 0 ? moves[0] : null;

        if (!this._multiPvLines) this._multiPvLines = [];
        this._multiPvLines[pvIndex - 1] = { depth, score, type, bestMove, moves };
        const lines = this._multiPvLines.filter(Boolean).map(l => ({
            ...l,
            sanLine: this._formatPvLine(l.moves, 8) // linea leggibile con fino a 8 semi-mosse
        }));
        const primary = lines[0] || { depth, score, type, bestMove };

        // Invia i dati processati alla UI (lines contiene fino a MultiPV varianti, ordinate)
        this.calculationCallback({
            depth: primary.depth,
            score: primary.score,
            type: primary.type,
            bestMove: primary.bestMove,
            lines
        });
    }

    startCalculating(callback, multiPv = 3) {
        if (!this.game) return;

        this.calculationCallback = callback;

        // Se la partita è già finita (scacco matto / stallo) non c'è nulla da far
        // calcolare al motore: notifichiamo subito il risultato finale.
        if (this.game.game_over()) {
            let result = '1/2-1/2';
            if (this.game.in_checkmate()) {
                // Chi è di turno ora è il giocatore che ha SUBITO il matto: l'altro ha vinto.
                result = this.game.turn() === 'w' ? '0-1' : '1-0';
            }

            // Importante: se una ricerca era ancora attiva sulla posizione PRECEDENTE
            // (es. "matto in 1"), i suoi messaggi "info" possono continuare ad arrivare
            // per qualche istante dopo lo stop. Annullando calculationCallback PRIMA di
            // fermare il motore, quei messaggi tardivi vengono ignorati (vedi onmessage)
            // e non sovrascrivono più il risultato "1-0"/"0-1" appena comunicato.
            this.calculationCallback = null;
            this._pendingSearch = null;
            if (this._isEngineSearching) {
                this.engine.postMessage('stop');
            }

            callback({ gameOver: true, result, depth: 0, score: 0, type: 'mate', bestMove: null, lines: [] });
            return;
        }

        const runSearch = () => {
            this._searchTurn = this.game.turn();
            this._multiPvLines = [];
            this.engine.postMessage('setoption name MultiPV value ' + multiPv);
            this.engine.postMessage(`position fen ${this.game.fen()}`);
            this.engine.postMessage('go infinite');
            this._isEngineSearching = true;
        };

        if (this._isEngineSearching) {
            // Una ricerca è già in corso: aspetta il "bestmove" di conferma
            // prima di mandare la nuova posizione, altrimenti il motore va in crash.
            this._pendingSearch = runSearch;
            this.engine.postMessage('stop');
        } else {
            runSearch();
        }
    }

    stopCalculating() {
        this.calculationCallback = null;
        this._pendingSearch = null;
        if (this._isEngineSearching) {
            this.engine.postMessage('stop');
        }
        this.engine.postMessage('setoption name MultiPV value 1');
    }
}

Chessboard.DEFAULT_NAG_INFO = DEFAULT_NAG_INFO;
window.Chessboard = Chessboard; // Compatibility for the NAG editor UI.
export default Chessboard;
