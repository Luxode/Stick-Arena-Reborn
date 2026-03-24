// Minimal static file server — mirrors what GitHub Pages does.
// No socket.io, no game logic.  The client degrades to offline bot mode automatically.
//
// Usage:  node offline_app.js
//         node offline_app.js 8080   (custom port)

const express = require("express");
const path    = require("path");

const app  = express();
const port = parseInt(process.argv[2], 10) || process.env.PORT || 1138;

app.use(express.static(path.join(__dirname, "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client/index.html"));
});

app.listen(port, () => {
  console.log(`Offline static server running at http://localhost:${port}`);
  console.log("No socket.io — client will start in offline bot mode.");
});
