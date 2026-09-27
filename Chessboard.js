class Chessboard {
    constructor(containerSelector, config = {}) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) throw new Error("Container della scacchiera non trovato!");

        const defaults = {
            images: {
                pieces: {
                    wp: '', wn: '', wb: '', wr: '', wq: '', wk: '',
                    bp: '', bn: '', bb: '', br: '', bq: '', bk: ''
                },
                squares: { light: '', dark: '', highlight: '' },
                // Immagine custom per ciascun NAG (es. '$1': 'https://.../good.png').
                // Se un NAG non ha un'immagine qui, ne viene generata una di default
                // (badge SVG colorato) — vedi Chessboard.DEFAULT_NAG_INFO più sotto.
                nags: {}
            },
            colors: {
                selected: 'rgba(20, 85, 30, 0.5)',
                lastMove: 'rgba(155, 199, 0, 0.41)',
                suggestion: 'rgba(0, 0, 0, 0.25)',
                customHighlight: 'rgba(255, 0, 0, 0.5)',
                arrow: 'rgba(255,170,0,0.8)',
                availableMoveArrow: 'rgba(130, 160, 185, 0.4)',
                premove: 'rgba(214, 40, 40, 0.5)',
                // Colore di evidenziazione (e sfondo del badge di default) per ciascun NAG,
                // es. { '$1': '#3aa655' }. Se assente, si usa Chessboard.DEFAULT_NAG_INFO.
                nag: {}
            },
            showSuggestions: true,
            orientation: 'white' // 'white' o 'black'
        };

        // Merge "profondo" mirato: images.pieces, images.squares e colors vengono uniti
        // CHIAVE PER CHIAVE con i default, non sostituiti in blocco. Con uno spread
        // semplice ({...defaults, ...config}) basta che l'utente ometta anche una sola
        // chiave (es. "customHighlight") perché quel valore di default sparisca del
        // tutto: era esattamente la causa delle evidenziazioni col tasto destro invisibili.
        this.config = {
            ...defaults,
            ...config,
            images: {
                pieces: { ...defaults.images.pieces, ...(config.images && config.images.pieces) },
                squares: { ...defaults.images.squares, ...(config.images && config.images.squares) },
                nags: { ...defaults.images.nags, ...(config.images && config.images.nags) }
            },
            colors: {
                ...defaults.colors,
                ...config.colors,
                nag: { ...defaults.colors.nag, ...(config.colors && config.colors.nag) }
            }
        };

        this.onMoveCallback = null;

        // Motore
        this.engine = null;
        this.engineMessageQueue = [];
        this.calculationCallback = null; // Aggiunto per il calcolo continuo

        this.game = null;

        this.selectedSquare = null;
        this.lastMove = null;
        this._lastAnimatedMoveTo = null;

        this.isFlipped = this.config.orientation === 'black';

        this.arrowsMap = new Map();
        this.customHighlights = new Set();
        // Frecce "derivate" (es. mosse disponibili da questa posizione secondo
        // l'albero del PGN, stile lichess): vivono in una mappa separata da
        // quella delle frecce disegnate a mano, con colore diverso e senza
        // passare per onAnnotationChange (non sono qualcosa da salvare).
        this.availableMoveArrowsMap = new Map();
        this.onAnnotationChange = null; // notificato quando l'utente disegna/rimuove a mano frecce o evidenziazioni

        // NAG (Numeric Annotation Glyph) attualmente mostrato: { square, nag } oppure null.
        // Un solo NAG alla volta, agganciato alla casella di arrivo dell'ultima mossa —
        // per un visualizzatore PGN, si richiama setNag() a ogni cambio di mossa mostrata.
        this.currentNag = null;
        this._nagImageCache = new Map();

        this.drawingArrowFrom = null;

        // --- PREMOSSE ---
        // premoveColor: il colore ('w'/'b') per cui è permesso selezionare un
        // pezzo e "giocare" una mossa anche quando non è il suo turno — null
        // disattiva del tutto la funzionalità (usata solo in modalità DRILL).
        // premoveQueue: le mosse così pianificate, in ordine, senza limite di
        // lunghezza: vengono tentate una alla volta (mai tutte insieme) ad
        // ogni cambio di turno che riporta la mano a premoveColor. La prima
        // che risulta illegale nella posizione realmente raggiunta scarta
        // anche tutte quelle rimaste in coda dopo di lei.
        this.premoveColor = null;
        this.premoveQueue = [];

        // Variables Drag & Drop e Promozione
        this.isDragging = false;
        this.dragGhost = null;
        this.togglingSquare = null;
        this.pendingPromotion = null;

        // Binding globale per eventi Pointer
        this.boundHandlePointerMove = this._handlePointerMove.bind(this);
        this.boundHandlePointerUp = this._handlePointerUp.bind(this);
        this.boundHandlePointerCancel = this._handlePointerCancel.bind(this);
        document.addEventListener('pointermove', this.boundHandlePointerMove);
        document.addEventListener('pointerup', this.boundHandlePointerUp);
        // Se il pointer viene "perso" (alt-tab, gesture del sistema, ecc.) evitiamo
        // che isDragging/drawingArrowFrom restino bloccati e impediscano i click successivi.
        document.addEventListener('pointercancel', this.boundHandlePointerCancel);
        window.addEventListener('blur', this.boundHandlePointerCancel);

        this._initStyles();
        this._initLogic().then(() => {
            this._initDOM();
            this._initEngine();
            this.render();
        });
    }

    // --- INIZIALIZZAZIONE ---

    async _initLogic() {
        if (typeof Chess === 'undefined') {
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
        this.game = new Chess();
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

    _initStyles() {
        if (document.getElementById('chessboard-styles')) return;
        const style = document.createElement('style');
        style.id = 'chessboard-styles';
        style.innerHTML = `
            .cb-wrapper { position: relative; width: 100%; aspect-ratio: 1 / 1; user-select: none; -webkit-user-select: none; touch-action: none; }
            .cb-grid { display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); width: 100%; height: 100%; position: absolute; top: 0; left: 0; }
            .cb-square { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; background-size: cover; cursor: pointer; }
            /* Colore di base delle caselle: qui per CSS puro (sovrascrivibile
               dal foglio di stile della pagina ospite) invece che via
               data-URI passata come immagine di sfondo — quest'ultima, in
               certi contesti di hosting statico, può non venire applicata
               (background-image resta vuoto, casella trasparente). Un vero
               colore CSS non ha questo problema e resta comunque il
               fallback anche quando images.squares.light/dark è impostato. */
            .cb-square-light { background-color: #fefae0; }
            .cb-square-dark { background-color: #d4a373; }
            .cb-piece { width: 92%; height: 92%; z-index: 10; object-fit: contain; pointer-events: none; }
            .cb-piece-landed { animation: cb-piece-pop .22s cubic-bezier(.34, 1.56, .64, 1); }
            @keyframes cb-piece-pop {
                0% { transform: scale(0.55); opacity: 0.5; }
                60% { transform: scale(1.12); }
                100% { transform: scale(1); opacity: 1; }
            }
            /* Animazione di scorrimento: il pezzo arrivato viene posizionato
               (via JS, con transform e SENZA questa classe) esattamente sopra
               la casella di partenza, poi la classe viene aggiunta un frame
               dopo — la transition qui sotto anima il transform tornato a
               zero, facendolo scivolare visivamente da una casella all'altra. */
            .cb-piece-sliding { transition: transform .2s cubic-bezier(.22, .61, .36, 1); }
            .cb-piece-landed-wobble { animation: cb-piece-land-wobble .22s ease-out; }
            @keyframes cb-piece-land-wobble {
                0% { transform: scale(1); }
                35% { transform: scale(1.1, 0.9); }
                65% { transform: scale(0.96, 1.03); }
                100% { transform: scale(1); }
            }
            
            .cb-drag-ghost { position: fixed; z-index: 1000; pointer-events: none; object-fit: contain; }
            .cb-hidden-piece { opacity: 0; }
            
            .cb-promotion-menu { position: absolute; z-index: 30; background: white; border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
            .cb-promotion-piece { width: 100%; height: auto; cursor: pointer; padding: 4px; box-sizing: border-box; }
            .cb-promotion-piece:hover { background: rgba(0,0,0,0.1); border-radius: 4px; }

            .cb-suggestion { position: absolute; z-index: 15; pointer-events: none; box-sizing: border-box; }
            .cb-suggestion.move { width: 25%; height: 25%; }
            .cb-suggestion.capture { width: 80%; height: 80%; border-width: 5px; border-style: solid; background: transparent; }
            
            .cb-highlight { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; animation: cb-fade-in .15s ease; }
            .cb-error-flash { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 30; background-color: rgba(239, 68, 68, .75); animation: cb-error-flash .45s ease-out; }
            @keyframes cb-error-flash {
                0% { opacity: 0; }
                25% { opacity: 1; }
                100% { opacity: 0; }
            }
            .cb-check-indicator { position: absolute; width: 85%; height: 85%; background: radial-gradient(rgba(255, 30, 0, 1), transparent); z-index: 4; pointer-events: none; animation: cb-check-pulse 1s ease-in-out infinite; }
            @keyframes cb-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes cb-check-pulse {
                0%, 100% { opacity: .55; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.08); }
            }
            .cb-svg-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 20; pointer-events: none; }

            .cb-nag-badge { position: absolute; top: -8%; right: -8%; width: 52%; height: 52%; z-index: 25; pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.7)); }
        `;
        document.head.appendChild(style);
    }

    _initDOM() {
        this.container.innerHTML = '';
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'cb-wrapper';

        this.wrapper.addEventListener('contextmenu', (e) => {
            // Il menu nativo del tasto destro va sempre soppresso qui: 'contextmenu' è
            // l'unico evento che il browser garantisce di generare in modo affidabile per
            // QUALSIASI dispositivo (mouse, trackpad, Ctrl+click su Mac, ecc.).
            // La logica di evidenziazione/freccia però NON vive più qui: le coordinate di
            // questo evento corrispondono al punto in cui il tasto destro è stato PREMUTO,
            // non a quello in cui viene rilasciato — per un trascinamento (freccia) la
            // casella calcolata risultava quindi sempre uguale a quella di partenza. La
            // logica vera è in _handlePointerUp, che riceve la posizione di rilascio reale.
            e.preventDefault();
        });

        this.grid = document.createElement('div');
        this.grid.className = 'cb-grid';
        this._buildGrid();

        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'cb-svg-overlay');
        this.svg.setAttribute('viewBox', '0 0 800 800');

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        this.svg.appendChild(defs);

        // Due gruppi separati, in ordine fisso: le frecce "derivate" (mosse
        // disponibili, blu) stanno SEMPRE sotto quelle disegnate a mano
        // dall'utente/salvate nei commenti (gialle) — indipendentemente da
        // quale delle due venga ridisegnata per ultima.
        this.availableMoveArrowsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.arrowsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.svg.appendChild(this.availableMoveArrowsLayer);
        this.svg.appendChild(this.arrowsLayer);

        this.wrapper.appendChild(this.grid);
        this.wrapper.appendChild(this.svg);
        this.container.appendChild(this.wrapper);
    }

    _buildGrid() {
        this.grid.innerHTML = '';
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

        for (let r = 0; r < 8; r++) {
            const row = this.isFlipped ? (r + 1) : (8 - r);
            for (let c = 0; c < 8; c++) {
                const col = this.isFlipped ? (7 - c) : c;
                const sq = document.createElement('div');
                const isLight = (row + col) % 2 === 0;
                sq.className = 'cb-square ' + (isLight ? 'cb-square-light' : 'cb-square-dark');
                const sqName = files[col] + row;
                sq.dataset.sq = sqName;

                // Il colore "di base" arriva dalle classi cb-square-light/dark
                // sopra (CSS puro, sempre valido). Se l'app ospite fornisce
                // un'immagine custom per le caselle, questa si sovrappone
                // come background-image — ma il colore CSS resta comunque
                // sotto come fallback nel caso l'immagine non si carichi.
                if (isLight && this.config.images.squares.light) {
                    sq.style.backgroundImage = `url(${this.config.images.squares.light})`;
                } else if (!isLight && this.config.images.squares.dark) {
                    sq.style.backgroundImage = `url(${this.config.images.squares.dark})`;
                }

                sq.addEventListener('pointerdown', (e) => {
                    // IMPORTANTE: preventDefault() va chiamato solo per il tasto sinistro.
                    // Se lo chiami anche sul tasto destro, Chrome/Chromium sopprime il
                    // successivo evento 'contextmenu' (quello che gestisce evidenziazione
                    // e frecce) e il tasto destro smette di funzionare del tutto.
                    if (e.button !== 2) {
                        e.preventDefault();
                    }
                    this._handlePointerDown(e, sqName);
                });

                this.grid.appendChild(sq);
            }
        }
    }

    // --- METODO TOGGLE FLIP ---

    flipBoard() {
        this.isFlipped = !this.isFlipped;
        this._buildGrid();

        const currentArrows = Array.from(this.arrowsMap.keys()).map(pair => {
            const [from, to] = pair.split('-');
            return { from, to };
        });
        this.setArrows(currentArrows);

        const currentAvailable = Array.from(this.availableMoveArrowsMap.keys()).map(pair => {
            const [from, to] = pair.split('-');
            return { from, to };
        });
        this.showAvailableMoveArrows(currentAvailable);

        this.render();
    }

    // --- EVENTI D&D E MOUSE ---

    _handlePointerDown(e, sqName) {
        if (e.button === 2) {
            this.drawingArrowFrom = sqName;
        } else if (e.button === 0) {

            if (this.pendingPromotion) {
                const menu = this.wrapper.querySelector('.cb-promotion-menu');
                if (menu) menu.remove();
                this.pendingPromotion = null;
                this.selectedSquare = null;
                this.render();
                return;
            }

            this.clearArrows();
            this.clearCustomHighlights();

            if (this.selectedSquare && this.selectedSquare !== sqName) {
                if (this._attemptMove(this.selectedSquare, sqName)) {
                    return;
                }
            }

            const pezzo = this.game.get(sqName);

            if (this.selectedSquare === sqName) {
                this.togglingSquare = sqName;
            } else if (pezzo && (pezzo.color === this.game.turn() || pezzo.color === this.premoveColor)) {
                this.selectedSquare = sqName;
                this.togglingSquare = null;
            } else {
                this.selectedSquare = null;
                this.render();
                return;
            }

            this.render();

            if (this.selectedSquare === sqName && pezzo) {
                const cell = this.grid.querySelector(`[data-sq="${sqName}"]`);
                const pieceImg = cell.querySelector('.cb-piece');

                if (pieceImg) {
                    this.isDragging = true;

                    this.dragGhost = document.createElement('img');
                    this.dragGhost.className = 'cb-drag-ghost';
                    this.dragGhost.src = pieceImg.src;

                    const cellRect = cell.getBoundingClientRect();
                    this.dragGhost.style.width = cellRect.width * 0.92 + 'px';
                    this.dragGhost.style.height = cellRect.height * 0.92 + 'px';
                    this.dragGhost.style.left = (e.clientX - cellRect.width / 2) + 'px';
                    this.dragGhost.style.top = (e.clientY - cellRect.height / 2) + 'px';

                    document.body.appendChild(this.dragGhost);
                    this.render();
                }
            }
        }
    }

    _handlePointerMove(e) {
        if (this.isDragging && this.dragGhost) {
            const width = parseFloat(this.dragGhost.style.width);
            const height = parseFloat(this.dragGhost.style.height);
            this.dragGhost.style.left = (e.clientX - width / 2) + 'px';
            this.dragGhost.style.top = (e.clientY - height / 2) + 'px';
        }
    }

    _handlePointerUp(e) {
        const targetSq = this._getSquareFromEvent(e);

        if (e.button === 2) {
            // Qui la posizione di rilascio (targetSq, calcolata sopra) è quella reale.
            if (this.drawingArrowFrom && targetSq) {
                if (this.drawingArrowFrom !== targetSq) {
                    this.drawArrow(this.drawingArrowFrom, targetSq);
                } else {
                    this._toggleCustomHighlight(targetSq);
                }
            }
            this.drawingArrowFrom = null;
            return;
        }

        if (e.button === 0 && this.isDragging) {
            this.isDragging = false;
            if (this.dragGhost) {
                this.dragGhost.remove();
                this.dragGhost = null;
            }

            if (targetSq) {
                if (targetSq === this.selectedSquare) {
                    if (this.togglingSquare === targetSq) {
                        this.selectedSquare = null;
                    }
                    this.render();
                } else {
                    this._attemptMove(this.selectedSquare, targetSq);
                }
            } else {
                this.render();
            }
        }
    }

    _handlePointerCancel() {
        this.isDragging = false;
        this.drawingArrowFrom = null;
        if (this.dragGhost) {
            this.dragGhost.remove();
            this.dragGhost = null;
        }
    }

    _getSquareFromEvent(e) {
        const rect = this.grid.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) return null;

        let fileIdx = Math.floor((e.clientX - rect.left) / (rect.width / 8));
        let rankIdx = 7 - Math.floor((e.clientY - rect.top) / (rect.height / 8));
        if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;

        if (this.isFlipped) {
            fileIdx = 7 - fileIdx;
            rankIdx = 7 - rankIdx;
        }

        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        return files[fileIdx] + (rankIdx + 1);
    }

    // --- LOGICA DI MOVIMENTO E PROMOZIONE ---

    _attemptMove(from, to) {
        const pieceAtFrom = this.game.get(from);
        if (pieceAtFrom && this.premoveColor && pieceAtFrom.color === this.premoveColor
            && pieceAtFrom.color !== this.game.turn()) {
            return this._queuePremove(from, to);
        }

        const moves = this.game.moves({ verbose: true });
        const moveOptions = moves.filter(m => m.from === from && m.to === to);

        if (moveOptions.length === 0) {
            this.render();
            if (this.selectedSquare && this.config.showSuggestions) {
                this._showSuggestions(this.selectedSquare);
            }
            return false;
        }

        if (moveOptions.some(m => m.promotion)) {
            this.render();
            this._showPromotionMenu(from, to);
            return true;
        }

        this._executeMove({ from, to });
        return true;
    }

    /**
     * Accoda una premossa: nessuna validazione qui (la posizione in cui verrà
     * davvero giocata non è ancora nota, essendo l'avversario a dover ancora
     * rispondere) — si limita a ricordare from/to. Ne può accumulare quante se
     * ne vogliono, senza limite: verranno tentate una alla volta, nell'ordine
     * in cui sono state pianificate, ad ogni turno che torna a premoveColor
     * (vedi _flushNextPremove). Una premossa che risulta illegale nella
     * posizione realmente raggiunta scarta anche tutte quelle rimaste dopo.
     *
     * @param {String} from
     * @param {String} to
     * @returns {boolean} sempre true (accodare non può "fallire")
     */
    _queuePremove(from, to) {
        if (from !== to) this.premoveQueue.push({ from, to });
        this.selectedSquare = null;
        this.render();
        return true;
    }

    /**
     * Tenta la premossa più vecchia in coda, ORA che è realmente il turno di
     * premoveColor: se il from/to pianificato è ancora una mossa legale nella
     * posizione attuale la gioca (esattamente come una mossa vera trascinata
     * in questo istante — stesso _executeMove, stesso onMoveCallback: chi
     * ascolta non ha bisogno di sapere che si tratta di una premossa
     * "liberata"). Se non lo è più, scarta l'intera coda: una premossa
     * pianificata aveva senso solo in quella sequenza precisa.
     */
    _flushNextPremove() {
        if (!this.premoveQueue.length) return;
        const next = this.premoveQueue.shift();

        const legal = this.game.moves({ verbose: true })
            .some(m => m.from === next.from && m.to === next.to);

        if (!legal) {
            this.premoveQueue = [];
            this.render();
            this.flashSquareError(next.from);
            return;
        }

        this._executeMove({ from: next.from, to: next.to, promotion: next.promotion || 'q' });
    }

    /**
     * Abilita/disabilita le premosse per un colore (usata solo in modalità
     * DRILL, per il colore giocato dall'utente). Passare null le disattiva e
     * scarta subito qualunque premossa già pianificata.
     *
     * @param {'w'|'b'|null} color
     */
    setPremoveColor(color) {
        const normalized = color || null;
        if (normalized !== this.premoveColor) this.premoveQueue = [];
        this.premoveColor = normalized;
        this.render();
    }

    /** Scarta tutte le premosse pianificate senza giocarne nessuna. */
    clearPremoves() {
        if (!this.premoveQueue.length) return;
        this.premoveQueue = [];
        this.render();
    }

    hasPremoves() {
        return this.premoveQueue.length > 0;
    }

    _showPromotionMenu(from, to) {
        this.pendingPromotion = { from, to };

        const menu = document.createElement('div');
        menu.className = 'cb-promotion-menu';

        const color = this.game.turn();
        const pieces = ['q', 'r', 'b', 'n'];

        const fileIdx = to.charCodeAt(0) - 'a'.charCodeAt(0);
        const visFileIdx = this.isFlipped ? (7 - fileIdx) : fileIdx;

        menu.style.left = `${visFileIdx * 12.5}%`;
        menu.style.width = '12.5%';

        const isTop = this.isFlipped ? (color === 'b') : (color === 'w');
        if (isTop) {
            menu.style.top = '0';
        } else {
            menu.style.bottom = '0';
        }

        pieces.forEach(p => {
            const img = document.createElement('img');
            img.className = 'cb-promotion-piece';
            img.src = this.config.images.pieces[color + p];

            img.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                this._executeMove({ from, to, promotion: p });
                menu.remove();
                this.pendingPromotion = null;
            });
            menu.appendChild(img);
        });

        this.wrapper.appendChild(menu);
    }

    _executeMove(moveObj) {
        if (!moveObj.promotion) moveObj.promotion = 'q';

        const move = this.game.move(moveObj);
        if (move) {
            this.selectedSquare = null;
            this.lastMove = { from: move.from, to: move.to };
            this.currentNag = null; // il NAG era legato alla mossa precedente, ora non più valido
            this.render();
            if (this.onMoveCallback) this.onMoveCallback(move);

            // Il turno è appena tornato a premoveColor: se aveva già pianificato
            // una mossa, questo è esattamente il momento di tentarla.
            if (this.premoveColor && this.game.turn() === this.premoveColor && this.premoveQueue.length) {
                this._flushNextPremove();
            }
        }
    }

    // --- NAVIGAZIONE POSIZIONE ---
    // Chessboard.js espone solo tre metodi per cambiare posizione dall'esterno:
    // makeMove (avanti), undoMove (indietro di una mossa) e setPosition (salta a
    // una posizione arbitraria). La logica di navigazione "a più mosse" (frecce
    // tastiera, click sulle mosse in lista, avanzamento nell'albero delle varianti...)
    // vive fuori da questa classe (in main.js), che orchestra questi tre metodi
    // insieme al proprio MoveTree.

    /**
     * Torna indietro di una mossa (undo). In caso di successo notifica
     * onMoveCallback con `null`, cosicché chi consuma la board sappia che si
     * tratta di un passo indietro (e non di una nuova mossa giocata) e possa
     * sincronizzare di conseguenza il proprio stato (es. tree.moveUp()).
     *
     * @returns {Object|null} la mossa annullata (formato chess.js) oppure null
     */
    undoMove() {
        if (!this.game) return null;
        const move = this.game.undo();
        if (move) {
            const hist = this.game.history({ verbose: true });
            this.lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
            this.selectedSquare = null;
            this.currentNag = null;
            this.clearArrows();
            this.clearAvailableMoveArrows();
            this.clearCustomHighlights();
            this.render();
            // Notifica il consumer del cambio posizione (utile per fermare/riavviare l'analisi motore)
            if (this.onMoveCallback) this.onMoveCallback(null);
        }
        return move;
    }

    /**
     * Come undoMove(), ma NON notifica onMoveCallback. Serve quando una mossa
     * va "rifiutata" a livello applicativo subito dopo essere stata giocata
     * (es. fuori repertorio in modalità drill): la si annulla per riportare
     * la board esattamente a come'era, senza che questo venga trattato come
     * una navigazione vera (altrimenti chi ascolta il callback penserebbe che
     * ci si sia spostati di una posizione nell'albero, cosa che qui non è
     * mai avvenuta).
     *
     * @returns {Object|null} la mossa annullata (formato chess.js) oppure null
     */
    undoSilently() {
        if (!this.game) return null;
        const move = this.game.undo();
        if (move) {
            const hist = this.game.history({ verbose: true });
            this.lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
            this.selectedSquare = null;
            this.currentNag = null;
            this.clearArrows();
            this.clearAvailableMoveArrows();
            this.clearCustomHighlights();
            this.render();
        }
        return move;
    }

    /**
     * Fa lampeggiare di rosso una casella per un istante — usato per segnalare
     * un tentativo di mossa "sbagliato" (es. fuori repertorio in modalità
     * drill), senza dover gestire un'evidenziazione persistente da rimuovere
     * a mano.
     *
     * @param {String} sqName - es. 'e4'
     */
    flashSquareError(sqName) {
        const cell = this.grid.querySelector(`[data-sq="${sqName}"]`);
        if (!cell) return;

        const flash = document.createElement('div');
        flash.className = 'cb-error-flash';
        cell.appendChild(flash);
        flash.addEventListener('animationend', () => flash.remove());
    }

    /**
     * Carica una posizione arbitraria sulla scacchiera. Passando una stringa FEN,
     * la board salta direttamente a quella posizione; passando null/undefined/'start'
     * torna alla posizione iniziale. Utile per caricare un PGN da un punto qualsiasi
     * o per resettare la board (es. a fine linea in modalità drill).
     *
     * Un FEN puro non porta con sé alcuno storico (chess.js lo azzera ad ogni
     * .load()), quindi senza aiuto la board non saprebbe mai qual è stata
     * "l'ultima mossa" dopo un salto — niente evidenziazione dell'ultima mossa,
     * niente NAG (che si appoggia proprio a quella casella). Chi chiama
     * setPosition() e conosce già la mossa che ha portato a questo FEN (es. lo
     * strato di navigazione, che l'ha appena rigiocata su un'istanza usa e
     * getta per calcolare il FEN) può passarla esplicitamente qui.
     *
     * @param {String} [fen] - posizione FEN, oppure omesso/'start' per la posizione iniziale
     * @param {{from: String, to: String}} [lastMove] - ultima mossa nota per questa posizione, se disponibile
     * @returns {boolean} true se la posizione è stata caricata con successo
     */
    setPosition(fen, lastMove = null) {
        if (!this.game) return false;

        const ok = (!fen || fen === 'start') ? (this.game.reset(), true) : this.game.load(fen);
        if (!ok) return false;

        if (lastMove) {
            this.lastMove = lastMove;
        } else {
            const hist = this.game.history({ verbose: true });
            this.lastMove = hist.length ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to } : null;
        }
        this.selectedSquare = null;
        this.currentNag = null;
        this.clearArrows();
        this.clearAvailableMoveArrows();
        this.clearCustomHighlights();
        this.render();

        // Come in _executeMove: la mossa del pc in modalità drill arriva qui
        // (via goForward/rebuildAndJump, non _executeMove) — è comunque un
        // cambio di turno vero e proprio, quindi va controllato allo stesso modo.
        if (this.premoveColor && this.game.turn() === this.premoveColor && this.premoveQueue.length) {
            this._flushNextPremove();
        }

        return true;
    }

    // --- INTERAZIONE E RENDERING ---

    render() {
        if (!this.game) return;

        document.querySelectorAll('.cb-piece, .cb-suggestion, .cb-highlight, .cb-check-indicator, .cb-nag-badge').forEach(el => el.remove());

        // L'animazione "pop" del pezzo appena arrivato deve scattare una sola
        // volta per mossa, non ad ogni render() — render() viene richiamato
        // anche da semplici click/selezioni che non spostano alcun pezzo, e
        // senza questo controllo l'ultimo pezzo mosso "wobblava" di nuovo ad
        // ogni click a vuoto sulla scacchiera.
        const newlyMovedTo = (this.lastMove && this.lastMove.to !== this._lastAnimatedMoveTo)
            ? this.lastMove.to
            : null;
        this._lastAnimatedMoveTo = this.lastMove ? this.lastMove.to : null;

        const board = this.game.board();
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const inCheck = this.game.in_check();
        const turn = this.game.turn();

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const sqName = files[c] + (8 - r);
                const cell = this.grid.querySelector(`[data-sq="${sqName}"]`);
                const piece = board[r][c];

                if (cell) {
                    // Priorità del colore "di base" della casella: selezione (interazione
                    // attiva dell'utente) > ultima mossa (colore di default). Il NAG non
                    // tinge più l'intera casella (era troppo invadente sull'occhio ad ogni
                    // mossa annotata) — resta comunque visibile tramite il badge più sotto.
                    if (this.selectedSquare === sqName) {
                        this._addHighlight(cell, this.config.colors.selected);
                    } else if (this.lastMove && (this.lastMove.from === sqName || this.lastMove.to === sqName)) {
                        this._addHighlight(cell, this.config.colors.lastMove);
                    }

                    if (this.customHighlights.has(sqName)) {
                        this._addHighlight(cell, this.config.colors.customHighlight, 'custom');
                    }

                    // Premosse pianificate: casella di partenza E di arrivo di
                    // ciascuna, in rosso — così si vede a colpo d'occhio l'intera
                    // sequenza che si è messa in coda, non solo l'ultima.
                    if (this.premoveQueue.length) {
                        this.premoveQueue.forEach(pm => {
                            if (pm.from === sqName || pm.to === sqName) {
                                this._addHighlight(cell, this.config.colors.premove, 'custom');
                            }
                        });
                    }

                    if (this.currentNag && this.currentNag.square === sqName) {
                        this._addNagBadge(cell, this.currentNag.nag);
                    }

                    if (piece) {
                        if (inCheck && piece.type === 'k' && piece.color === turn) {
                            const checkInd = document.createElement('div');
                            checkInd.className = 'cb-check-indicator';
                            cell.appendChild(checkInd);
                        }

                        const img = document.createElement('img');
                        img.className = 'cb-piece';

                        // Scorrimento: il pezzo arrivato viene posizionato (via transform,
                        // senza transition) esattamente sopra la casella di PARTENZA usando
                        // le coordinate reali degli elementi — funziona sia a scacchiera
                        // dritta che flippata, senza dover rifare i conti riga/colonna. Un
                        // frame dopo si toglie il transform (con la transition stavolta
                        // attiva): il pezzo scivola visivamente da una casella all'altra
                        // invece di comparire di scatto sulla destinazione.
                        let slideFrom = null;
                        if (this.lastMove && this.lastMove.to === sqName && newlyMovedTo === sqName) {
                            const fromCell = this.grid.querySelector(`[data-sq="${this.lastMove.from}"]`);
                            if (fromCell) {
                                const fromRect = fromCell.getBoundingClientRect();
                                const toRect = cell.getBoundingClientRect();
                                const dx = fromRect.left - toRect.left;
                                const dy = fromRect.top - toRect.top;
                                if (dx || dy) slideFrom = { dx, dy };
                            }
                        }

                        if (slideFrom) {
                            img.style.transform = `translate(${slideFrom.dx}px, ${slideFrom.dy}px)`;
                        } else if (this.lastMove && this.lastMove.to === sqName && newlyMovedTo === sqName) {
                            // Nessuna casella di partenza nota (es. pezzo apparso da una
                            // promozione sulla stessa casella): resta il "pop" sul posto.
                            img.classList.add('cb-piece-landed');
                        }

                        if (this.isDragging && this.selectedSquare === sqName) {
                            img.classList.add('cb-hidden-piece');
                        }

                        const pieceKey = piece.color + piece.type;
                        img.src = this.config.images.pieces[pieceKey] || '';
                        cell.appendChild(img);

                        if (slideFrom) {
                            // Doppio requestAnimationFrame: serve a garantire che il browser
                            // dipinga la posizione di partenza (transform impostato sopra,
                            // SENZA transition) prima di applicare la classe che attiva la
                            // transition — un solo rAF a volte capita nello stesso frame di
                            // paint e l'animazione salterebbe, con il pezzo che compare già
                            // arrivato invece di scivolare.
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    img.classList.add('cb-piece-sliding');
                                    img.style.transform = 'translate(0, 0)';
                                });
                            });

                            // Un mini "wobble" quando lo scivolamento finisce — non prima:
                            // sovrapporre subito una seconda animazione sullo stesso transform
                            // (scale) romperebbe la transition della posizione. Se nel
                            // frattempo si fa un'altra mossa, questo <img> viene rimosso dal
                            // DOM (ogni render() ricrea tutti i pezzi da zero): l'evento non
                            // scatta più e l'animazione resta semplicemente interrotta a metà,
                            // esattamente il comportamento voluto per non dover mai aspettare.
                            img.addEventListener('transitionend', () => {
                                img.classList.remove('cb-piece-sliding');
                                img.classList.add('cb-piece-landed-wobble');
                            }, { once: true });
                        }
                    }
                }
            }
        }

        if (this.selectedSquare && this.config.showSuggestions) {
            this._showSuggestions(this.selectedSquare);
        }
    }

    _addHighlight(cell, color, type = 'auto') {
        const h = document.createElement('div');
        h.className = 'cb-highlight';
        if (type === 'custom') h.classList.add('custom');
        h.style.backgroundColor = color;
        cell.appendChild(h);
    }

    // --- METODI GESTIONE NAG ---

    // Risolve colore + immagine da usare per un NAG: config.images.nags/colors.nag
    // dell'utente hanno la priorità, altrimenti si ripiega su DEFAULT_NAG_INFO,
    // e in ultima istanza su un badge grigio col codice numerico del NAG.
    _getNagVisual(nagCode) {
        const info = Chessboard.DEFAULT_NAG_INFO[nagCode];
        const color = (this.config.colors.nag && this.config.colors.nag[nagCode])
            || (info && info.color)
            || '#707070';

        const customImage = this.config.images.nags && this.config.images.nags[nagCode];
        const image = customImage || this._getDefaultNagImage(nagCode, color);

        return { color, image };
    }

    // Genera (e mette in cache) un badge SVG rotondo col simbolo del NAG sul colore
    // dato, come data URI — nessuna immagine esterna richiesta, resta nitido a
    // qualsiasi dimensione e il colore combacia sempre con quello dell'highlight.
    _getDefaultNagImage(nagCode, color) {
        const cacheKey = nagCode + '|' + color;
        if (this._nagImageCache.has(cacheKey)) {
            return this._nagImageCache.get(cacheKey);
        }

        const info = Chessboard.DEFAULT_NAG_INFO[nagCode];
        // Sceglie testo scuro o chiaro in base alla luminosità dello sfondo:
        // prima il badge usava sempre testo bianco, illeggibile sui colori
        // chiari (es. il giallo di $6) — questo lo risolve alla radice.
        const inkColor = this._getContrastColor(color);

        let glyph;
        if (info && info.icon === 'star') {
            glyph = `<polygon points="${this._starPoints(50, 51, 28, 11)}" fill="${inkColor}"/>`;
        } else if (info && info.icon === 'thumbsup') {
            // SVG fornito dall'utente (icona "hand-thumbs-up-fill" di Bootstrap
            // Icons, viewBox nativo 0 0 16 16): scalata e centrata nel badge.
            glyph = `<g fill="${inkColor}" transform="translate(18,18) scale(4)">`
                + `<path d="M6.956 1.745C7.021.81 7.908.087 8.864.325l.261.066c.463.116.874.456 1.012.965`
                + `.22.816.533 2.511.062 4.51a9.84 9.84 0 0 1 .443-.051c.713-.065 1.669-.072 2.516.21`
                + `.518.173.994.681 1.2 1.273.184.532.16 1.162-.234 1.733.058.119.103.242.138.363`
                + `.077.27.113.567.113.856 0 .289-.036.586-.113.856-.039.135-.09.273-.16.404`
                + `.169.387.107.819-.003 1.148a3.163 3.163 0 0 1-.488.901c.054.152.076.312.076.465 `
                + `0 .305-.089.625-.253.912C13.1 15.522 12.437 16 11.5 16H8c-.605 0-1.07-.081-1.466-.218`
                + `a4.82 4.82 0 0 1-.97-.484l-.048-.03c-.504-.307-.999-.609-2.068-.722`
                + `C2.682 14.464 2 13.846 2 13V9c0-.85.685-1.432 1.357-1.615.849-.232 1.574-.787 2.132-1.41`
                + `.56-.627.914-1.28 1.039-1.639.199-.575.356-1.539.428-2.59z"/>`
                + `</g>`;
        } else {
            // "Faux bold": oltre al font-weight, si applica al testo uno stroke dello
            // STESSO colore del fill (paint-order="stroke") — ingrassa otticamente i
            // tratti del glifo indipendentemente dal fatto che il font/renderer supporti
            // davvero il grassetto (molti font di sistema per simboli come !,?,□,∞ non
            // hanno una variante bold reale e font-weight da solo non basta).
            const symbol = (info && info.symbol) || nagCode.replace('$', '');
            glyph = `<text x="50" y="54" text-anchor="middle" dominant-baseline="middle" `
                + `font-family="Inter" font-weight="700" `
                + `font-size="${symbol.length > 1 ? 46 : 62}" fill="${inkColor}" `
                + `stroke="${inkColor}" stroke-width="3" paint-order="stroke fill" `
                + `stroke-linejoin="round">${symbol}</text>`;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
            + `<circle cx="50" cy="50" r="46" fill="${color}" stroke="white" stroke-width="6"/>`
            + glyph
            + `</svg>`;

        const dataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        this._nagImageCache.set(cacheKey, dataUri);
        return dataUri;
    }

    // Punti di un poligono a stella a 5 punte, per il NAG "best move".
    _starPoints(cx, cy, outerR, innerR) {
        const pts = [];
        for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const angle = (Math.PI / 5) * i - Math.PI / 2;
            pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
        }
        return pts.join(' ');
    }

    // Testo scuro su sfondi chiari, testo chiaro su sfondi scuri (luminosità
    // relativa approssimata). Fallback al bianco se il colore non è in forma #rrggbb
    // (es. un rgba() passato come override) — evitiamo di provare a fare i conti.
    _getContrastColor(hex) {
        const c = String(hex).replace('#', '');
        if (c.length !== 6) return '#ffffff';
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.62 ? '#20232a' : '#ffffff';
    }

    _addNagBadge(cell, nagCode) {
        const visual = this._getNagVisual(nagCode);
        const badge = document.createElement('img');
        badge.className = 'cb-nag-badge';
        badge.src = visual.image;
        cell.appendChild(badge);
    }

    _showSuggestions(sqName) {
        const moves = this.game.moves({ square: sqName, verbose: true });
        const seenTargets = new Set();

        moves.forEach(m => {
            if (seenTargets.has(m.to)) return;
            seenTargets.add(m.to);

            const cell = this.grid.querySelector(`[data-sq="${m.to}"]`);
            if (cell) {
                const hint = document.createElement('div');
                hint.className = 'cb-suggestion';

                if (m.flags.includes('c') || m.flags.includes('e')) {
                    hint.classList.add('capture');
                    hint.style.borderColor = this.config.colors.suggestion;
                } else {
                    hint.classList.add('move');
                    hint.style.backgroundColor = this.config.colors.suggestion;
                }

                cell.appendChild(hint);
            }
        });
    }

    // --- METODI GESTIONE HIGHLIGHTS CUSTOM (TASTO DX) ---

    _toggleCustomHighlight(sqName) {
        if (this.customHighlights.has(sqName)) {
            this.customHighlights.delete(sqName);
        } else {
            this.customHighlights.add(sqName);
        }
        this.render();
        if (this.selectedSquare && this.config.showSuggestions) {
            this._showSuggestions(this.selectedSquare);
        }
        if (this.onAnnotationChange) this.onAnnotationChange();
    }

    clearCustomHighlights() {
        this.customHighlights.clear();
        this.render();
        if (this.selectedSquare && this.config.showSuggestions) {
            this._showSuggestions(this.selectedSquare);
        }
    }

    /**
     * @returns {String[]} le caselle evidenziate a mano — utile per salvarle
     * come metadati.
     */
    getCustomHighlights() {
        return Array.from(this.customHighlights);
    }

    /**
     * Ripristina "in silenzio" un set di caselle evidenziate a mano (es.
     * quando si torna su una mossa che ne ha di salvate).
     *
     * @param {String[]} squares
     */
    setCustomHighlights(squares = []) {
        this.customHighlights.clear();
        squares.forEach(sq => this.customHighlights.add(sq));
        this.render();
    }

    // --- METODI PUBBLICI STANDARD ---

    setOnMoveCallback(callback) { this.onMoveCallback = callback; }

    /**
     * Notificata quando l'utente disegna/rimuove a mano una freccia o
     * un'evidenziazione (tasto destro) — mai per le frecce derivate
     * (showAvailableMoveArrows) né per i ripristini "silenziosi" (setArrows/
     * setCustomHighlights), che non vanno ri-salvati su se stessi.
     */
    setOnAnnotationChange(callback) { this.onAnnotationChange = callback; }

    hideMovesSuggestions() {
        this.config.showSuggestions = false;
        this.render();
    }

    showMovesSuggestions() {
        this.config.showSuggestions = true;
        if (this.selectedSquare) {
            this._showSuggestions(this.selectedSquare);
        }
    }

    /**
     * Mostra (o rimuove) un simbolo NAG sulla casella di arrivo dell'ultima mossa
     * giocata, evidenziandola del colore associato al NAG. Se quella casella è
     * selezionata dall'utente, mostra il colore di selezione al posto del colore
     * del NAG (il simbolo resta comunque visibile); appena deselezionata torna
     * al colore del NAG.
     *
     * @param {String|null} nagCode - es. '$1', '$3', '$6'... oppure null/undefined per rimuoverlo
     */
    /**
     * Espone pubblicamente il visual (immagine + colore) usato internamente per un
     * dato NAG — utile per disegnare altrove (es. una palette di pulsanti nel tab
     * di editing) icone identiche a quelle mostrate sulla scacchiera da setNag().
     *
     * @param {String} nagCode - es. '$1', '$3'...
     * @returns {{color: String, image: String}}
     */
    getNagVisual(nagCode) {
        return this._getNagVisual(nagCode);
    }

    setNag(nagCode) {
        if (!nagCode) {
            this.currentNag = null;
            this.render();
            return;
        }

        if (!this.lastMove) {
            console.warn("setNag: no move on the board, cannot place the NAG.");
            return;
        }

        this.currentNag = { square: this.lastMove.to, nag: nagCode };
        this.render();
    }

    /**
     * Gioca una mossa programmaticamente (es. SAN "Nf3", oppure {from,to,promotion}).
     * A differenza del drag&drop dell'utente passa per lo stesso game.move() di
     * chess.js, e allo stesso modo notifica onMoveCallback in caso di successo —
     * così chi ascolta il callback (es. main.js, per sincronizzare il MoveTree)
     * si comporta allo stesso modo sia per le mosse giocate a mano sia per quelle
     * fatte avanzare via codice (frecce tastiera, click su una mossa in lista...).
     *
     * @param {String|Object} pgn_move - mossa in notazione SAN, oppure oggetto {from, to, promotion}
     * @returns {Object|null} la mossa giocata (formato chess.js) oppure null se non valida
     */
    makeMove(pgn_move) {
        if (!this.game) return null;
        const res = this.game.move(pgn_move);
        if (res) {
            this.selectedSquare = null;
            this.lastMove = { from: res.from, to: res.to };
            this.currentNag = null;
            this.clearArrows();
            this.clearAvailableMoveArrows();
            this.clearCustomHighlights();
            this.render();
            if (this.onMoveCallback) this.onMoveCallback(res);
        }
        return res;
    }

    // --- GESTIONE FRECCE AVANZATA ---

    /**
     * Costruisce (senza inserirlo nel DOM né tracciarlo in nessuna mappa) il
     * path SVG di una freccia da `from` a `to` in un dato colore. Estratto da
     * drawArrow così la stessa geometria si riusa sia per le frecce disegnate
     * a mano sia per quelle "derivate" (mosse disponibili).
     */
    _createArrowPath(from, to, color) {
        const files = { 'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4, 'f': 5, 'g': 6, 'h': 7 };

        const col1 = files[from[0]];
        const row1 = parseInt(from[1]);
        const col2 = files[to[0]];
        const row2 = parseInt(to[1]);

        let x1 = (this.isFlipped ? (7 - col1) : col1) * 100 + 50;
        let y1 = (this.isFlipped ? (row1 - 1) : (8 - row1)) * 100 + 50;
        const x2 = (this.isFlipped ? (7 - col2) : col2) * 100 + 50;
        const y2 = (this.isFlipped ? (row2 - 1) : (8 - row2)) * 100 + 50;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dx = x2 - x1;
        const dy = y2 - y1;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        const offset = 35;

        if ((absDx === 100 && absDy === 200) || (absDx === 200 && absDy === 100)) {
            if (absDx > absDy) {
                const endY = y2 - (dy > 0 ? offset : -offset);
                x1 += (dx > 0 ? offset : -offset);
                path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${endY}`);
            } else {
                y1 += (dy > 0 ? offset : -offset);
                const endX = x2 - (dx > 0 ? offset : -offset);
                path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y2} L ${endX} ${y2}`);
            }
        } else {
            const angle = Math.atan2(dy, dx);
            x1 += Math.cos(angle) * offset;
            y1 += Math.sin(angle) * offset;

            const x2_trimmed = x2 - Math.cos(angle) * offset;
            const y2_trimmed = y2 - Math.sin(angle) * offset;
            path.setAttribute('d', `M ${x1} ${y1} L ${x2_trimmed} ${y2_trimmed}`);
        }

        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '20');
        path.setAttribute('fill', 'none');
        path.setAttribute('marker-end', `url(#${this._ensureArrowMarker(color)})`);

        return path;
    }

    // Crea (una sola volta per colore, cache nel <defs>) il marker della punta
    // della freccia in quel colore — prima ce n'era uno solo fisso arancione,
    // quindi le frecce di colore diverso (es. quelle blu delle mosse
    // disponibili) avevano la punta sbagliata.
    _ensureArrowMarker(color) {
        const markerId = 'arrowhead-' + String(color).replace(/[^a-zA-Z0-9]/g, '');
        if (this.svg.querySelector(`#${markerId}`)) return markerId;

        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', markerId);
        marker.setAttribute('markerWidth', '2.6');
        marker.setAttribute('markerHeight', '2.6');
        marker.setAttribute('refX', '0');
        marker.setAttribute('refY', '1.1');
        marker.setAttribute('orient', 'auto');

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 2.2 1.1, 0 2.2');
        polygon.setAttribute('fill', color);
        marker.appendChild(polygon);

        this.svg.querySelector('defs').appendChild(marker);
        return markerId;
    }

    /**
     * Disegna (o rimuove, se già presente: è un toggle) una freccia disegnata
     * a mano tra due caselle. Interattiva: notifica onAnnotationChange così
     * chi ascolta (main.js) può salvarla nel commento della mossa corrente.
     */
    drawArrow(from, to) {
        const arrowId = `${from}-${to}`;

        if (this.arrowsMap.has(arrowId)) {
            this.arrowsMap.get(arrowId).remove();
            this.arrowsMap.delete(arrowId);
        } else {
            const path = this._createArrowPath(from, to, this.config.colors.arrow);
            this.arrowsLayer.appendChild(path);
            this.arrowsMap.set(arrowId, path);
        }

        if (this.onAnnotationChange) this.onAnnotationChange();
    }

    clearArrows() {
        this.arrowsMap.forEach(path => path.remove());
        this.arrowsMap.clear();
    }

    /**
     * @returns {{from: String, to: String}[]} le frecce disegnate a mano
     * attualmente presenti — utile per salvarle come metadati.
     */
    getArrows() {
        return Array.from(this.arrowsMap.keys()).map(key => {
            const [from, to] = key.split('-');
            return { from, to };
        });
    }

    /**
     * Ripristina "in silenzio" un set di frecce disegnate a mano (es. quando
     * si torna su una mossa che ne ha di salvate) — NON notifica
     * onAnnotationChange, altrimenti si ri-salverebbero su se stesse.
     *
     * @param {{from: String, to: String}[]} arrows
     */
    setArrows(arrows = []) {
        this.clearArrows();
        arrows.forEach(({ from, to }) => {
            const arrowId = `${from}-${to}`;
            const path = this._createArrowPath(from, to, this.config.colors.arrow);
            this.arrowsLayer.appendChild(path);
            this.arrowsMap.set(arrowId, path);
        });
    }

    /**
     * Mostra le frecce "derivate" (es. le mosse disponibili da questa
     * posizione secondo l'albero del PGN, come nello study mode di lichess):
     * colore diverso da quelle disegnate a mano, ricalcolate ad ogni cambio
     * posizione dall'app, mai salvate.
     *
     * @param {{from: String, to: String}[]} moves
     * @param {String} [color]
     */
    showAvailableMoveArrows(moves = [], color = this.config.colors.availableMoveArrow) {
        this.clearAvailableMoveArrows();
        moves.forEach(({ from, to }) => {
            const path = this._createArrowPath(from, to, color);
            this.availableMoveArrowsLayer.appendChild(path);
            this.availableMoveArrowsMap.set(`${from}-${to}`, path);
        });
    }

    clearAvailableMoveArrows() {
        this.availableMoveArrowsMap.forEach(path => path.remove());
        this.availableMoveArrowsMap.clear();
    }

    // --- STOCKFISH ENGINE ---

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

// Mappa di default simbolo+colore per i NAG più comuni (standard PGN), con colori
// ispirati alle convenzioni più familiari di chess.com e lichess.org (teal per la
// mossa brillante, verde per la buona mossa, giallo/arancio/rosso per imprecisione/
// errore/svista, blu per la mossa interessante). Non sono valori "ufficiali" — nessuno
// dei due siti pubblica una palette esatta e i toni sono leggermente cambiati nel
// tempo — ma sono quelli più riconoscibili a colpo d'occhio. Un utente può comunque
// sovrascrivere il colore (config.colors.nag) e/o fornire una propria immagine
// (config.images.nags) per uno o più codici, senza dover ridefinire l'intera mappa.
Chessboard.DEFAULT_NAG_INFO = {
    // Prima i NAG che hanno un corrispondente diretto in chess.com, in
    // ordine di gravità decrescente (dalla mossa migliore alla peggiore):
    // brillante > great > best > excellent > inaccuratezza > errore > blunder.
    '$3':   { symbol: '!!',     color: '#1baca6' }, // brilliant
    '$1':   { symbol: '!',      color: '#5c8bb0' }, // great
    '$102': { icon: 'star',     color: '#81b64c' }, // best move (chess.com-style)
    '$101': { icon: 'thumbsup', color: '#96bc4b' }, // excellent move (chess.com-style)
    '$6':   { symbol: '?!',     color: '#f0c33d' }, // inaccuratezza
    '$2':   { symbol: '?',      color: '#e6912c' }, // errore/mistake
    '$4':   { symbol: '??',     color: '#fa412d' }, // svista/blunder

    // Poi le annotazioni PGN standard che chess.com non ha, in ordine di
    // "gravità" via via meno legata a un giudizio buono/cattivo.
    '$5':  { symbol: '!?',  color: '#3593d6' }, // mossa interessante
    '$7':  { symbol: '➡',  color: '#6fa06f' }, // mossa forzata/unica
    '$10': { symbol: '=',  color: '#8a8a8a' }, // posizione pari
    '$13': { symbol: '∞',  color: '#5c7cba' }, // posizione poco chiara
    '$14': { symbol: '⩲',  color: '#9aa5ab' }, // leggero vantaggio bianco
    '$15': { symbol: '⩱',  color: '#9aa5ab' }, // leggero vantaggio nero
    '$16': { symbol: '±',  color: '#4c8f3c' }, // vantaggio bianco
    '$17': { symbol: '∓',  color: '#a34a4a' }, // vantaggio nero
    '$18': { symbol: '+−', color: '#2f6e26' }, // bianco vincente
    '$19': { symbol: '−+', color: '#7a2e2e' }  // nero vincente
};

// Chessboard.js resta uno script "classico" (non un modulo ES) per poter fare
// data-URI SVG/immagini senza build step. main.js invece è un modulo ES: i moduli
// risolvono gli identificatori liberi risalendo fino al Global Environment
// condiviso, quindi `Chessboard` sarebbe comunque visibile — ma per non dipendere
// da questo dettaglio di scoping la esponiamo esplicitamente anche su window.
window.Chessboard = Chessboard;
