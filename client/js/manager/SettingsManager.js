// ──────────────────────────────────────────────────────────────────────────────
//  SettingsManager – persists user prefs and renders the in-game settings panel.
//  Press Escape to open / close. Settings are saved to localStorage.
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  name:              'Player',
  cursorIndex:       0,
  spinnerShapeIndex: 0,
  spinnerHue:        0,
  keybinds: {
    up:     'w',
    left:   'a',
    down:   's',
    right:  'd',
    shoot:  ' ',
    sprint: 'Shift',
  },
};

class SettingsManager {
  static getInstance() {
    if (!SettingsManager.instance) SettingsManager.instance = new SettingsManager();
    return SettingsManager.instance;
  }

  constructor() {
    const saved = this._loadRaw();
    // Randomise identity on very first load (no saved prefs).
    if (saved.spinnerHue        == null) DEFAULT_SETTINGS.spinnerHue        = Math.floor(Math.random() * 360);
    if (saved.spinnerShapeIndex == null) DEFAULT_SETTINGS.spinnerShapeIndex = Math.floor(Math.random() * 64);
    if (saved.cursorIndex       == null) DEFAULT_SETTINGS.cursorIndex       = Math.floor(Math.random() * 8);
    if (!saved.name)                     DEFAULT_SETTINGS.name              = 'Player' + Math.random().toString(36).slice(2, 5).toUpperCase();

    this.settings  = this._merge(saved);
    this._isOpen   = false;
    this._rebinding = null;
    this._buildUI();
    // Use capture phase so we intercept Escape / rebind before Keyboard.js sees it.
    document.addEventListener('keydown', e => this._onGlobalKey(e), true);
  }

  // ── Public getters ────────────────────────────────────────────────────────
  get name()              { return this.settings.name; }
  get cursorIndex()       { return this.settings.cursorIndex; }
  get spinnerShapeIndex() { return this.settings.spinnerShapeIndex; }
  get spinnerHue()        { return this.settings.spinnerHue; }
  isOpen()                { return this._isOpen; }
  getKey(action)          { return this.settings.keybinds[action] ?? ''; }

  // ── Persistence ────────────────────────────────────────────────────────────
  _loadRaw() {
    try { return JSON.parse(localStorage.getItem('sar_settings') || '{}'); }
    catch (e) { return {}; }
  }
  _merge(saved) {
    const s = { ...DEFAULT_SETTINGS, ...saved };
    s.keybinds = { ...DEFAULT_SETTINGS.keybinds, ...(saved.keybinds || {}) };
    return s;
  }
  _save() {
    try { localStorage.setItem('sar_settings', JSON.stringify(this.settings)); } catch (e) {}
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  toggle() { this._isOpen ? this.close() : this.open(); }

  open() {
    this._isOpen  = true;
    this._rebinding = null;
    this._overlay.style.display = 'flex';
    canvas.style.cursor = 'default';
    this._refresh();
  }

  close() {
    this._isOpen  = false;
    this._rebinding = null;
    this._overlay.style.display = 'none';
    canvas.style.cursor = 'none';
    this._applyToPlayer();
  }

  _applyToPlayer() {
    if (typeof playerManager === 'undefined' || !playerManager.mainPlayer) return;
    const p = playerManager.mainPlayer;
    p.name                = this.settings.name;
    p.indicatorHue        = this.settings.spinnerHue;
    p.indicatorShapeIndex = this.settings.spinnerShapeIndex;
    if (typeof socketManager !== 'undefined') {
      socketManager.emit('setName',        { name:       this.settings.name });
      socketManager.emit('playerIdentity', { hue:        this.settings.spinnerHue,
                                             shapeIndex: this.settings.spinnerShapeIndex });
    }
  }

  // Sync only spinner identity (hue + shape) without touching the name.
  _syncIdentity() {
    if (typeof playerManager === 'undefined' || !playerManager.mainPlayer) return;
    playerManager.mainPlayer.indicatorHue        = this.settings.spinnerHue;
    playerManager.mainPlayer.indicatorShapeIndex = this.settings.spinnerShapeIndex;
    if (typeof socketManager !== 'undefined') {
      socketManager.emit('playerIdentity', { hue:        this.settings.spinnerHue,
                                             shapeIndex: this.settings.spinnerShapeIndex });
    }
  }

  // ── Global key listener (capture phase so we can intercept rebind) ─────────
  _onGlobalKey(e) {
    // If waiting for a rebind key, consume this event entirely.
    if (this._rebinding) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.settings.keybinds[this._rebinding] = e.key;
      this._rebinding = null;
      this._save();
      this._buildKeybinds();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this._isOpen) this.close();
      else if (typeof chatManager === 'undefined' || !chatManager.isOpen) this.open();
    }
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────
  _buildUI() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      display: 'none', position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.78)', zIndex: '1000',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'monospace',
      cursor: 'default',
    });
    // Don't let clicks fall through to the canvas.
    overlay.addEventListener('mousedown', e => e.stopPropagation());
    overlay.addEventListener('click',     e => { if (e.target === overlay) this.close(); });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: '#1a2332', border: '2px solid #2d4060',
      borderRadius: '8px', padding: '20px 24px',
      width: '500px', maxHeight: '84vh', overflowY: 'auto',
      color: '#bbb', fontSize: '13px', boxSizing: 'border-box',
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <span style="font-size:15px;font-weight:bold;color:#fff">⚙ Settings
          <span style="font-size:10px;color:#445;font-weight:normal;margin-left:8px;">[Esc]</span></span>
        <button id="sar-close" style="background:none;border:none;color:#667;font-size:18px;cursor:pointer;line-height:1">✕</button>
      </div>

      <div class="sar-sec">
        <div class="sar-lbl">Player Name</div>
        <input id="sar-name" type="text" maxlength="20"
          style="width:100%;background:#0c1420;border:1px solid #2d4060;color:#fff;
                 padding:6px 8px;border-radius:4px;font-family:monospace;font-size:13px;
                 box-sizing:border-box;outline:none">
      </div>

      <div class="sar-sec">
        <div class="sar-lbl">Cursor</div>
        <div id="sar-cursor-grid" style="display:flex;gap:6px;flex-wrap:wrap"></div>
      </div>

      <div class="sar-sec">
        <div class="sar-lbl">Spinner Shape</div>
        <div id="sar-spin-grid"
          style="display:flex;gap:5px;flex-wrap:wrap;max-height:170px;overflow-y:auto;
                 background:#0c1420;border:1px solid #2d4060;border-radius:4px;padding:8px"></div>
      </div>

      <div class="sar-sec">
        <div class="sar-lbl">Spinner Color — <span id="sar-hue-lbl"></span></div>
        <input id="sar-hue" type="range" min="0" max="360"
          style="width:100%;accent-color:#4a9eff;margin-bottom:6px">
        <div style="height:12px;border-radius:3px;
          background:linear-gradient(to right,
            hsl(36,80%,50%),hsl(96,80%,50%),hsl(156,80%,50%),
            hsl(216,80%,50%),hsl(276,80%,50%),hsl(336,80%,50%),hsl(396,80%,50%))"></div>
      </div>

      <div class="sar-sec">
        <div class="sar-lbl">Keybinds</div>
        <div id="sar-keybinds"></div>
      </div>
    `;

    const sty = document.createElement('style');
    sty.textContent = `
      .sar-sec { margin-bottom:18px }
      .sar-lbl { color:#4a7a9a;font-size:10px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:7px }
      .sar-tile { width:46px;height:46px;border:2px solid #253545;border-radius:5px;cursor:pointer;
                  display:flex;align-items:center;justify-content:center;background:#0c1420;flex-shrink:0 }
      .sar-tile:hover { border-color:#4a9effaa }
      .sar-tile.sel   { border-color:#4a9eff;background:#0a2040 }
      .sar-tile canvas { cursor:pointer }
      .sar-bind { display:flex;justify-content:space-between;align-items:center;
                  padding:6px 2px;border-bottom:1px solid #1a2535 }
      .sar-bind:last-child { border-bottom:none }
      .sar-key  { background:#182535;border:1px solid #2d4060;color:#ccc;padding:3px 10px;
                  border-radius:3px;cursor:pointer;font-family:monospace;font-size:12px;
                  min-width:68px;text-align:center }
      .sar-key:hover     { background:#253545 }
      .sar-key.listening { border-color:#f84;color:#f84;background:#1c0e00 }
    `;
    document.head.appendChild(sty);

    panel.querySelector('#sar-close').onclick = () => this.close();

    panel.querySelector('#sar-name').addEventListener('input', e => {
      this.settings.name = e.target.value;
      this._save();
    });

    panel.querySelector('#sar-name').addEventListener('change', e => {
      // Sync name to server when the field loses focus or Enter is pressed.
      this.settings.name = e.target.value;
      this._save();
      if (typeof playerManager !== 'undefined' && playerManager.mainPlayer) playerManager.mainPlayer.name = this.settings.name;
      if (typeof socketManager !== 'undefined') socketManager.emit('setName', { name: this.settings.name });
    });

    panel.querySelector('#sar-hue').addEventListener('input', e => {
      this.settings.spinnerHue = +e.target.value;
      this._save();
      this._refreshHueLbl();
      this._buildSpinnerPicker(); // live-preview the color change
      this._syncIdentity();
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._panel   = panel;

    // ── Gear button ────────────────────────────────────────────────────────
    const gear = document.createElement('button');
    gear.textContent = '⚙';
    Object.assign(gear.style, {
      position: 'fixed', zIndex: '999',
      width: '34px', height: '34px',
      background: 'rgba(10,20,32,0.72)', border: '1.5px solid #2d4060',
      borderRadius: '6px', color: '#5a8ab0', fontSize: '18px',
      cursor: 'pointer', lineHeight: '1',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.15s, color 0.15s',
    });
    gear.title = 'Settings [Esc]';
    gear.addEventListener('mouseenter', () => {
      gear.style.background = 'rgba(20,40,60,0.92)';
      gear.style.color = '#8ac0e8';
    });
    gear.addEventListener('mouseleave', () => {
      gear.style.background = 'rgba(10,20,32,0.72)';
      gear.style.color = '#5a8ab0';
    });
    gear.addEventListener('mousedown', e => e.stopPropagation());
    gear.addEventListener('click', () => this.toggle());
    document.body.appendChild(gear);
    this._gearBtn = gear;

    const positionGear = () => {
      const r = canvas.getBoundingClientRect();
      gear.style.left   = (r.left + 6) + 'px';
      gear.style.bottom = (window.innerHeight - r.bottom + 6) + 'px';
    };
    positionGear();
    window.addEventListener('resize', positionGear);
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  _refresh() {
    this._panel.querySelector('#sar-name').value = this.settings.name;
    this._panel.querySelector('#sar-hue').value  = this.settings.spinnerHue;
    this._refreshHueLbl();
    this._buildCursorPicker();
    this._buildSpinnerPicker();
    this._buildKeybinds();
  }

  _refreshHueLbl() {
    const el = this._panel.querySelector('#sar-hue-lbl');
    if (el) el.textContent = this.settings.spinnerHue + '°';
  }

  // ── Cursor picker ─────────────────────────────────────────────────────────
  _buildCursorPicker() {
    const grid = this._panel.querySelector('#sar-cursor-grid');
    grid.innerHTML = '';
    const names = Object.keys(cursorAtlas.animationMap);
    names.forEach((anim, i) => {
      const fd = cursorAtlas.getFrameData(anim, 0);
      if (!fd) return;
      const scale = Math.min(2.8, 34 / Math.max(fd.w, fd.h));
      const c = document.createElement('canvas');
      c.width = 46; c.height = 46;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(cursorAtlas.image,
        fd.x, fd.y, fd.w, fd.h,
        (46 - fd.w * scale) / 2, (46 - fd.h * scale) / 2,
        fd.w * scale, fd.h * scale);
      const tile = document.createElement('div');
      tile.className = 'sar-tile' + (i === this.settings.cursorIndex % names.length ? ' sel' : '');
      tile.title = `Cursor ${i + 1}`;
      tile.appendChild(c);
      tile.onclick = () => {
        this.settings.cursorIndex = i;
        this._save();
        grid.querySelectorAll('.sar-tile').forEach((t, j) => t.classList.toggle('sel', j === i));
      };
      grid.appendChild(tile);
    });
  }

  // ── Spinner picker ────────────────────────────────────────────────────────
  _buildSpinnerPicker() {
    const grid = this._panel.querySelector('#sar-spin-grid');
    grid.innerHTML = '';
    const names = Object.keys(indicatorAtlas.animationMap);
    const selIdx = this.settings.spinnerShapeIndex % names.length;
    names.forEach((anim, i) => {
      const fd = indicatorAtlas.getFrameData(anim, 0);
      if (!fd) return;
      const scale = Math.min(1.6, 32 / Math.max(fd.w, fd.h));
      const c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.filter = `sepia(1) saturate(5) hue-rotate(${this.settings.spinnerHue}deg)`;
      cx.drawImage(indicatorAtlas.image,
        fd.x, fd.y, fd.w, fd.h,
        (40 - fd.w * scale) / 2, (40 - fd.h * scale) / 2,
        fd.w * scale, fd.h * scale);
      const tile = document.createElement('div');
      tile.style.cssText = 'width:40px;height:40px;flex-shrink:0';
      tile.className = 'sar-tile' + (i === selIdx ? ' sel' : '');
      tile.appendChild(c);
      tile.onclick = () => {
        this.settings.spinnerShapeIndex = i;
        this._save();
        this._syncIdentity();
        grid.querySelectorAll('.sar-tile').forEach((t, j) => t.classList.toggle('sel', j === i));
      };
      grid.appendChild(tile);
    });
  }

  // ── Keybind table ─────────────────────────────────────────────────────────
  _buildKeybinds() {
    const container = this._panel.querySelector('#sar-keybinds');
    container.innerHTML = '';
    const labels = {
      up:     'Move Up',
      left:   'Move Left',
      down:   'Move Down',
      right:  'Move Right',
      shoot:  'Shoot',
    };
    for (const [action, label] of Object.entries(labels)) {
      const current = this.settings.keybinds[action] ?? '';
      const display = current === ' ' ? 'Space' : (current || '—');
      const row = document.createElement('div');
      row.className = 'sar-bind';
      const btn = document.createElement('button');
      btn.className = 'sar-key';
      btn.dataset.action = action;
      btn.textContent = display;
      btn.onclick = () => {
        if (this._rebinding === action) {
          this._rebinding = null;
          btn.classList.remove('listening');
          btn.textContent = display;
          return;
        }
        // Clear any other listening state.
        container.querySelectorAll('.sar-key').forEach(b => {
          b.classList.remove('listening');
          const a = b.dataset.action;
          const k = this.settings.keybinds[a] ?? '';
          b.textContent = k === ' ' ? 'Space' : (k || '—');
        });
        this._rebinding = action;
        btn.classList.add('listening');
        btn.textContent = '…';
      };
      const lbl = document.createElement('span');
      lbl.textContent = label;
      row.appendChild(lbl);
      row.appendChild(btn);
      container.appendChild(row);
    }
  }
}

const settingsManager = SettingsManager.getInstance();
