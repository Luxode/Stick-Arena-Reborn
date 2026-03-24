# Stick Arena: Reborn

A modern, open-source **HTML5 reimplementation** of the Flash game [Stick Arena](https://www.xgenstudios.com/play/stickarena) by XGenStudios.

## Backstory

Stick Arena was a popular browser-based multiplayer shooter that ran for over a decade on XGenStudios' servers. When Adobe Flash was discontinued at the end of 2020, the game became effectively unplayable — the official servers eventually went offline, and today it can only be accessed through a Flash emulator paired with a private server.

This project preserves the game as a native HTML5 experience: no Flash, no plugins, no dead servers required. It serves as a starting point for future online games or for anyone who simply wants to relive Stick Arena.

## Features

- All original maps, weapons, and sprites
- **Offline bot mode** — play against AI bots directly in your browser (including via GitHub Pages, no server needed)
- **Multiplayer** — download and run the server file to host your own game for multiple players
- Bots despawn automatically when a real player joins; the server takes over seamlessly
- Modern hit detection, client-side damage resolution, and a clean socket.io architecture

## Playing

### Offline (GitHub Pages / static host)

Open `client/index.html` in a browser (or visit the GitHub Pages URL). The game detects that no server is available and starts a bot match automatically.

### Hosted multiplayer

```bash
npm install
node app.js
```

Clients connect to `http://your-server:1138` and are matched automatically. Bots fill the room until a second real player joins.

## Demo

![Multiplayer](./gameplay.gif)

## Notes

Initial 'Stick Arena Reborn' project by WuggyRS

Pets and some spinner animations are missing.
Also, there is no implementation of lobby / shop.

## Copyright

The game assets (sprites, maps, sounds) belong to **XGenStudios**. This project is for educational and preservational purposes only and may not be used for commercial purposes.

## License

No commercial use allowed.

This work is licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License][cc-by-nc-sa].

[cc-by-nc-sa]: http://creativecommons.org/licenses/by-nc-sa/4.0/