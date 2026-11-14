/**
 * Minimal, persistent controls shared by the PGN Reader and Courses pages.
 */
export function initMoveDotsToggle(board) {
    const button = document.getElementById('btn-toggle-move-dots');
    if (!button) return;

    const sync = () => {
        const visible = board.areMoveSuggestionsVisible();
        button.setAttribute('aria-pressed', String(visible));
        button.setAttribute('aria-label', visible ? 'Hide legal move dots' : 'Show legal move dots');
        button.title = visible ? 'Hide legal move dots' : 'Show legal move dots';
        button.classList.toggle('is-enabled', visible);
    };

    button.addEventListener('click', () => {
        board.setMoveSuggestionsVisible(!board.areMoveSuggestionsVisible());
        sync();
    });

    sync();
}
