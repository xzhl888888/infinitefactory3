// 只接收已校验包内的 data URL；缓存有上限，不随合卡次数增长。
export function createModImages(onReady = () => {}, makeImage = () => new Image()) {
  const cache = new Map();
  return {
    get(data) {
      if (!data) return null;
      if (cache.has(data)) return cache.get(data).ready;
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      const entry = {ready:null}, image = makeImage(); cache.set(data,entry);
      image.onload = () => {
        if (cache.get(data)!==entry) return;
        if (image.naturalWidth <= 2048 && image.naturalHeight <= 2048) entry.ready = image;
        let pixels=[...cache.values()].reduce((n,v)=>n+(v.ready?v.ready.naturalWidth*v.ready.naturalHeight:0),0);
        for(const [key,value] of cache){if(pixels<=8*1024*1024)break;if(key!==data){pixels-=value.ready?value.ready.naturalWidth*value.ready.naturalHeight:0;cache.delete(key);}}
        onReady();
      };
      image.onerror = () => { entry.ready = null; };
      image.src = data;
      return null;
    },
    clear() { cache.clear(); },
  };
}

export function createModAudio() {
  const cache = new Map(), playing=new Set(); let generation = 0;
  return {
    async play(context, data, stillCurrent = () => true) {
      const epoch = generation;
      try {
        if (!cache.has(data)) {
          if (cache.size >= 12) cache.delete(cache.keys().next().value);
          const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c=>c.charCodeAt(0));
          cache.set(data,context.decodeAudioData(bytes.buffer).then(buffer=>{
            // 短音效入口不接受长曲，避免压缩小文件解码后长期占用内存。
            if (buffer.duration > 10 || buffer.numberOfChannels > 2) throw Error('MOD_AUDIO_LIMIT');
            return buffer;
          }).catch(()=>null));
        }
        const buffer = await cache.get(data);
        if (!buffer || epoch !== generation || !stillCurrent()) return false;
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer; gain.gain.value = 0.45; source.connect(gain); gain.connect(context.destination);
        playing.add(source);
        source.onended = () => { playing.delete(source); source.disconnect(); gain.disconnect(); };
        source.start(); return true;
      } catch { return false; }
    },
    clear() { generation++; cache.clear();for(const source of playing){try{source.stop();}catch{}}playing.clear(); },
  };
}
