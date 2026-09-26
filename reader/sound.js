/**
 * Effetti sonori dell'app, generati interamente via Web Audio API — nessun
 * file .mp3 da scaricare o mantenere: ogni suono è sintetizzato al volo con
 * oscillatori + inviluppi di volume, quindi funziona anche offline e pesa
 * zero byte extra. Se il contesto audio non può partire (autoplay bloccato
 * dal browser prima di un'interazione, o API assente) l'errore viene
 * semplicemente ignorato: un suono mancante non deve mai rompere l'app.
 */

let muted = false;
let ctx = null;

function getCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
}

function ensureRunning() {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    return c;
}

/**
 * Suona un singolo tono con inviluppo ADSR semplificato (attack/decay rapidi,
 * poi release), così ogni nota ha un attacco morbido e nessun "click" digitale.
 *
 * @param {AudioContext} c
 * @param {number} freq - Hz
 * @param {number} startAt - offset in secondi da ora
 * @param {number} dur - durata totale in secondi
 * @param {Object} [opts]
 */
function tone(c, freq, startAt, dur, opts = {}) {
    const {
        type = 'sine',
        peakGain = 0.22,
        attack = 0.006,
        release = null,
        detune = 0,
        glideTo = null,
    } = opts;

    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + startAt);
    if (detune) osc.detune.setValueAtTime(detune, c.currentTime + startAt);
    if (glideTo) {
        osc.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + startAt + dur);
    }

    const rel = release ?? dur * 0.7;
    const t0 = c.currentTime + startAt;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + attack + rel);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
}

/**
 * Rumore bianco filtrato molto breve, usato per lo "swoosh" di cancellazione
 * e per il ronzio d'errore — un oscillatore puro non basta a rendere questi
 * due suoni riconoscibili dal resto della palette.
 */
function noiseBurst(c, startAt, dur, { peakGain = 0.12, filterFreq = 1200, filterType = 'bandpass' } = {}) {
    const bufferSize = Math.ceil(c.sampleRate * dur);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buffer;

    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, c.currentTime + startAt);

    const gain = c.createGain();
    const t0 = c.currentTime + startAt;
    gain.gain.setValueAtTime(peakGain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
}

// --- RICETTE: una funzione per ciascun suono, tutte in termini di tone()/noiseBurst() ---

const RECIPES = {
    // Un vero pezzo che tocca la scacchiera è percussivo, non melodico: un
    // breve "thud" grave (il corpo del pezzo) più un click secco e brevissimo
    // (il contatto netto) — non una nota sinusoidale isolata, che suona più
    // da notifica di app che da scacchiera.
    move: (c) => {
        tone(c, 185, 0, 0.06, { type: 'sine', peakGain: 0.24, attack: 0.001, release: 0.05, glideTo: 150 });
        noiseBurst(c, 0, 0.018, { peakGain: 0.05, filterFreq: 4200, filterType: 'bandpass' });
    },
    // Stessa idea della mossa ma più "dura": corpo più grave, click più
    // presente — la differenza che si sente subito tra spostare e catturare.
    capture: (c) => {
        tone(c, 130, 0, 0.09, { type: 'triangle', peakGain: 0.22, attack: 0.001, release: 0.075, glideTo: 95 });
        noiseBurst(c, 0, 0.035, { peakGain: 0.09, filterFreq: 2400, filterType: 'bandpass' });
        noiseBurst(c, 0.012, 0.022, { peakGain: 0.05, filterFreq: 5200, filterType: 'bandpass' });
    },
    check: (c) => {
        tone(c, 720, 0, 0.08, { type: 'triangle', peakGain: 0.19, detune: 5 });
        tone(c, 720, 0, 0.08, { type: 'triangle', peakGain: 0.19, detune: -5 });
        tone(c, 980, 0.08, 0.15, { type: 'triangle', peakGain: 0.19 });
    },
    gameEnd: (c) => {
        [523.25, 415.3, 349.23].forEach((f, i) => {
            tone(c, f, i * 0.13, 0.32, { type: 'sine', peakGain: 0.18, release: 0.28 });
        });
    },
    brilliant: (c) => {
        // Piccolo arpeggio maggiore ascendente con "shimmer" finale: è il
        // suono più festoso della palette, riservato al NAG "!!" / $3.
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            tone(c, f, i * 0.07, 0.22, { type: 'triangle', peakGain: 0.16, release: 0.18 });
        });
        tone(c, 1567.98, 0.28, 0.35, { type: 'sine', peakGain: 0.09, release: 0.32 });
    },
    // Il "timbro" di un NAG appena assegnato: un click secco e leggero,
    // come una spunta su un modulo — non un tono musicale.
    nag: (c) => {
        tone(c, 900, 0, 0.03, { type: 'square', peakGain: 0.1, attack: 0.001, release: 0.02 });
        noiseBurst(c, 0, 0.012, { peakGain: 0.04, filterFreq: 5000, filterType: 'bandpass' });
    },
    delete: (c) => {
        tone(c, 420, 0, 0.16, { type: 'sawtooth', peakGain: 0.1, glideTo: 140, release: 0.14 });
        noiseBurst(c, 0, 0.12, { peakGain: 0.05, filterFreq: 800 });
    },
    error: (c) => {
        tone(c, 220, 0, 0.16, { type: 'square', peakGain: 0.12, glideTo: 160, release: 0.14 });
        tone(c, 160, 0.1, 0.18, { type: 'square', peakGain: 0.1, glideTo: 110, release: 0.16 });
    },
    notify: (c) => {
        tone(c, 880, 0, 0.1, { type: 'sine', peakGain: 0.14, release: 0.09 });
    },
    // Mossa "a libro" in DRILL: lo stesso "thud" della mossa normale, ma con
    // un piccolo chirp ascendente sopra a dire "corretto" — resta riconoscibile
    // come mossa scacchistica invece di un generico suono da app di studio.
    correct: (c) => {
        tone(c, 175, 0, 0.055, { type: 'sine', peakGain: 0.22, attack: 0.001, release: 0.045, glideTo: 145 });
        noiseBurst(c, 0, 0.016, { peakGain: 0.045, filterFreq: 4200, filterType: 'bandpass' });
        tone(c, 880, 0.05, 0.12, { type: 'sine', peakGain: 0.16, release: 0.1 });
    },
    // Milestone di streak (ogni 5): piccola fanfara + coriandoli sonori.
    milestone: (c) => {
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
            tone(c, f, i * 0.055, 0.25, { type: 'triangle', peakGain: 0.17, release: 0.22 });
        });
        for (let i = 0; i < 6; i++) {
            tone(c, 1400 + Math.random() * 800, 0.15 + i * 0.03, 0.12, {
                type: 'sine', peakGain: 0.05, release: 0.1,
            });
        }
    },
};

/**
 * @param {'move'|'capture'|'check'|'gameEnd'|'brilliant'|'nag'|'delete'|'error'|'notify'|'correct'|'milestone'} name
 */
export function playSound(name) {
    if (muted || !RECIPES[name]) return;
    try {
        const c = ensureRunning();
        if (!c) return;
        RECIPES[name](c);
    } catch (err) {
        // Sintesi audio non disponibile per qualche motivo: mai bloccare l'app.
    }
}

export function setMuted(value) {
    muted = !!value;
}

export function isMuted() {
    return muted;
}

/**
 * Sceglie il suono giusto per il NODO su cui ci si trova ADESSO (dopo che
 * l'albero è già stato sincronizzato) — a differenza delle due funzioni
 * sotto (che guardano solo captured/SAN), questa controlla anche i NAG:
 * una mossa marcata "brillante" ($3) suona sempre brilliant, qualunque sia
 * la fonte della mossa (drag&drop, tastiera, move-list, mossa del pc in
 * drill...). Va preferita a playMoveSound/playMoveSoundForSan ovunque sia
 * disponibile il nodo dell'albero.
 *
 * @param {MoveNode|null} node
 */
export function playMoveSoundForNode(node) {
    if (!node) return;
    if (node.nag && node.nag.includes('$3')) {
        playSound('brilliant');
        return;
    }
    playMoveSoundForSan(node.move);
}

/**
 * Sceglie il suono giusto per una mossa appena giocata (formato risultato di
 * chess.js: { captured, san, flags, ... }). Non conosce i NAG (il risultato
 * di chess.js non li porta con sé) — dove possibile preferire
 * playMoveSoundForNode.
 *
 * @param {Object} move
 */
export function playMoveSound(move) {
    if (!move) return;
    if (move.san && move.san.includes('#')) {
        playSound('gameEnd');
    } else if (move.san && move.san.includes('+')) {
        playSound('check');
    } else if (move.captured || (move.flags && move.flags.includes('e'))) {
        playSound('capture');
    } else {
        playSound('move');
    }
}

/**
 * Come playMoveSound, ma parte solo dalla stringa SAN (es. "Nxe4+"). La
 * notazione SAN standard include già `x` per le catture e `+`/`#` per
 * scacco/matto, quindi basta guardare i caratteri.
 *
 * @param {String} san
 */
export function playMoveSoundForSan(san) {
    if (!san) return;
    if (san.includes('#')) playSound('gameEnd');
    else if (san.includes('+')) playSound('check');
    else if (san.includes('x')) playSound('capture');
    else playSound('move');
}
