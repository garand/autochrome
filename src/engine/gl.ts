import { HSL, curveIsId, curveLut, getLut, hsv2rgb } from './core'
import { SRGB_SHOT, wbMatrix, type WbState } from './wb'

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv=vec2(aPos.x*.5+.5,.5-aPos.y*.5); gl_Position=vec4(aPos,0.,1.); }`
/* One pass, in order: denoise + capture sharpening -> local masks, white balance, exposure (linear light)
   -> dehaze, shadows/highlights, clarity -> filmic shoulder + display encoding -> blacks/whites, contrast,
   tone curve -> colour mixer, vibrance/saturation, skin protection, face light -> grading -> film look LUT
   -> vignette, grain. */
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D uImg,uBlur,uCurve; uniform sampler3D uLut;
uniform mat3 uTex; uniform vec2 uImgSize,uGrainRes,uNR; uniform vec4 uView;
uniform mat3 uWBM; uniform vec3 uShTint,uMidTint,uHiTint; uniform vec3 uHsl[8]; uniform vec2 uHslC[8]; uniform vec4 uFaces[8]; uniform int uNFaces;
uniform vec4 uMaskGeo[4]; uniform vec4 uMaskPar[4]; uniform vec3 uMaskGain[4]; uniform vec2 uMaskAdj[4]; uniform int uMaskShow;
uniform float uGain,uBlack,uContrast,uHi,uSh,uWhites,uBlacks,uClarity,uDehaze,uDetail,uVib,uSat,uFade,uLutAmt,uLutN,uVig,uGrain,uFaceLight,uSkin,uSeed,uBal,uBW,uCurveOn,uClip;
in vec2 vUv; out vec4 o;
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.,2./3.,1./3.,3.);vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y);}
vec3 enc(vec3 x){x=clamp(x,0.,1.);return mix(12.92*x,1.055*pow(x,vec3(1./2.4))-.055,step(.0031308,x));}
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
  vec2 uv=(uTex*vec3(vUv,1.)).xy;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.){o=vec4(.055,.055,.06,1.);return;}
  vec2 cuv=uView.xy+vUv*uView.zw, px=1./uImgSize;
  vec3 c=texture(uImg,uv).rgb;
  if(uNR.x>0.||uNR.y>0.){
    float l0=luma(c)+1e-4,ls=0.,lw=0.,cw=0.; vec3 cs=vec3(0.);
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){ vec2 d=vec2(float(i),float(j));
      vec3 a=texture(uImg,uv+d*px*1.3).rgb; float la=luma(a)+1e-4,e=(la-l0)/l0,w=exp(-e*e/(uNR.x*uNR.x+1e-6)); ls+=la*w; lw+=w;
      vec3 b=texture(uImg,uv+d*px*3.2).rgb; float lb=luma(b)+1e-4,e2=(lb-l0)/l0,w2=exp(-e2*e2/.3); cs+=b/lb*w2; cw+=w2; }
    c=mix(c/l0,cs/cw,uNR.y)*(ls/lw);
  }
  if(uDetail!=0.){
    vec3 nb=(texture(uImg,uv+vec2(px.x,0.)).rgb+texture(uImg,uv-vec2(px.x,0.)).rgb+texture(uImg,uv+vec2(0.,px.y)).rgb+texture(uImg,uv-vec2(0.,px.y)).rgb)*.25;
    c*=pow(clamp((luma(c)+2e-4)/(luma(nb)+2e-4),.5,2.),uDetail);}
  // local adjustments (linear + radial gradients, defined in image space)
  vec3 lg=vec3(1.); float lc=0.,lsat=0.,show=0.;
  for(int i=0;i<4;i++){ float ty=uMaskPar[i].x; if(ty<.5)continue; float m;
    if(ty<1.5){ vec2 d=(uv-uMaskGeo[i].xy)*uImgSize, ab=(uMaskGeo[i].zw-uMaskGeo[i].xy)*uImgSize; m=1.-smoothstep(0.,1.,dot(d,ab)/max(dot(ab,ab),1e-6)); }
    else { float r=length((uv-uMaskGeo[i].xy)/max(uMaskGeo[i].zw,vec2(1e-4))); m=1.-smoothstep(1.-uMaskPar[i].y,1.,r); if(uMaskPar[i].z>.5)m=1.-m; }
    lg*=mix(vec3(1.),uMaskGain[i],m); lc+=m*uMaskAdj[i].x; lsat+=m*uMaskAdj[i].y; if(i==uMaskShow)show=m; }
  c=max((uWBM*c)*uGain*lg-uBlack,0.);
  float Lb=max(texture(uBlur,uv).r*uGain*luma((uWBM*vec3(1.))*lg)-uBlack,0.);
  c=max((c-uDehaze*Lb)/(1.-uDehaze),0.);
  float pb=sqrt(clamp(Lb,0.,1.));
  float e=uSh*1.7*pow(1.-pb,2.5)+uHi*1.5*smoothstep(.4,1.,pb);
  c*=exp2(e);
  if(uClarity!=0.){float r=clamp((luma(c)+2e-3)/(Lb*exp2(e)+2e-3),.25,4.);c*=pow(r,uClarity);}
  const float k=.55; vec3 t=max(c-k,0.)/(1.-k); c=mix(c,k+(1.-k)*(1.-1./(1.+t+.35*t*t)),step(k,c));
  vec3 v=enc(c);
  v+=uBlacks*.16*pow(1.-v,vec3(4.))*smoothstep(0.,.06,v+step(0.,uBlacks))+uWhites*.16*pow(v,vec3(3.));
  v=clamp(v,0.,1.);
  v-=(uContrast+lc)*sin(6.2831853*v)/6.2831853;
  if(uCurveOn>.5){ vec3 q=clamp(v,0.,1.)*(255./256.)+.5/256.; v=vec3(texture(uCurve,vec2(q.r,.5)).r,texture(uCurve,vec2(q.g,.5)).g,texture(uCurve,vec2(q.b,.5)).b); }
  v=v*(1.-.16*uFade)+.10*uFade;
  float fm=0.; for(int i=0;i<8;i++){ if(i>=uNFaces)break; vec2 d=(uv-uFaces[i].xy)/uFaces[i].zw; fm=max(fm,1.-smoothstep(.55,1.3,length(d))); }
  vec3 pre=v;
  vec3 h=rgb2hsv(v); float hd=h.x*360.,dh=0.,ds=0.,dl=0.,wo=0.;
  for(int i=0;i<8;i++){float d=abs(mod(hd-uHslC[i].x+540.,360.)-180.);float w=exp(-(d*d)/(uHslC[i].y*uHslC[i].y));dh+=uHsl[i].x*w;ds+=uHsl[i].y*w;dl+=uHsl[i].z*w;if(i<2)wo+=w;}
  float sw=smoothstep(.02,.16,h.y);
  h.x=fract(h.x+dh*sw/360.+1.); h.y=clamp(h.y*(1.+ds*sw),0.,1.); h.z=clamp(h.z*(1.+dl*sw*h.y),0.,1.);
  h.y=clamp(h.y+uVib*h.y*(1.-h.y)*(1.-.6*clamp(wo,0.,1.)),0.,1.);
  h.y=clamp(h.y*max(0.,1.+uSat+lsat),0.,1.);
  v=hsv2rgb(h);
  if(uBW>.5) v=vec3(luma(v)); else v=mix(v,pre+(luma(v)-luma(pre)),uSkin*fm);
  v*=1.+uFaceLight*fm;
  float y=luma(v), p=.5+.22*uBal; float ws=1.-smoothstep(0.,p+.12,y), wh=smoothstep(p-.12,1.,y);
  v+=uShTint*ws+uHiTint*wh+uMidTint*max(0.,1.-ws-wh);
  v=clamp(v,0.,1.);
  if(uLutAmt>0.){v=mix(v,texture(uLut,v*((uLutN-1.)/uLutN)+.5/uLutN).rgb,uLutAmt);}
  float r=length(cuv-.5)*1.4142; float vg=smoothstep(.3,1.05,r); v*=1.-uVig*vg*vg*1.6;
  if(uGrain>0.){vec2 gp=floor(cuv*uGrainRes); float n=hash(gp+uSeed)+hash(gp*1.37+uSeed+7.)-1.; float yy=luma(v); v+=n*uGrain*.11*(1.-.6*abs(2.*yy-1.));}
  v=clamp(v,0.,1.);
  if(uClip>.5){ if(max(v.r,max(v.g,v.b))>=.996)v=vec3(1.,.1,.1); else if(max(v.r,max(v.g,v.b))<=.004)v=vec3(.1,.3,1.); }
  v=mix(v,vec3(1.,.18,.12),show*.45);
  o=vec4(v,1.);
}`

export interface GpuImage { w: number; h: number; tex: WebGLTexture; blur: WebGLTexture }
export interface DrawOpts {
  m: Float32Array            // output uv -> image uv
  view?: number[]            // visible part of the crop [x, y, w, h], normalised
  outW: number; outH: number
  auto: { ev: number; black: number; wb: number[]; shot?: WbState }
  faces?: any[]; masks?: any[]; showMask?: number; clip?: boolean; quick?: boolean; grainRes?: number[]
}

export class Renderer {
  canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; u: Record<string, WebGLUniformLocation | null> = {}
  maxTex: number; private prog: WebGLProgram; private luts = new Map<string, any>(); private curves = new Map<string, WebGLTexture>(); private idLut: any; private idCurve: WebGLTexture
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s }
    const p = this.prog = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link')
    gl.useProgram(p)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name.replace('[0]', ''); this.u[name] = gl.getUniformLocation(p, name) }
    gl.uniform1i(this.u.uImg, 0); gl.uniform1i(this.u.uBlur, 1); gl.uniform1i(this.u.uLut, 2); gl.uniform1i(this.u.uCurve, 3)
    gl.uniform2fv(this.u.uHslC, new Float32Array(HSL.flatMap(h => [h[1] as number, h[2] as number])))
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    this.idLut = this.lutTex({ n: 2, data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]) })
    this.idCurve = this.curveTex({ m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] })
  }
  private tex2(internal: number, fmt: number, w: number, h: number, data: ArrayBufferView, type?: number) {
    const gl = this.gl, t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type ?? gl.HALF_FLOAT, data)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    return t
  }
  private lutTex(l: { n: number; data: Uint8Array }) {
    const gl = this.gl, t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_3D, t)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, l.n, l.n, l.n, 0, gl.RGB, gl.UNSIGNED_BYTE, l.data)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v)
    return { tex: t, n: l.n }
  }
  private curveTex(c: any) {
    const m = curveLut(c.m), ch = [curveLut(c.r), curveLut(c.g), curveLut(c.b)], data = new Float32Array(256 * 4)
    for (let i = 0; i < 256; i++) for (let k = 0; k < 3; k++) { const x = m[i] * 255, a = Math.floor(x), f = x - a; data[i * 4 + k] = ch[k][a] * (1 - f) + ch[k][Math.min(255, a + 1)] * f }
    return this.tex2(this.gl.RGBA16F, this.gl.RGBA, 256, 1, data, this.gl.FLOAT)
  }
  upload(pixels: Uint16Array, w: number, h: number, blur: { w: number; h: number; data: Uint16Array }): GpuImage {
    return { w, h, tex: this.tex2(this.gl.RGB16F, this.gl.RGB, w, h, pixels), blur: this.tex2(this.gl.R16F, this.gl.RED, blur.w, blur.h, blur.data) }
  }
  free(img?: GpuImage | null) { if (!img) return; this.gl.deleteTexture(img.tex); this.gl.deleteTexture(img.blur) }

  draw(img: GpuImage, s: any, o: DrawOpts) {
    const gl = this.gl, u = this.u, cv = this.canvas
    const outW = Math.max(1, Math.round(o.outW)), outH = Math.max(1, Math.round(o.outH))
    if (cv.width !== outW || cv.height !== outH) { cv.width = outW; cv.height = outH }
    gl.viewport(0, 0, outW, outH); gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, img.tex)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, img.blur)
    let lut = this.idLut, amt = 0; const ld = s.look !== 'none' && getLut(s.look)
    if (ld) { if (!this.luts.has(s.look)) this.luts.set(s.look, this.lutTex(ld)); lut = this.luts.get(s.look); amt = s.lookAmount / 100 }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, lut.tex)
    let ctex = this.idCurve; const cOn = !curveIsId(s.curve)
    if (cOn) { const key = JSON.stringify(s.curve); if (!this.curves.has(key)) { if (this.curves.size > 12) { for (const t of this.curves.values()) gl.deleteTexture(t); this.curves.clear() } this.curves.set(key, this.curveTex(s.curve)) } ctex = this.curves.get(key)! }
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ctex)
    gl.uniformMatrix3fv(u.uTex, false, o.m); gl.uniform2f(u.uImgSize, img.w, img.h)
    gl.uniform4fv(u.uView, o.view || [0, 0, 1, 1]); gl.uniform2fv(u.uGrainRes, o.grainRes || [outW, outH])
    const wbOf = (t: number, ti: number) => [Math.exp(0.3 * t + 0.1 * ti), Math.exp(-0.2 * ti), Math.exp(-0.3 * t + 0.1 * ti)]
    // white balance in camera space (see wb.ts), times the skin-matching correction; uploaded column-major
    const W = wbMatrix(o.auto.shot || SRGB_SHOT, s.temp, s.tint, o.auto.wb)
    gl.uniformMatrix3fv(u.uWBM, false, [W[0], W[3], W[6], W[1], W[4], W[7], W[2], W[5], W[8]])
    const gain = Math.pow(2, s.exposure + o.auto.ev)
    gl.uniform1f(u.uGain, gain); gl.uniform1f(u.uBlack, o.auto.black * gain)
    gl.uniform1f(u.uContrast, 0.12 + s.contrast / 100 * 0.42); gl.uniform1f(u.uHi, s.highlights / 100); gl.uniform1f(u.uSh, s.shadows / 100)
    gl.uniform1f(u.uWhites, s.whites / 100); gl.uniform1f(u.uBlacks, s.blacks / 100)
    gl.uniform1f(u.uClarity, s.clarity / 100 * 0.6); gl.uniform1f(u.uDehaze, s.dehaze / 100 * 0.45)
    gl.uniform1f(u.uDetail, o.quick ? 0 : s.sharpen / 100 * 1.6 + s.texture / 100 * 0.9)
    gl.uniform2f(u.uNR, o.quick || !s.nrLuma ? 0 : 0.03 + s.nrLuma / 100 * 0.3, o.quick ? 0 : s.nrColor / 100)
    gl.uniform1f(u.uVib, s.vibrance / 100 * 1.2); gl.uniform1f(u.uSat, s.saturation / 100); gl.uniform1f(u.uFade, s.fade / 100)
    gl.uniform1f(u.uLutAmt, amt); gl.uniform1f(u.uLutN, lut.n); gl.uniform1f(u.uBW, s.bw ? 1 : 0); gl.uniform1f(u.uCurveOn, cOn ? 1 : 0); gl.uniform1f(u.uClip, o.clip ? 1 : 0)
    gl.uniform1f(u.uVig, s.vignette / 100 * 0.55); gl.uniform1f(u.uGrain, o.quick ? 0 : s.grain / 100); gl.uniform1f(u.uSeed, 3.1)
    gl.uniform1f(u.uFaceLight, s.faceLight / 100 * 0.25); gl.uniform1f(u.uSkin, s.skinProtect / 100 * 0.85)
    const hs = new Float32Array(24); HSL.forEach(([n], i) => { hs[i * 3] = s['h_' + n] * 0.3; hs[i * 3 + 1] = s['s_' + n] / 100; hs[i * 3 + 2] = s['l_' + n] / 100 * 0.6 })
    gl.uniform3fv(u.uHsl, hs)
    const tint = (hue: number, a: number) => { const c = hsv2rgb(hue / 360, 1, 1), m = (c[0] + c[1] + c[2]) / 3; return c.map(x => (x - m) * a / 100 * 0.16) }
    gl.uniform3fv(u.uShTint, tint(s.gShHue, s.gShSat)); gl.uniform3fv(u.uMidTint, tint(s.gMidHue, s.gMidSat)); gl.uniform3fv(u.uHiTint, tint(s.gHiHue, s.gHiSat)); gl.uniform1f(u.uBal, s.gBalance / 100)
    const faces = o.faces || [], fa = new Float32Array(32), nf = Math.min(8, faces.length)
    for (let i = 0; i < nf; i++) { const f = faces[i]; fa.set([f.x, f.y, f.sx * 0.62, f.sy * 0.78], i * 4) }
    gl.uniform4fv(u.uFaces, fa); gl.uniform1i(u.uNFaces, nf)
    const geo = new Float32Array(16), par = new Float32Array(16), mg = new Float32Array(12).fill(1), ma = new Float32Array(8)
    ;(o.masks || []).slice(0, 4).forEach((k: any, i: number) => {
      if (k.on === false) return
      if (k.type === 'linear') { geo.set([k.a[0], k.a[1], k.b[0], k.b[1]], i * 4); par.set([1, 0, 0, 0], i * 4) }
      else { geo.set([k.c[0], k.c[1], k.r[0], k.r[1]], i * 4); par.set([2, Math.max(0.02, k.feather / 100), k.invert ? 1 : 0, 0], i * 4) }
      const g = Math.pow(2, k.adj.exposure), w = wbOf(k.adj.temp / 100, k.adj.tint / 100)
      mg.set(w.map(x => x * g), i * 3); ma.set([k.adj.contrast / 100 * 0.42, k.adj.saturation / 100], i * 2)
    })
    gl.uniform4fv(u.uMaskGeo, geo); gl.uniform4fv(u.uMaskPar, par); gl.uniform3fv(u.uMaskGain, mg); gl.uniform2fv(u.uMaskAdj, ma); gl.uniform1i(u.uMaskShow, o.showMask ?? -1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
