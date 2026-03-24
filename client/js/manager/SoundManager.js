class SoundManager {
  static getInstance() {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  constructor() {
    this.sounds = {};  // lazy cache: name -> Audio
    this.volume = 0.5;
  }

  _get(name) {
    if (!this.sounds[name]) {
      const audio = new Audio(`sounds/${name}.mp3`);
      audio.volume = this.volume;
      this.sounds[name] = audio;
    }
    return this.sounds[name];
  }

  play(name) {
    const snd = this._get(name);
    // Clone so the same sound can overlap itself
    const clone = snd.cloneNode();
    clone.volume = this.volume;
    clone.play().catch(() => {});
  }

  playRandom(names) {
    this.play(names[Math.floor(Math.random() * names.length)]);
  }
}

const soundManager = SoundManager.getInstance();
