import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { YouTubeAudioEngineHandle, YouTubeAudioEngineProps, YouTubeAudioSnapshot } from './YouTubeAudioEngine.types';
import { normalizeYouTubeVideoId } from '../security/externalUrls.mjs';

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><div id="player"></div><script>
let player, snapshot={duration:0,loading:false,playing:false,position:0};
const send=(patch)=>{snapshot={...snapshot,...patch};window.ReactNativeWebView.postMessage(JSON.stringify({type:'state',snapshot}))};
window.onYouTubeIframeAPIReady=()=>{player=new YT.Player('player',{height:'200',width:'200',playerVars:{playsinline:1,controls:0,disablekb:1,rel:0},events:{onReady:()=>send({duration:player.getDuration()||0}),onStateChange:(e)=>{send({duration:player.getDuration()||snapshot.duration,loading:e.data===3,playing:e.data===1,position:player.getCurrentTime()||snapshot.position});if(e.data===0)window.ReactNativeWebView.postMessage(JSON.stringify({type:'ended'}))},onError:(e)=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:'YouTube вернул ошибку '+e.data}))}});setInterval(()=>{if(player&&player.getCurrentTime)send({duration:player.getDuration()||snapshot.duration,position:player.getCurrentTime()||0})},250)};
const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
window.volna={load:(id,start,autoplay)=>{if(!player)return;send({duration:0,loading:autoplay,playing:false,position:start});(autoplay?player.loadVideoById:player.cueVideoById).call(player,{videoId:id,startSeconds:start})},play:()=>{send({loading:true});player&&player.playVideo()},pause:()=>player&&player.pauseVideo(),seek:(seconds,resume)=>{send({loading:resume,position:seconds});player&&player.seekTo(seconds,true);if(resume)player.playVideo()},stop:()=>{player&&player.stopVideo();send({duration:0,loading:false,playing:false,position:0})}};
</script></body></html>`;

export const YouTubeAudioEngine = forwardRef<YouTubeAudioEngineHandle, YouTubeAudioEngineProps>(function YouTubeAudioEngine({ onEnded, onError, onStateChange }, ref) {
  const webViewRef = useRef<WebView>(null);
  const run = (command: string) => webViewRef.current?.injectJavaScript(`(function attempt(){if(window.volna){window.volna.${command}}else{setTimeout(attempt,100)}})();true;`);
  useImperativeHandle(ref, () => ({
    load: (videoId, startSeconds = 0, autoplay = false) => {
      const safeVideoId = normalizeYouTubeVideoId(videoId);
      if (!safeVideoId) { onError?.('Некорректный идентификатор YouTube'); return; }
      const safeStartSeconds = Number.isFinite(startSeconds) ? Math.min(86_400, Math.max(0, startSeconds)) : 0;
      run(`load(${JSON.stringify(safeVideoId)},${safeStartSeconds},${autoplay})`);
    },
    pause: () => run('pause()'),
    play: () => run('play()'),
    seek: (seconds, resume = false) => run(`seek(${Math.max(0, seconds)},${resume})`),
    stop: () => run('stop()'),
  }));
  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; message?: string; snapshot?: YouTubeAudioSnapshot };
      if (message.type === 'state' && message.snapshot) onStateChange?.(message.snapshot);
      else if (message.type === 'ended') onEnded?.();
      else if (message.type === 'error') onError?.(message.message || 'Ошибка YouTube');
    } catch {}
  };
  return <View pointerEvents="none" style={styles.engine}><WebView allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} onMessage={onMessage} originWhitelist={['https://www.youtube.com']} ref={webViewRef} source={{ html, baseUrl: 'https://www.youtube.com' }} style={styles.webView} /></View>;
});

const styles = StyleSheet.create({
  engine: { position: 'absolute', left: 0, top: 0, width: 200, height: 200, opacity: 0.01, zIndex: -1 },
  webView: { width: 200, height: 200, backgroundColor: 'transparent' },
});
