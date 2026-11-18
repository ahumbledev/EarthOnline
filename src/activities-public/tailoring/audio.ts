
/** Quiet synthesized tool sounds; no recording/download dependencies or queued autoplay. */
export function createTailoringAudio(){
  let context:AudioContext|undefined,master:GainNode|undefined,motor:OscillatorNode|undefined,motorGain:GainNode|undefined;
  let preferences={muted:false,volume:.32},disposed=false,lastSnip=0,lastTick=0;
  const voices=new Set<OscillatorNode>();
  function unlock(){
    if(disposed)return;
    try{
      if(!context){
        context=new AudioContext();master=context.createGain();master.gain.value=preferences.muted?0:preferences.volume;master.connect(context.destination);
        motor=context.createOscillator();motor.type='triangle';motor.frequency.value=65;
        const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=460;
        motorGain=context.createGain();motorGain.gain.value=0;motor.connect(filter);filter.connect(motorGain);motorGain.connect(master);motor.start();
      }
      if(context.state==='suspended')void context.resume().catch(()=>{});
    }catch{/* Tool sound is optional on devices without Web Audio. */}
  }
  function tone(frequency:number,duration:number,volume:number,type:OscillatorType='sine'){
    if(!context||context.state!=='running'||!master||preferences.muted||disposed||voices.size>=5)return;
    const now=context.currentTime,source=context.createOscillator(),gain=context.createGain();source.type=type;
    source.frequency.setValueAtTime(frequency,now);source.frequency.exponentialRampToValueAtTime(frequency*.55,now+duration);
    gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);source.connect(gain);gain.connect(master);
    voices.add(source);source.onended=()=>{voices.delete(source);source.disconnect();gain.disconnect();};source.start();source.stop(now+duration);
  }
  function stop(){
    if(context&&motorGain){motorGain.gain.cancelScheduledValues(context.currentTime);motorGain.gain.setValueAtTime(0,context.currentTime);}
    for(const voice of voices){try{voice.stop();}catch{/* Already ended. */}}voices.clear();
  }
  return {
    unlock,
    get muted(){return preferences.muted;},
    toggle(){preferences={...preferences,muted:!preferences.muted};if(master&&context)master.gain.setTargetAtTime(preferences.muted?0:preferences.volume,context.currentTime,.02);if(preferences.muted)stop();return preferences.muted;},
    snip(now:number){if(now-lastSnip<140)return;lastSnip=now;tone(2100,.055,.2,'triangle');tone(350,.075,.15,'square');},
    complete(){tone(523.25,.35,.18);tone(783.99,.5,.1);},
    update(now:number,pedal:number){
      if(!context||!motorGain||!motor||disposed)return;
      motorGain.gain.setTargetAtTime(pedal>0?.045+pedal*.045:0,context.currentTime,.025);
      motor.frequency.setTargetAtTime(65+pedal*90,context.currentTime,.025);
      if(pedal>0&&now-lastTick>150-pedal*85){lastTick=now;tone(950,.028,.1,'triangle');tone(160,.04,.16);}
    },
    stop,
    dispose(){if(disposed)return;stop();disposed=true;motor?.stop();motor?.disconnect();master?.disconnect();void context?.close().catch(()=>{});},
  };
}
