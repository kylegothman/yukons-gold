// All sound is synthesized with Web Audio; there are no audio files.

const MUTE_KEY = 'yukons-gold-muted';
const MASTER_LEVEL = 0.7;

export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  noise!: AudioBuffer;
  muted = false;
  /** 0..1, set by Goth OS when the game is embedded there; 1 when standalone. */
  siteVolume = 1;
  private last = new Map<string, number>();
  private creek?: GainNode; private engine?: GainNode; private engineOsc?: OscillatorNode;
  private nextChirp = 0;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* default on */ }
    // Goth OS (kylegothman.github.io/goth-os) embeds the game and forwards its volume slider.
    window.addEventListener('message', (e: MessageEvent) => {
      if (!/^https:\/\/kylegothman\.github\.io$|^http:\/\/localhost(:\d+)?$/.test(e.origin)) return;
      if (!e.data || e.data.type !== 'goth-os:volume') return;
      this.setSiteVolume(Number(e.data.volume));
    });
  }

  /** Must be called from a click: browsers only start audio on a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.level(); this.master.connect(ctx.destination);
      const n = this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // creek: looping filtered noise, faded by how close the camera is to water
      const src = ctx.createBufferSource(); src.buffer = n; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.35; lg.gain.value = 320; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      this.creek = ctx.createGain(); this.creek.gain.value = 0; src.connect(bp); bp.connect(this.creek); this.creek.connect(this.master); src.start();
      // engine: low rumble while machines run nearby
      const o = this.engineOsc = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const trem = ctx.createOscillator(), tg = ctx.createGain(); trem.frequency.value = 13; tg.gain.value = 6; trem.connect(tg); tg.connect(o.frequency); trem.start();
      this.engine = ctx.createGain(); this.engine.gain.value = 0; o.connect(lp); lp.connect(this.engine); this.engine.connect(this.master); o.start();
    } catch { this.ctx = null; }
  }
  setMuted(m: boolean) {
    this.muted = m; try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* fine */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  private level() { return this.muted ? 0 : MASTER_LEVEL * this.siteVolume; }

  setSiteVolume(v: number) {
    this.siteVolume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    if (this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  private ok(name: string, gapMs: number) { const now = performance.now(); if (now - (this.last.get(name) ?? 0) < gapMs) return false; this.last.set(name, now); return true; }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, slideTo?: number) {
    const c = this.ctx!, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  private hiss(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass', when = 0, slideTo?: number) {
    const c = this.ctx!, t = c.currentTime + when, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t); if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  /** `near` is 0..1: how close the sound is to what the camera is looking at. */
  play(name: string, near = 1, amount = 0) {
    if (!this.ctx || this.muted || near <= 0.02) return;
    const v = near;
    switch (name) {
      case 'dig': if (this.ok(name, 70)) { this.hiss(240, 0.8, 0.16, 0.5 * v, 'lowpass'); this.hiss(2600, 1.5, 0.07, 0.12 * v, 'bandpass', 0.02); } break;
      case 'sieve': if (this.ok(name, 120)) for (let i = 0; i < 4; i++) this.hiss(3200, 2, 0.06, 0.16 * v, 'bandpass', i * 0.07); break;
      case 'scoop': if (this.ok(name, 150)) { this.hiss(140, 0.7, 0.35, 0.7 * v, 'lowpass'); this.tone(90, 0.25, 0.25 * v, 'square', 0.05, 55); } break;
      case 'dump': if (this.ok(name, 150)) this.hiss(900, 0.5, 0.45, 0.35 * v, 'lowpass', 0, 200); break;
      case 'refuel': if (this.ok(name, 300)) this.hiss(500, 3, 0.6, 0.18 * v, 'bandpass', 0, 1400); break;
      case 'gold': if (this.ok(name, 90)) {
        const big = Math.min(1, amount / 80), f = 1320 + big * 440;
        this.hiss(1800, 1, 0.22, 0.12 * v, 'bandpass', 0, 900);                           // water swish
        this.tone(f, 0.35, 0.16 * v, 'sine', 0.05); this.tone(f * 1.5, 0.45, 0.12 * v, 'sine', 0.12);
        if (big > 0.6) this.tone(f * 2, 0.6, 0.1 * v, 'sine', 0.2);
      } break;
      case 'sample': if (this.ok(name, 60)) this.tone(440 * Math.pow(1.26, amount), 0.3, 0.14 * v, 'triangle'); break;
      case 'claim': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.16, 'triangle', i * 0.09)); this.hiss(200, 1, 0.12, 0.4, 'lowpass'); break;
      case 'buy': this.tone(880, 0.09, 0.12, 'square'); this.tone(1320, 0.3, 0.12, 'sine', 0.07); break;
      case 'hire': this.tone(392, 0.12, 0.14, 'triangle'); this.tone(523, 0.25, 0.14, 'triangle', 0.1); break;
      case 'click': if (this.ok(name, 40)) this.tone(660, 0.05, 0.07, 'square'); break;
      case 'error': if (this.ok(name, 200)) this.tone(160, 0.18, 0.12, 'square', 0, 110); break;
    }
  }

  /** Called every frame with what is around the camera. */
  ambient(waterNear: number, night: number, engines: number) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    this.creek!.gain.setTargetAtTime(0.02 + 0.11 * waterNear, t, 0.4);
    this.engine!.gain.setTargetAtTime(Math.min(0.16, engines * 0.07), t, 0.25);
    this.engineOsc!.frequency.setTargetAtTime(48 + Math.min(3, engines) * 5, t, 0.3);
    if (night > 0.5 && !this.muted && t > this.nextChirp) {   // crickets
      const f = 3900 + Math.random() * 900, n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.tone(f, 0.035, 0.035 * night, 'sine', i * 0.055);
      this.nextChirp = t + 0.35 + Math.random() * 1.3;
    }
  }
}
