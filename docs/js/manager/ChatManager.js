class ChatManager {
  static getInstance() {
    if (!ChatManager.instance) {
      ChatManager.instance = new ChatManager();
    }
    return ChatManager.instance;
  }

  constructor() {
    this.messages  = [];   // [{ name, text, timestamp }]
    this.maxMessages = 10;
    this.isOpen    = false;
    this.input     = '';   // text the player is currently typing
  }

  open() {
    this.isOpen = true;
    this.input  = '';
  }

  // Returns the message text (may be empty), then closes.
  close() {
    const text = this.input.trim();
    this.isOpen = false;
    this.input  = '';
    return text;
  }

  handleKey(event) {
    if (!this.isOpen) return;
    event.stopPropagation();

    if (event.key === 'Backspace') {
      this.input = this.input.slice(0, -1);
    } else if (event.key.length === 1) {
      // Limit message length to 80 chars.
      if (this.input.length < 80) this.input += event.key;
    }
  }

  addMessage(name, text, hue = null) {
    this.messages.push({ name, text, hue, timestamp: Date.now() });
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }

  draw(ctx, canvas) {
    if (!this.messages.length && !this.isOpen) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const x      = 12;
    const lineH  = 18;
    const msgFontSize = 13;
    const inputH = this.isOpen ? 24 : 0;
    const bottomPad = 12;
    // Chat input box starts further right to avoid overlapping the gear button in the lower-left corner.
    const inputX = 50;
    const baseY  = canvas.height - bottomPad - inputH - (this.messages.length * lineH);

    // Draw message history — fade out older messages when chat is closed.
    this.messages.forEach((msg, i) => {
      const y       = baseY + i * lineH;
      const age     = (Date.now() - msg.timestamp) / 1000; // seconds
      const alpha   = this.isOpen ? 1 : Math.max(0, 1 - (age - 5) / 5); // visible 5s, fade over 5s

      if (alpha <= 0) return;

      const myId = (typeof socketManager !== 'undefined') ? socketManager.socket?.id : null;
      const isMe = (typeof playerManager !== 'undefined') && playerManager.mainPlayer?.name === msg.name;
      const displayName = isMe ? 'You' : msg.name;

      // Derive spinner-matching color from hue (sepia+saturate+hue-rotate produces ~hsl(H+36, 80%, 50%))
      const nameHue = msg.hue != null ? (msg.hue + 36) % 360 : null;
      const nameColor = nameHue != null ? `hsla(${nameHue},80%,65%,${alpha})` : `rgba(255,255,255,${alpha})`;

      ctx.font = `${msgFontSize}px monospace`;

      // Shadow for readability
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
      ctx.fillText(`${displayName}: ${msg.text}`, x + 1, y + 1);

      // Colored name
      ctx.fillStyle = nameColor;
      const nameWidth = ctx.measureText(`${displayName}: `).width;
      ctx.fillText(`${displayName}: `, x, y);

      // White message text
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillText(msg.text, x + nameWidth, y);
    });

    // Draw input box when open.
    if (this.isOpen) {
      const inputY = canvas.height - bottomPad - inputH;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(inputX - 4, inputY, 340, inputH);

      ctx.strokeStyle = '#4a6fa5';
      ctx.lineWidth   = 1;
      ctx.strokeRect(inputX - 4, inputY, 340, inputH);

      // Blinking cursor
      const cursor = (Math.floor(Date.now() / 500) % 2 === 0) ? '_' : '';
      ctx.font      = `${msgFontSize}px monospace`;
      ctx.fillStyle = 'white';
      ctx.fillText(this.input + cursor, inputX + 2, inputY + 16);
    }

    ctx.restore();
  }
}

const chatManager = ChatManager.getInstance();
