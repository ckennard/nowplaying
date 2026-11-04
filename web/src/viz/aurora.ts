import type { RGB } from '../lib/palette';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// Domain-warped fbm, blended across the 4 palette colors. Kept cheap for an integrated GPU.
const FRAG = `precision mediump float;
uniform vec2 u_res; uniform float u_time; uniform float u_energy; uniform float u_kick;
uniform vec3 u_c0; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3; uniform vec3 u_base;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv * vec2(u_res.x/u_res.y, 1.0) * 1.6;
  float t = u_time * (0.035 + u_energy * 0.08);
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0*q + vec2(1.7, 9.2) + t*1.3), fbm(p + 3.0*q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 2.5*r);
  vec3 col = mix(u_c0, u_c1, smoothstep(0.15, 0.85, f));
  col = mix(col, u_c2, smoothstep(0.35, 1.0, length(q)) * 0.75);
  col = mix(col, u_c3, smoothstep(0.4, 1.0, r.x) * 0.55);
  float glow = 0.42 + 0.35*f + u_energy*0.35 + u_kick*0.25;
  col = mix(u_base, col, clamp(glow, 0.0, 1.0));
  float vig = smoothstep(1.25, 0.25, length(uv - 0.5));
  col *= mix(0.45, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Aurora {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private cur: number[][] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    for (const u of ['u_res', 'u_time', 'u_energy', 'u_kick', 'u_c0', 'u_c1', 'u_c2', 'u_c3', 'u_base']) this.loc[u] = gl.getUniformLocation(prog, u);
  }

  /** Renders a frame; colors ease toward the target palette. Render scale is reduced for performance. */
  draw(timeSec: number, colors: RGB[], base: RGB, energy: number, kick: number) {
    const { gl, canvas } = this;
    const scale = 0.5;
    const w = Math.floor(canvas.clientWidth * scale), h = Math.floor(canvas.clientHeight * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    const targets = [...colors.slice(0, 4), base];
    if (!this.cur.length) this.cur = targets.map((c) => c.map((v) => v / 255));
    this.cur = this.cur.map((c, i) => c.map((v, j) => v + (targets[i][j] / 255 - v) * 0.02));
    gl.uniform2f(this.loc.u_res, w, h);
    gl.uniform1f(this.loc.u_time, timeSec);
    gl.uniform1f(this.loc.u_energy, energy);
    gl.uniform1f(this.loc.u_kick, kick);
    ['u_c0', 'u_c1', 'u_c2', 'u_c3', 'u_base'].forEach((u, i) => gl.uniform3f(this.loc[u], this.cur[i][0], this.cur[i][1], this.cur[i][2]));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.gl.deleteProgram(this.prog);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
