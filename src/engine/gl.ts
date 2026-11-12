import { HSL, curveIsId, curveLut, getLut, hsv2rgb } from './core'
import { SRGB_SHOT, wbMatrix, type WbState } from './wb'
import type { DepthMap } from './depth'

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv=vec2(aPos.x*.5+.5,.5-aPos.y*.5); gl_Position=vec4(aPos,0.,1.); }`

/* ------------------------------------------------------------------ lens blur (depth of field)
   Computed before the main pass, in linear light at a reduced size, then blended over the sharp photo in it.
   Depth (0 far .. 1 near) and a subject matte come from depth.worker.ts. The subject is flattened onto its own depth
   so it keeps clean edges; the circle of confusion (CoC) is linear in depth away from the focus, as with a real lens
   (blur grows with the difference in 1/distance), with an in-focus band of +/- the focal range.
   uDofP: x focus depth, y focal range, z CoC in buffer pixels per unit of depth, w the subject's depth.
   The CoC is signed: + behind the focus, - in front. */
const DOF_COC = `uniform sampler2D uDepth; uniform vec4 uDofP;
float dofCoc(float d){ float df=uDofP.x-d; return sign(df)*max(abs(df)-uDofP.y,0.)*uDofP.z; }
/* 1 when the subject is in focus: it is then a sharp layer over a background blurred without it (matte = alpha) */
float dofSubjSharp(){ return 1.-smoothstep(.5,2.,abs(dofCoc(uDofP.w))); }
/* x: the CoC the blur layer is built with, y: how much of the blur layer shows here (before the 1 px fade-in) */
vec2 dofLayer(vec2 dm){ float ss=dofSubjSharp(), ks=dofCoc(mix(dm.r,uDofP.w,dm.g)), kb=dofCoc(dm.r);
  return vec2(mix(ks,kb,ss), mix(1.,1.-dm.g,ss)); }`
const PASS_HEAD = `#version 300 es
precision highp float; precision highp sampler2D;
out vec4 o;
`
/* 1. linear colour, box-filtered down to the buffer size, with near-clipped highlights boosted back towards the
   brightness the sensor could not record (that energy is what makes bokeh balls glow).
   Target 0: colour premultiplied by w, how out of focus the pixel is (w = 0.01 when sharp), and w.
   Target 1: CoC times w, and the plain CoC. Mip levels of these average only out-of-focus light, so a coarse
   sample next to the sharp subject never picks up the subject's colour and spreads it as a glow. */
const PREP_FS = `#version 300 es
precision highp float; precision highp sampler2D;
layout(location=0) out vec4 o; layout(location=1) out vec4 o2;
uniform sampler2D uImg; uniform vec2 uRes; uniform float uGain,uBoost; uniform int uTaps;
${DOF_COC}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes, st=1./(uRes*float(uTaps)), b=(gl_FragCoord.xy-.5)/uRes; vec3 c=vec3(0.);
  for(int j=0;j<4;j++){ if(j>=uTaps)break; for(int i=0;i<4;i++){ if(i>=uTaps)break; c+=texture(uImg,b+(vec2(i,j)+.5)*st).rgb; } }
  c/=float(uTaps*uTaps);
  vec2 dm=texture(uDepth,uv).rg; float k=dofLayer(dm).x, L=dot(c,vec3(.2126,.7152,.0722))*uGain;
  c*=1.+uBoost*pow(smoothstep(.9,2.2,L),2.)*smoothstep(1.,4.,abs(k));   // only light beyond display white (what clipped), and only out of focus
  // a sharp subject's light is not part of the blur. The matte is grown by a few pixels for this, so the rim of
  // mixed subject / background pixels at its edge cannot spread the subject's colour as a glow
  float mg=dm.g; for(int i=0;i<8;i++){ float a=float(i)*.785398; vec2 d=vec2(cos(a),sin(a))/uRes; mg=max(mg,max(texture(uDepth,uv+d*2.5).g,texture(uDepth,uv+d*5.).g)); }
  float sj=1.-smoothstep(.02,.5,mg)*dofSubjSharp(), w=max(.01,smoothstep(1.,3.,abs(k))*sj*sj);
  o=vec4(c*w,w); o2=vec4(k*w,k,0.,0.);
}`
/* 2. the largest |CoC| in each 16 x 16 tile */
const TILE_FS = PASS_HEAD + `uniform sampler2D uCoc;
void main(){ ivec2 t=ivec2(gl_FragCoord.xy)*16, n=textureSize(uCoc,0)-1; float m=0.;
  for(int j=0;j<16;j++)for(int i=0;i<16;i++) m=max(m,abs(texelFetch(uCoc,min(t+ivec2(i,j),n),0).g));
  o=vec4(m); }`
/* 3. per tile, the largest CoC of any neighbouring tile whose blur can reach it: the gather radius */
const DIL_FS = PASS_HEAD + `uniform sampler2D uTile; uniform int uK;
void main(){ ivec2 t=ivec2(gl_FragCoord.xy), n=textureSize(uTile,0)-1; float m=0.;
  for(int j=-6;j<=6;j++){ if(abs(j)>uK)continue; for(int i=-6;i<=6;i++){ if(abs(i)>uK)continue;
    float v=texelFetch(uTile,clamp(t+ivec2(i,j),ivec2(0),n),0).r; if(v>=(length(vec2(i,j))-1.5)*16.) m=max(m,v); } }
  o=vec4(m); }`
/* 4. scatter-as-gather: each pixel collects every neighbour whose blur disc (or cat's eye / blade / ring shape)
   covers it. Samples sit on rings of evenly spaced points; each reads a mip level matching its share of the disc,
   so a few hundred samples still see every highlight. Weights conserve energy (a sample spreads its light over its
   own disc), and a sample behind this pixel may not spread further than this pixel's own blur, which is what keeps
   the background from bleeding over a sharp subject. */
const GATHER_FS = `#version 300 es
precision highp float; precision highp sampler2D;
layout(location=0) out vec4 o; layout(location=1) out vec4 o2;
uniform sampler2D uPrep,uCoc,uDil; uniform vec2 uRes; uniform int uRings,uShape; uniform vec4 uShapeP; uniform float uArea,uAspect;
const float PI=3.14159265;
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
/* q: from the sample to this pixel, c: the sample's blur radius. returns (distance inside the edge, brightness) */
vec2 kern(vec2 q,float c,vec2 uv){
  float r=length(q);
  if(uShape==1){ vec2 dv=(uv-.5)*vec2(uAspect,1.); float k=length(dv); vec2 sh=k>1e-4?dv/k:vec2(0.); float s=uShapeP.x*c*smoothstep(.12,.8,k);
    return vec2(min(c-r,c-length(q+sh*s)),1.); }
  if(uShape==2){ float x=r/max(c,1e-3); return vec2(c-r,mix(.4,2.3,smoothstep(.4,1.,x)*smoothstep(1.06,.94,x))*uShapeP.x); }
  if(uShape==3){ float n=uShapeP.x,a=atan(q.y,q.x)+uShapeP.y,sg=2.*PI/n,t=mod(a,sg)-.5*sg,rho=cos(PI/n)/cos(t); return vec2(c*mix(rho,1.,uShapeP.z)*uShapeP.w-r,1.); }
  if(uShape==4) return vec2(min(c-r,r-uShapeP.x*c),1.);
  return vec2(c-r,1.);
}
void main(){
  ivec2 px=ivec2(gl_FragCoord.xy); vec2 uv=gl_FragCoord.xy/uRes;
  vec4 p0=texelFetch(uPrep,px,0); vec4 c0=vec4(p0.rgb/p0.a,texelFetch(uCoc,px,0).g); float a0=abs(c0.a);
  float R=max(texelFetch(uDil,px/16,0).r,a0);
  o2=vec4(0.);
  if(R<.5){ o=c0; return; }
  float rings=clamp(ceil(R/1.5),1.,float(uRings)), sp=R/rings, A=sp*sp, lod=max(0.,log2(sp)-.6);
  vec2 k0=kern(vec2(0.),a0,uv); float w0=A/max(PI*a0*a0*uArea,A)*max(clamp(k0.x/sp+.5,0.,1.)*k0.y,.05); vec3 acc=c0.rgb*w0; float ws=w0;   // the pixel's own light, through its own kernel (a ring has no centre)
  float rot=ign(gl_FragCoord.xy)*6.2831853, fg=0.;
  for(int k=1;k<=24;k++){ if(float(k)>rings)break;
    float r=float(k)*sp; int n=int(floor(6.2831853*float(k)+.5)); float st=6.2831853/float(n);
    for(int s=0;s<160;s++){ if(s>=n)break;
      float th=rot+float(s)*st+float(k)*2.39996; vec2 off=r*vec2(cos(th),sin(th));
      vec4 pj=textureLod(uPrep,uv+off/uRes,lod); if(pj.a<.02)continue;
      vec4 cj=vec4(pj.rgb/pj.a,textureLod(uCoc,uv+off/uRes,lod).r/pj.a); float ca=abs(cj.a);
      if(cj.a>c0.a+.5) ca=min(ca,a0*1.15+.5);
      vec2 kk=kern(-off,ca,uv); float cov=clamp(kk.x/sp+.5,0.,1.);
      float w=cov*kk.y*A/max(PI*ca*ca*uArea,A)*pj.a; acc+=cj.rgb*w; ws+=w; if(cj.a<c0.a-.5)fg+=w; } }
  o=vec4(acc/max(ws,1e-6),c0.a);
  o2=vec4(fg/max(ws,1e-6),0.,0.,0.);   // how much nearer, blurred things cover this pixel
}`
/* the in-focus band, +/- this much depth around the focus, for the Focal range slider (0..100) */
export const focalRange = (v: number) => Math.pow(Math.max(0, v || 0) / 100, 1.3) * 0.3
/* and back: the slider value for a half-width of the in-focus band */
export const focalRangeValue = (half: number) => Math.min(100, 100 * Math.pow(Math.max(0, half) / 0.3, 1 / 1.3))
/* bokeh shapes, in the order of the bokehShape setting; shapeParams() gives each one's kernel parameters */
export const BOKEH = ['Circle', "Cat's eye", 'Bubble', 'Blades', 'Ring'] as const
const shapeCache: Record<number, { p: number[]; area: number }> = {}
function shapeParams(i: number) {
  if (shapeCache[i]) return shapeCache[i]
  let p = [0, 0, 0, 1], area = 1
  if (i === 1) { p = [0.62, 0, 0, 1]; area = 0.8 }                                       // cat's eye: clipped by the lens barrel towards the corners
  if (i === 2) {                                                                          // bubble (soap-bubble lenses): a bright rim, same total light
    const prof = (x: number) => { const s = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u) }; return 0.4 + (2.3 - 0.4) * s(0.4, 1, x) * s(1.06, 0.94, x) }
    let num = 0, den = 0; for (let k = 0; k < 400; k++) { const x = (k + 0.5) / 400; num += prof(x) * x; den += x }
    p = [den / num, 0, 0, 1]
  }
  if (i === 3) {                                                                          // 6 aperture blades, slightly rounded, scaled to a circle's area
    const n = 6, rot = 0.26, round = 0.18; let a = 0
    for (let k = 0; k < 720; k++) { const th = (k + 0.5) / 720 * 2 * Math.PI, sg = 2 * Math.PI / n, t = ((th + rot) % sg + sg) % sg - sg / 2, rho = Math.cos(Math.PI / n) / Math.cos(t), r = rho + (1 - rho) * round; a += 0.5 * r * r * (2 * Math.PI / 720) }
    p = [n, rot, round, Math.sqrt(Math.PI / a)]
  }
  if (i === 4) { p = [0.58, 0, 0, 1]; area = 1 - 0.58 * 0.58 }                           // ring (mirror lens): a hollow disc
  return (shapeCache[i] = { p, area })
}
/* One pass, in order: denoise + capture sharpening -> tinted glasses -> local masks, white balance, exposure (linear light)
   -> dehaze, shadows/highlights, clarity -> filmic shoulder + display encoding -> blacks/whites, contrast,
   tone curve -> colour mixer, vibrance/saturation, skin protection, face light -> grading -> film look LUT
   -> vignette, grain. */
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D uImg,uBlur,uCurve; uniform sampler3D uLut;
uniform mat3 uTex; uniform vec2 uImgSize,uGrainRes,uNR; uniform vec4 uView;
uniform mat3 uWBM; uniform vec3 uShTint,uMidTint,uHiTint; uniform vec3 uHsl[8]; uniform vec2 uHslC[8]; uniform vec4 uFaces[8]; uniform int uNFaces;
uniform vec4 uGlGeo[6],uGlAx[6],uGlR[72],uGlEye[6]; uniform vec3 uGlGain[6],uGlNrm[6],uGlSel[6],uGlRho[6]; uniform vec2 uGlE[6]; uniform float uGlAmt; uniform int uNGl;
uniform vec4 uMaskGeo[4]; uniform vec4 uMaskPar[4]; uniform vec3 uMaskGain[4]; uniform vec2 uMaskAdj[4]; uniform int uMaskShow;
uniform float uGain,uBlack,uContrast,uHi,uSh,uWhites,uBlacks,uClarity,uDehaze,uDetail,uVib,uSat,uFade,uLutAmt,uLutN,uVig,uGrain,uFaceLight,uSkin,uSeed,uBal,uBW,uCurveOn,uClip;
uniform sampler2D uDof,uDofFg; uniform vec2 uDofRes; uniform float uDofOn,uShowDepth;
${DOF_COC}
in vec2 vUv; out vec4 o;
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.,2./3.,1./3.,3.);vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y);}
vec3 enc(vec3 x){x=clamp(x,0.,1.);return mix(12.92*x,1.055*pow(x,vec3(1./2.4))-.055,step(.0031308,x));}
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
/* the blurred layer, upsampled with weights that favour texels at this pixel's depth, so blur never smears across the subject's edge */
vec3 dofUp(vec2 uv,float k){
  vec2 p=uv*uDofRes-.5,f=fract(p); ivec2 b=ivec2(floor(p)),mx=ivec2(uDofRes)-1; vec3 acc=vec3(0.); float ws=0.,sg=.6+.2*abs(k);
  for(int j=0;j<2;j++)for(int i=0;i<2;i++){ vec4 s=texelFetch(uDof,clamp(b+ivec2(i,j),ivec2(0),mx),0);
    float wb=(i==0?1.-f.x:f.x)*(j==0?1.-f.y:f.y),d=(s.a-k)/sg,w=wb*(exp(-d*d)+1e-4); acc+=s.rgb*w; ws+=w; }
  return acc/ws;
}
/* depth shown as colour: far is deep indigo, near is warm amber */
vec3 depthRamp(float d){ vec3 a=vec3(.11,.09,.33),b=vec3(.45,.2,.62),c=vec3(.93,.38,.45),e=vec3(1.,.82,.45);
  return d<.33?mix(a,b,d/.33):d<.66?mix(b,c,(d-.33)/.33):mix(c,e,(d-.66)/.34); }
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
  // lens blur (depth of field): the out-of-focus layer replaces the sharp photo as soon as its blur is more than about a pixel
  float ld=0.,dcoc=0.;
  if(uDofOn>.5||uShowDepth>.5){ vec2 dm=texture(uDepth,uv).rg; ld=mix(dm.r,uDofP.w,dm.g); vec2 ly=dofLayer(dm); dcoc=ly.x;
    // the blur layer shows where this pixel is out of focus, and where a nearer out-of-focus thing spreads over it
    float t=max(smoothstep(.3,1.2,abs(dcoc))*ly.y,uDofOn>.5?clamp(texture(uDofFg,uv).r*3.,0.,1.):0.); if(uDofOn>.5&&t>0.)c=mix(c,dofUp(uv,dcoc),t); }
  // tinted glasses (see glasses.ts): inside each lens, fading in from its rim, undo the tint; where a smoothed lean
  // towards the reflection colour says there is reflection, rebuild from the cleanest channel with clean skin's colour
  // (nearly neutral over the eye)
  for(int i=0;i<6;i++){ if(i>=uNGl)break;
    vec2 asp=vec2(1.,uImgSize.y/uImgSize.x), d=(uv-uGlGeo[i].xy)*asp, gx=uGlAx[i].xy, gy=uGlAx[i].zw; float lu=dot(d,gx)/uGlGeo[i].z,lv=dot(d,gy)/uGlGeo[i].w;
    float lr=pow(pow(abs(lu),3.)+pow(abs(lv),3.),1./3.); if(lr>1.7)continue;
    float la=atan(lv,lu); if(la<0.)la+=6.2831853; float lf=la/6.2831853*48.; int j0=int(floor(lf))%48,j1=(j0+1)%48;
    float R=mix(uGlR[i*12+j0/4][j0%4],uGlR[i*12+j1/4][j1%4],fract(lf)), lm=1.-smoothstep(.96,1.01,lr/R); if(lm<=0.)continue;
    vec3 gg=uGlGain[i], b=c*gg;
    if(uGlE[i].y>0.){
      float rr=.05*uGlGeo[i].z, ea=0.;
      for(int k=0;k<9;k++){ float an=float(k)*.7853982; vec2 off=k==8?vec2(0.):vec2(cos(an),sin(an))*rr; vec3 t=texture(uImg,uv+off/asp).rgb*gg; ea+=dot(t,uGlNrm[i])/(luma(t)+1e-4); }
      float q=smoothstep(uGlE[i].x,uGlE[i].y,ea/9.)*uGlAmt;
      vec2 de=(uv-uGlEye[i].xy)*asp; float ew=1.-smoothstep(.7,1.2,length(vec2(dot(de,gx)/uGlEye[i].z,dot(de,gy)/uGlEye[i].w)));
      vec2 px1=1./uImgSize; float sl=.4*dot(b,uGlSel[i]); for(int k=0;k<4;k++){ vec2 off=vec2(k==0?1.:k==1?-1.:0.,k==2?1.:k==3?-1.:0.)*px1; sl+=.15*dot(texture(uImg,uv+off).rgb*gg,uGlSel[i]); }   // a touch of smoothing: the kept channels are noisy in shade
      b=mix(b,max(sl,0.)*mix(uGlRho[i],vec3(1.),.6*ew),q); }
    c=mix(c,b,lm); }
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
  if(uShowDepth>.5){ float inF=1.-smoothstep(uDofP.y,uDofP.y+.025,abs(uDofP.x-ld)); vec3 dr=depthRamp(ld); v=mix(dr*(.45+.75*luma(v)),v,inF); }
  if(uClip>.5){ if(max(v.r,max(v.g,v.b))>=.996)v=vec3(1.,.1,.1); else if(max(v.r,max(v.g,v.b))<=.004)v=vec3(.1,.3,1.); }
  v=mix(v,vec3(1.,.18,.12),show*.45);
  o=vec4(v,1.);
}`

/* one lens of the tinted-glasses fix, in image space: centre in uv, radii and axes in image-width units */
export interface LensUniform { c: number[]; rx: number; ry: number; ax: number[]; up: number[]; R: number[]; eye: number[]; gain: number[]; nrm: number[]; e: number[]; sel: number[]; rho: number[] }
export interface GpuImage { w: number; h: number; tex: WebGLTexture; blur: WebGLTexture }
export interface DrawOpts {
  m: Float32Array            // output uv -> image uv
  view?: number[]            // visible part of the crop [x, y, w, h], normalised
  outW: number; outH: number
  auto: { ev: number; black: number; wb: number[]; shot?: WbState }
  dof?: { map: DepthMap; focus: number } | null   // lens blur: the photo's depth map and the depth in focus
  showDepth?: boolean; hq?: boolean               // depth visualisation; best lens blur quality (export)
  faces?: any[]; lenses?: LensUniform[]; masks?: any[]; showMask?: number; clip?: boolean; quick?: boolean; grainRes?: number[]
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
    this.initDof()
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
    const dof = this.dofPasses(img, s, o, outW)
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
    const ls = o.lenses || [], nl = Math.min(6, ls.length), ga = (s.glasses ?? 0) / 100
    const lg = new Float32Array(24), lx = new Float32Array(24), lR = new Float32Array(288).fill(1), le = new Float32Array(24).fill(1), lk = new Float32Array(18).fill(1), ln = new Float32Array(18), lsl = new Float32Array(18), lrh = new Float32Array(18), lE = new Float32Array(12)
    for (let i = 0; i < nl; i++) {
      const L = ls[i]; lg.set([L.c[0], L.c[1], L.rx, L.ry], i * 4); lx.set([L.ax[0], L.ax[1], L.up[0], L.up[1]], i * 4); lR.set(L.R.slice(0, 48), i * 48); le.set(L.eye, i * 4)
      lk.set(L.gain.map(x => Math.pow(x, ga)), i * 3); ln.set(L.nrm, i * 3); lsl.set(L.sel, i * 3); lrh.set(L.rho, i * 3); lE.set(L.e, i * 2)
    }
    gl.uniform4fv(u.uGlGeo, lg); gl.uniform4fv(u.uGlAx, lx); gl.uniform4fv(u.uGlR, lR); gl.uniform4fv(u.uGlEye, le); gl.uniform3fv(u.uGlGain, lk); gl.uniform3fv(u.uGlNrm, ln); gl.uniform3fv(u.uGlSel, lsl); gl.uniform3fv(u.uGlRho, lrh)
    gl.uniform2fv(u.uGlE, lE); gl.uniform1f(u.uGlAmt, Math.min(1, ga)); gl.uniform1i(u.uNGl, ga > 0 ? nl : 0)   // past 100 only the tint gain grows
    const geo = new Float32Array(16), par = new Float32Array(16), mg = new Float32Array(12).fill(1), ma = new Float32Array(8)
    ;(o.masks || []).slice(0, 4).forEach((k: any, i: number) => {
      if (k.on === false) return
      if (k.type === 'linear') { geo.set([k.a[0], k.a[1], k.b[0], k.b[1]], i * 4); par.set([1, 0, 0, 0], i * 4) }
      else { geo.set([k.c[0], k.c[1], k.r[0], k.r[1]], i * 4); par.set([2, Math.max(0.02, k.feather / 100), k.invert ? 1 : 0, 0], i * 4) }
      const g = Math.pow(2, k.adj.exposure), w = wbOf(k.adj.temp / 100, k.adj.tint / 100)
      mg.set(w.map(x => x * g), i * 3); ma.set([k.adj.contrast / 100 * 0.42, k.adj.saturation / 100], i * 2)
    })
    gl.uniform4fv(u.uMaskGeo, geo); gl.uniform4fv(u.uMaskPar, par); gl.uniform3fv(u.uMaskGain, mg); gl.uniform2fv(u.uMaskAdj, ma); gl.uniform1i(u.uMaskShow, o.showMask ?? -1)
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, dof.depth || this.dofDummy)
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, dof.on ? this.dofT!.out : this.dofDummy)
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, dof.on ? this.dofT!.fg : this.dofDummy)
    gl.uniform4fv(u.uDofP, dof.P); gl.uniform2f(u.uDofRes, dof.w, dof.h); gl.uniform1f(u.uDofOn, dof.on ? 1 : 0); gl.uniform1f(u.uShowDepth, o.showDepth && dof.depth ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /* ---------------------------------------------------------------- lens blur passes (see GATHER_FS) */
  private dofProg: Record<string, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }> = {}
  private dofT: { w: number; h: number; tw: number; th: number; prep: WebGLTexture; coc: WebGLTexture; tile: WebGLTexture; dil: WebGLTexture; out: WebGLTexture; fg: WebGLTexture } | null = null
  private dofFb!: WebGLFramebuffer; private dofDummy!: WebGLTexture; private dofKey = ''
  private depthTex = new Map<DepthMap, WebGLTexture>(); private ids = new WeakMap<object, number>(); private nextId = 1
  dofOK = false   // needs float render targets (EXT_color_buffer_float), present in all current desktop browsers
  private initDof() {
    const gl = this.gl
    this.dofOK = !!gl.getExtension('EXT_color_buffer_float')
    const loc = gl.getAttribLocation(this.prog, 'aPos')
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s }
    for (const [k, fs] of Object.entries({ prep: PREP_FS, tile: TILE_FS, dil: DIL_FS, gather: GATHER_FS })) {
      const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, loc, 'aPos'); gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link')
      const u: Record<string, WebGLUniformLocation | null> = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name; u[name] = gl.getUniformLocation(p, name) }
      this.dofProg[k] = { p, u }
    }
    this.dofFb = gl.createFramebuffer()!
    this.dofDummy = this.tex2(gl.RG8, gl.RG, 1, 1, new Uint8Array([0, 0]), gl.UNSIGNED_BYTE)
    gl.useProgram(this.prog); gl.uniform1i(this.u.uDepth, 4); gl.uniform1i(this.u.uDof, 5); gl.uniform1i(this.u.uDofFg, 6)
  }
  private depthTexture(m: DepthMap) {
    let t = this.depthTex.get(m)
    if (t) { this.depthTex.delete(m); this.depthTex.set(m, t); return t }   // most recently used last
    t = this.tex2(this.gl.RG8, this.gl.RG, m.w, m.h, m.data, this.gl.UNSIGNED_BYTE); this.depthTex.set(m, t)
    if (this.depthTex.size > 10) { const [k, old] = this.depthTex.entries().next().value!; this.gl.deleteTexture(old); this.depthTex.delete(k) }
    return t
  }
  private target(w: number, h: number) {
    const gl = this.gl, T = this.dofT
    if (T && T.w === w && T.h === h) return T
    if (T) for (const t of [T.prep, T.coc, T.tile, T.dil, T.out, T.fg]) gl.deleteTexture(t)
    const mk = (fmt: number, w: number, h: number, levels: number, filter: number) => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t
    }
    const tw = Math.ceil(w / 16), th = Math.ceil(h / 16), levels = Math.floor(Math.log2(Math.max(w, h))) + 1
    this.dofKey = ''
    return (this.dofT = { w, h, tw, th, prep: mk(gl.RGBA16F, w, h, levels, gl.LINEAR_MIPMAP_LINEAR), coc: mk(gl.RG16F, w, h, levels, gl.LINEAR_MIPMAP_LINEAR), tile: mk(gl.R16F, tw, th, 1, gl.NEAREST), dil: mk(gl.R16F, tw, th, 1, gl.NEAREST), out: mk(gl.RGBA16F, w, h, 1, gl.NEAREST), fg: mk(gl.R16F, w, h, 1, gl.LINEAR) })
  }
  /* Runs the lens blur passes when they are needed and anything they depend on changed.
     The blur is computed at a size where the largest blur is about 40 px (56 for export): big blurs need no more
     detail than that, and the composite in the main pass takes the sharp photo wherever the blur is under a pixel. */
  private dofPasses(img: GpuImage, s: any, o: DrawOpts, outW: number) {
    const gl = this.gl, L = o.dof, none = { on: false, depth: null as WebGLTexture | null, P: [0, 0, 0, 0], w: 1, h: 1 }
    if (!L || !this.dofOK) return none
    const depth = this.depthTexture(L.map), amount = Math.max(0, Math.min(1, (s.lensBlur || 0) / 100))
    const range = focalRange(s.focusRange)
    const frac = Math.pow(amount, 1.35) * 0.06                         // blur radius per unit of depth, as a share of the long edge
    const P = [L.focus, range, 0, L.map.subj]
    if (frac <= 0) return { ...none, depth, P }
    const q = o.hq ? { Rt: 56, rings: 18, cap: 4096 } : o.quick ? { Rt: 20, rings: 7, cap: 1024 } : { Rt: 40, rings: 12, cap: 2048 }
    const imgLong = Math.max(img.w, img.h), dmax = Math.max(L.focus - range, 1 - L.focus - range, 0.05)
    const shown = outW / Math.max(1e-6, Math.hypot(o.m[0] * img.w, o.m[1] * img.h)) * imgLong   // the image's long edge at the output's scale
    let long = Math.min(imgLong, q.cap, Math.max(shown, 256), q.Rt / (frac * dmax))
    long = Math.max(long, Math.min(256, imgLong))
    const sc = long / imgLong, w = Math.max(1, Math.round(img.w * sc)), h = Math.max(1, Math.round(img.h * sc))
    P[2] = frac * Math.max(w, h)
    const shape = Math.max(0, Math.min(4, Math.round(s.bokehShape || 0))), boost = Math.max(0, s.bokehBoost ?? 0) / 100 * 9
    const gain = Math.pow(2, s.exposure + o.auto.ev)
    const id = (x: object) => { if (!this.ids.has(x)) this.ids.set(x, this.nextId++); return this.ids.get(x) }
    const T = this.target(w, h)
    const key = [id(img), id(L.map), L.focus.toFixed(4), range.toFixed(4), P[2].toFixed(3), shape, boost.toFixed(2), Math.round(Math.log2(gain) * 4), q.rings].join('|')
    const result = { on: true, depth, P, w, h }
    if (key === this.dofKey) return result
    const pass = (name: string, tex: WebGLTexture, vw: number, vh: number) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.viewport(0, 0, vw, vh)
      const P = this.dofProg[name]; gl.useProgram(P.p); return P.u
    }
    const bind = (unit: number, t: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t) }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dofFb)
    // 1. prep
    let u = pass('prep', T.prep, w, h); bind(0, img.tex); bind(1, depth)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, T.coc, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.uniform1i(u.uImg, 0); gl.uniform1i(u.uDepth, 1); gl.uniform2f(u.uRes, w, h); gl.uniform1f(u.uGain, gain); gl.uniform1f(u.uBoost, boost)
    gl.uniform1i(u.uTaps, Math.max(1, Math.min(4, Math.round(img.w / w)))); gl.uniform4fv(u.uDofP, P)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    bind(0, T.prep); gl.generateMipmap(gl.TEXTURE_2D); bind(0, T.coc); gl.generateMipmap(gl.TEXTURE_2D)
    // 2. tiles, 3. dilation
    u = pass('tile', T.tile, T.tw, T.th); bind(0, T.coc); gl.uniform1i(u.uCoc, 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
    u = pass('dil', T.dil, T.tw, T.th); bind(0, T.tile); gl.uniform1i(u.uTile, 0); gl.uniform1i(u.uK, Math.min(6, Math.ceil(q.Rt * 1.1 / 16))); gl.drawArrays(gl.TRIANGLES, 0, 3)
    // 4. gather, in bands so a big export never stalls the GPU in one long draw
    u = pass('gather', T.out, w, h); bind(0, T.prep); bind(1, T.dil); bind(2, T.coc); gl.uniform1i(u.uCoc, 2)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, T.fg, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.uniform1i(u.uPrep, 0); gl.uniform1i(u.uDil, 1); gl.uniform2f(u.uRes, w, h); gl.uniform1i(u.uRings, q.rings); gl.uniform1i(u.uShape, shape)
    const sp = shapeParams(shape); gl.uniform4fv(u.uShapeP, sp.p); gl.uniform1f(u.uArea, sp.area); gl.uniform1f(u.uAspect, img.w / img.h)
    const band = Math.max(64, Math.round(400000 / w)); gl.enable(gl.SCISSOR_TEST)
    for (let y = 0; y < h; y += band) { gl.scissor(0, y, w, band); gl.drawArrays(gl.TRIANGLES, 0, 3); if (o.hq) gl.flush() }
    gl.disable(gl.SCISSOR_TEST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.dofKey = key
    return result
  }
}
