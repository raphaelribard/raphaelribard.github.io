# Cards – local flashcards (Anki-like)
Single file: `index.html`. No server, no account, no network. Data is stored in the browser's local storage on the device.

Features: decks, cards, spaced repetition (SM-2 style: Again/Hard/Good/Easy), search, CSV/TSV import, CSV export, full JSON backup/restore, dark mode.

Run it on iPhone without publishing it: open it from a local file app (e.g. Documents by Readdle), or serve it on your home Wi-Fi only:
`cd localcards && python3 -m http.server 8080`, open `http://<computer-ip>:8080` in Safari, then Share → Add to Home Screen.
