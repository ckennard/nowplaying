/** Microphone analyser. Needs a secure context (HTTPS or localhost). */
export class Mic {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  analyser?: AnalyserNode;
  freq = new Uint8Array(0);
  private smoothedEnergy = 0;
  private bassAvg = 0;

  get running() { return Boolean(this.analyser); }

  async start() {
    if (this.analyser) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('The microphone needs HTTPS. Open this page through its Tailscale https:// address.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    src.connect(this.analyser);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.analyser = undefined;
    this.ctx = undefined;
    this.stream = undefined;
    this.smoothedEnergy = 0;
  }

  /** Updates the frequency buffer; returns overall energy 0..1 and a bass "kick" 0..1. */
  sample(): { energy: number; kick: number } {
    if (!this.analyser) return { energy: 0, kick: 0 };
    this.analyser.getByteFrequencyData(this.freq);
    const n = this.freq.length;
    let sum = 0, bass = 0;
    const bassBins = Math.max(4, Math.floor(n * 0.012));
    for (let i = 0; i < n; i++) sum += this.freq[i];
    for (let i = 1; i <= bassBins; i++) bass += this.freq[i];
    const energy = Math.min(1, sum / n / 110);
    bass /= bassBins * 255;
    this.bassAvg = this.bassAvg * 0.95 + bass * 0.05;
    const kick = Math.max(0, Math.min(1, (bass - this.bassAvg) * 4));
    this.smoothedEnergy = this.smoothedEnergy * 0.85 + energy * 0.15;
    return { energy: this.smoothedEnergy, kick };
  }
}

export const mic = new Mic();
