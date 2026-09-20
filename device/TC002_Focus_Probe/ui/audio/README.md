# Focus completion music

Replace `focus_done.wav` to change the sound played when a 45-minute focus
round finishes naturally.

- Keep the exact filename `focus_done.wav`.
- Use a standard PCM WAV file (48 kHz, 16-bit is the safest choice on TC002).
- The current TC002 EasyUI media player rejects the stock MP3 prompt files, so
  this build intentionally uses WAV for reliable playback.
- Playback starts once; it is stopped when the next focus round starts, when
  the cycle is exited, or when the left hardware button is pressed.
- The right hardware button previews the current file without changing Lark.
