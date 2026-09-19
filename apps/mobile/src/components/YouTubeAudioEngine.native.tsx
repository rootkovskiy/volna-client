import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { YouTubeAudioEngineHandle, YouTubeAudioEngineProps, YouTubeAudioSnapshot } from './YouTubeAudioEngine.types';
import { normalizeYouTubeVideoId } from '../security/externalUrls.mjs';

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><div id="player"></div><script>
let player, ready=false, videoId='', pendingLoad=null, snapshot={duration:0,loading:false,playing:false,position:0};
const send=(patch)=>{snapshot={...snapshot,...patch};window.ReactNativeWebView.postMessage(JSON.stringify({type:'state',snapshot}))};
window.onYouTubeIframeAPIReady=()=>{player=new YT.Player('player',{height:'200',width:'200',playerVars:{playsinline:1,controls:0,disablekb:1,rel:0},events:{onReady:()=>{ready=true;const request=pendingLoad;pendingLoad=null;if(request)execute(request)},onStateChange:(e)=>{if(!ready||!videoId)return;send({duration:player.getDuration()||snapshot.duration,loading:e.data===3,playing:e.data===1,position:player.getCurrentTime()||snapshot.position});if(e.data===0)window.ReactNativeWebView.postMessage(JSON.stringify({type:'ended'}))},onError:(e)=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:'YouTube вернул ошибку '+e.data}))}});setInterval(()=>{if(ready&&videoId)send({duration:player.getDuration()||snapshot.duration,position:player.getCurrentTime()||0})},250)};
const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
const execute=(command)=>{
  if(command.action==='load'){
    videoId=command.videoId;
    send({duration:0,loading:command.autoplay,playing:false,position:command.startSeconds});
    if(!ready){pendingLoad=command;return}
    (command.autoplay?player.loadVideoById:player.cueVideoById).call(player,{videoId:command.videoId,startSeconds:command.startSeconds});return
  }
  if(command.action==='play'){
    if(!videoId)return;
    if(pendingLoad)pendingLoad.autoplay=true;
    send({loading:true});if(ready)player.playVideo();return
  }
  if(command.action==='pause'){
    if(pendingLoad)pendingLoad.autoplay=false;
    if(ready)player.pauseVideo();send({loading:false,playing:false});return
  }
  if(command.action==='seek'){
    if(!videoId)return;
    send({loading:command.resume,position:command.seconds});
    if(pendingLoad){pendingLoad.startSeconds=command.seconds;pendingLoad.autoplay=command.resume}
    if(ready){player.seekTo(command.seconds,true);if(command.resume)player.playVideo()}return
  }
  if(command.action==='stop'){
    pendingLoad=null;videoId='';
    if(ready)player.stopVideo();send({duration:0,loading:false,playing:false,position:0})
  }
};
const receive=(event)=>{let command;try{command=JSON.parse(event.data)}catch{return}if(!command||typeof command!=='object'||typeof command.action!=='string')return;if(command.action==='load'){if(typeof command.videoId!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(command.videoId)||typeof command.startSeconds!=='number'||!Number.isFinite(command.startSeconds)||command.startSeconds<0||command.startSeconds>86400||typeof command.autoplay!=='boolean')return;execute(command);return}if(command.action==='play'||command.action==='pause'||command.action==='stop'){execute(command);return}if(command.action==='seek'){if(typeof command.seconds!=='number'||!Number.isFinite(command.seconds)||command.seconds<0||command.seconds>86400||typeof command.resume!=='boolean')return;execute(command)}};
document.addEventListener('message',receive);window.addEventListener('message',receive);
</script></body></html>`;

type YouTubeWebViewCommand =
  | { action: 'load'; autoplay: boolean; startSeconds: number; videoId: string }
  | { action: 'pause' | 'play' | 'stop' }
  | { action: 'seek'; resume: boolean; seconds: number };

export const YouTubeAudioEngine = forwardRef<YouTubeAudioEngineHandle, YouTubeAudioEngineProps>(function YouTubeAudioEngine({ onEnded, onError, onStateChange }, ref) {
  const webViewRef = useRef<WebView>(null);
  const sendCommand = (command: YouTubeWebViewCommand) => webViewRef.current?.postMessage(JSON.stringify(command));
  useImperativeHandle(ref, () => ({
    load: (videoId, startSeconds = 0, autoplay = false) => {
      const safeVideoId = normalizeYouTubeVideoId(videoId);
      if (!safeVideoId) { onError?.('Некорректный идентификатор YouTube'); return; }
      const safeStartSeconds = Number.isFinite(startSeconds) ? Math.min(86_400, Math.max(0, startSeconds)) : 0;
      sendCommand({ action: 'load', autoplay, startSeconds: safeStartSeconds, videoId: safeVideoId });
    },
    pause: () => sendCommand({ action: 'pause' }),
    play: () => sendCommand({ action: 'play' }),
    seek: (seconds, resume = false) => sendCommand({
      action: 'seek',
      resume,
      seconds: Number.isFinite(seconds) ? Math.min(86_400, Math.max(0, seconds)) : 0,
    }),
    stop: () => sendCommand({ action: 'stop' }),
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
