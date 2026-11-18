// Original, bounded material wear. Anchored to the building, never to the
// screen or time. This represents use/maintenance, not surveyed damage.
export const WEAR_GLSL=`
float useHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float useNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(useHash(i),useHash(i+vec2(1.,0.)),f.x),mix(useHash(i+vec2(0.,1.)),useHash(i+vec2(1.,1.)),f.x),f.y);}
vec3 usedPaint(vec3 c,vec2 p,float seed,float enabled){
  float broad=useNoise(p*vec2(.27,.17)+vec2(seed*.73,seed*.19));
  float repair=smoothstep(.69,.82,useNoise(p*.71+vec2(seed*.31,9.)));
  vec3 fade=mix(vec3(.80,.85,.87),vec3(1.04,1.02,.98),broad);
  vec3 patched=mix(c*fade,c*1.13+vec3(.012,.010,.006),repair*.52);
  return mix(c,patched,enabled);
}
vec3 sillRunoff(vec3 c,vec2 uv,vec4 opening,vec2 uvPerMetre,float seed,float enabled){
  float below=(uv.y-opening.w)/uvPerMetre.y;
  float x=(uv.x-opening.x)/uvPerMetre.x;
  float width=(opening.z-opening.x)/uvPerMetre.x;
  float left=exp(-pow((x-.025)/.075,2.));
  float right=exp(-pow((x-width+.025)/.075,2.));
  float rivulet=pow(max(0.,useNoise(vec2(x*8.+seed,seed*.21))-.35)*1.6,2.);
  float drip=step(.035,below)*(1.-smoothstep(.10,1.7,below))*(left+right+rivulet*.22);
  float stain=clamp(drip*.72,0.,.62)*enabled;
  return c*mix(vec3(1.),vec3(.35,.42,.38),stain);
}
`;
