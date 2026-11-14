# PGN Reader & Courses

Un progetto nato per rendere lo studio degli scacchi più piacevole, accessibile e organizzato: uno spazio in cui **studiare le aperture, esplorare le varianti e creare corsi da condividere con altri giocatori**, con un'interfaccia curata oltre che funzionale.

- **[Apri il Reader](https://paolomalgarin.github.io/PGN-Reader/)**
- **[Apri la sezione Courses](https://paolomalgarin.github.io/PGN-Reader/courses)**

---

## ⚠️ DISCLAIMER IMPORTANTE — IL PROGETTO È STATO REALIZZATO QUASI TUTTO CON L'AI

> **Questo progetto è stato realizzato quasi interamente con l'aiuto di strumenti di intelligenza artificiale.** Gran parte del codice, delle modifiche tecniche e delle soluzioni implementate è stata prodotta con l'AI, seguendo gli obiettivi e le indicazioni del progetto.
>
> **Lo scopo NON è mostrare le mie capacità di programmazione, né presentare questo lavoro come una dimostrazione delle mie abilità tecniche.** Non è questo il punto del progetto.
>
> L'obiettivo è molto più semplice: creare uno strumento che le persone possano usare per **studiare le aperture, analizzare e comprendere le varianti, costruire corsi di scacchi e condividerli con altri**, cercando allo stesso tempo di offrire un'esperienza visiva piacevole, ordinata e curata.
>
> In altre parole, il valore che voglio dare a questo progetto è nella sua **utilità, nell'esperienza di studio e nella cura estetica**. L'AI è stata uno strumento fondamentale per trasformare questa idea in qualcosa di concreto. Non voglio nasconderlo né far passare il progetto per qualcosa che non è.

---

## A cosa serve

Il progetto è organizzato in due aree che condividono la stessa scacchiera e lo stesso linguaggio visivo.

### 1. Reader — studiare ed esplorare le partite

Il Reader è pensato per aprire un file PGN, seguire una partita o una linea di apertura e studiarne le possibilità.

Tra le funzioni presenti:

- importare una partita da file `.pgn` e navigare tra le mosse;
- esplorare varianti e rami alternativi della partita;
- aggiungere o modificare commenti e annotazioni NAG;
- visualizzare frecce, evidenziazioni e informazioni sulle mosse;
- riconoscere le mosse brillanti ($3) con un effetto dedicato: scacchiera oscurata, percorso a caselle illuminate, movimento animato del pezzo, breve tremolio e badge `!! BRILLIANT`; il NAG resta poi visibile come annotazione;
- usare le modalità **EDIT**, **READ** e **DRILL** (in Drill i NAG sono nascosti per non anticipare indizi);
- avviare l'analisi con Stockfish;
- esportare la partita in formato PGN, anche in una versione ripulita dalle annotazioni grafiche.

### Controlli della scacchiera

I comandi essenziali sono disponibili nella barra superiore, senza dover aprire una scheda specifica:

- **Flip board:** ribalta l'orientamento della scacchiera; resta accessibile in tutti i tab e anche durante il Drill. Nei corsi l'orientamento iniziale continua a rispettare il lato scelto nelle impostazioni del corso, ma può essere cambiato manualmente.
- **Puntini delle mosse legali:** il pulsante con la griglia di puntini mostra o nasconde gli indicatori delle destinazioni possibili quando si seleziona un pezzo. La preferenza viene ricordata e condivisa tra Reader e Courses.
- **Frecce delle continuazioni PGN:** il comando separato `move arrows` nel pannello Analysis mostra o nasconde le frecce che indicano le continuazioni già presenti nel PGN. Non modifica i puntini delle mosse legali.

### 2. Courses — creare corsi per altri giocatori

La sezione Courses permette di costruire materiale didattico organizzato, con sezioni, linee e spiegazioni associate alle mosse.

È possibile:

- creare un corso e organizzarne l'indice in sezioni e linee;
- aggiungere commenti, annotazioni e varianti;
- inserire anteprime di linee alternative all'interno delle spiegazioni;
- registrare sequenze di mosse da usare come anteprime;
- visualizzare il corso in modalità Preview/Study;
- salvare una versione modificabile `.pgnce`;
- esportare una versione `.pgnc` destinata agli studenti.

L'idea è permettere a chi studia un'apertura di trasformare il proprio lavoro in un percorso didattico chiaro e condivisibile.

---

## Avvio in locale

Il progetto è una web app statica. Non richiede un processo di build dedicato, ma va aperto tramite un server HTTP/HTTPS: non è consigliato aprire direttamente `index.html` con `file://` perché i moduli JavaScript e alcune risorse del browser potrebbero non funzionare correttamente.

Dalla cartella principale del progetto, avvia per esempio:

```bash
python -m http.server 8000
```

Poi apri nel browser:

- Reader: <http://localhost:8000/>
- Courses: <http://localhost:8000/courses/>

**Connessione Internet:** cm-chessboard, il relativo CSS e gli asset della scacchiera, oltre a `chess.js`, vengono caricati da CDN. Per questo l'app ha bisogno di una connessione Internet. I file JavaScript e WASM di Stockfish sono invece inclusi nella cartella `engine/`.

---

## Struttura del progetto

| Percorso | Contenuto |
|---|---|
| `index.html` | Interfaccia principale del Reader |
| `index.css` | Stile generale, tema e palette della scacchiera |
| `Chessboard.js` | Integrazione e personalizzazioni di cm-chessboard, annotazioni e animazioni |
| `reader/` | Navigazione PGN, albero delle mosse, modalità di lettura, modifica e drill |
| `courses/` | Interfaccia e logica per creare, modificare e studiare i corsi |
| `engine/` | File JavaScript e WASM di Stockfish |
| `assets/audio/` | Suoni dell'interfaccia e delle mosse |
| `LICENSE` | Licenza presente nella radice del progetto |

---

## Personalizzare la scacchiera

La palette principale si trova all'inizio di `index.css`, nel blocco `PALETTE DELLA SCACCHIERA cm-chessboard`. Il tema scuro usa lo stile **Dark Plum**; il tema chiaro usa uno stile **High-Contrast Light**, con superfici bianche e testo più scuro per migliorare la leggibilità.

| Variabile CSS | Valore attuale | Uso |
|---|---|---|
| `--chess-square-light` | `#938593` | Caselle chiare |
| `--chess-square-dark` | `#11001c` | Caselle scure |
| `--chess-last-move-light` | `#4f91b5` | Ultima mossa sulle caselle chiare |
| `--chess-last-move-dark` | `#087b86` | Ultima mossa sulle caselle scure |
| `--chess-annotation` | `#00e676` | Colore delle evidenziazioni manuali |
| `--chess-manual-arrow` | `#00c875` | Frecce disegnate manualmente |
| `--chess-arrow-outline` | `#1b3a4b` | Contorno uniforme delle frecce |
| `--chess-highlight-light` | `#00e676` | Evidenziazioni sulle caselle chiare |
| `--chess-highlight-dark` | `#00b866` | Evidenziazioni sulle caselle scure |
| `--chess-pgn-arrow` | `#d3c9d3` | Frecce che suggeriscono le mosse disponibili del PGN (opacità 90%) |

Le frecce che indicano le mosse disponibili nel PGN sono lilla al 90%; quelle disegnate manualmente sono verdi e mantengono il colore anche dopo il salvataggio e il ripristino delle annotazioni. Entrambe sono tracciate come un'unica sagoma poligonale in linea retta, con un bordo esterno uniforme anche sulla punta. I pulsanti della palette NAG sono rettangolari e coordinati con i badge sulla scacchiera. In modalità DRILL i NAG vengono nascosti a livello del renderer, così non anticipano informazioni allo studente. Entrambe hanno un contorno scuro uniforme. Le evidenziazioni manuali usano invece il verde, mentre l'ultima mossa conserva una palette blu separata.

Per modificare la durata dell'animazione dei pezzi, cerca `animationDuration` dentro `_initDOM()` in `Chessboard.js`. Il valore è espresso in millisecondi.

---

## Tecnologie e risorse

- **cm-chessboard 8.15.4** per la visualizzazione e l'interazione con la scacchiera;
- **chess.js** per la gestione delle posizioni e delle mosse;
- **Stockfish 18 Lite** per l'analisi scacchistica;
- JavaScript, HTML e CSS, senza un framework UI obbligatorio.

La scacchiera usa il set di pezzi **Staunty**. Prima di riutilizzare o distribuire il progetto, verifica le licenze delle singole dipendenze e degli asset: le licenze dei componenti esterni possono essere diverse da quella del codice del progetto. In particolare, il set Staunty è indicato con licenza **CC BY-NC-SA 4.0**; verifica le condizioni applicabili al tuo utilizzo.

- [cm-chessboard — repository e informazioni sulle licenze](https://github.com/shaack/cm-chessboard)
- [Stockfish — sito ufficiale](https://stockfishchess.org/)

---

## Feedback

Il progetto vuole essere uno strumento concreto per chi studia scacchi e per chi prepara materiale didattico. Segnalazioni, idee e suggerimenti sono benvenuti, soprattutto quelli che possono migliorare la chiarezza delle spiegazioni, l'esperienza di studio e la qualità visiva dell'app.

## Animazione Brilliant

L'animazione attiva combina la pulizia del concept **Glow Path** con il corridoio di caselle luminose del concept **Luminous Lane**. La sequenza oscura la scacchiera, illumina le caselle tra partenza e arrivo, riproduce il movimento del pezzo con cm-chessboard e dà un breve feedback di tremolio. Dopo il movimento appare il badge compatto `!! BRILLIANT`; il testo celebrativo scompare insieme all'oscuramento, mentre il normale NAG `!!` resta sulla mossa.

La GIF `Brilliant-05-Hybrid-Path-Badge.gif` in `assets/animations/brilliant-concepts/` mostra il riferimento visivo della combinazione. Le quattro GIF precedenti sono conservate come concept alternativi.


### Ultimi ritocchi all'animazione Brilliant

- La scacchiera si oscura con un easing morbido; subito dopo, il percorso si costruisce casella per casella con un easing in/out.
- Ogni casella attraversata viene aperta nella maschera a dimensione piena e resta completamente priva dell'overlay grigio per tutta la sequenza. Una finestra mobile, larga esattamente una casella, segue anche il pezzo durante il tragitto.
- Il pezzo parte una sola volta e soltanto quando il percorso è interamente formato. Non viene mosso durante la costruzione del percorso e non viene riprodotta una seconda animazione di sincronizzazione.
- All'arrivo, e non durante il movimento, tremano leggermente tutti i pezzi e compare il badge `!! BRILLIANT`.
- Alla fine scompaiono insieme percorso, badge e oscuramento; il normale NAG `!!` viene ridisegnato per ultimo e rimane come unica annotazione celebrativa.
