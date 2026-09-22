# Focus completion music

Replace `focus_done.mp3` to change the sound played when a focus or rest round
finishes naturally.

The macOS companion GUI provides a safer way to select a local MP3. It keeps the
selected file in the user's application-support directory and passes it to
`companion/start-focus.sh` at launch time; the checked-in bundle remains unchanged.

- Keep the exact filename `focus_done.mp3`.
- The bundled file is the selected Morning Joy alarm sound.
- Playback loops until the middle button starts the next phase or rotation
  exits the cycle.
- The top left/right buttons lower/raise volume and show a short volume overlay.
