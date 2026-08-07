import { Platform } from 'react-native';
import { YouTubeAudioEngine as NativeEngine } from './YouTubeAudioEngine.native';
import { YouTubeAudioEngine as WebEngine } from './YouTubeAudioEngine.web';

export const YouTubeAudioEngine = Platform.OS === 'web' ? WebEngine : NativeEngine;
