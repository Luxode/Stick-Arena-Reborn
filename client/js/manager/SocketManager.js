class SocketManager {
  static getInstance() {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  constructor() {
    this.socket      = null;
    this.isConnected = false;

    // socket.io is served by the Node server at /socket.io/socket.io.js.
    // On GitHub Pages or when the server is down that script 404s, leaving
    // `io` undefined.  We degrade gracefully to pure offline mode.
    if (typeof io !== 'undefined') {
      try {
        this.socket = io({ reconnectionAttempts: Infinity, reconnectionDelay: 2000 });
        this.socket.on('connect',    () => { this.isConnected = true;  });
        this.socket.on('disconnect', () => { this.isConnected = false; });
      } catch (e) {
        console.warn('[SocketManager] Could not initialise socket.io:', e);
      }
    }
  }

  on(event, callback) {
    if (this.socket) this.socket.on(event, callback);
  }

  emit(event, data) {
    if (this.socket && this.isConnected) this.socket.emit(event, data);
  }
}

const socketManager = SocketManager.getInstance();
