import { AtSign, Eye, LockKeyhole } from 'lucide-react-native';
import { createElement, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppImage as Image } from '../components/AppImage';

type WaveVariant = 'lines' | 'dots';

function useAnimatedCanvas(drawFrame: (context: CanvasRenderingContext2D, width: number, height: number, seconds: number) => void) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let width = 1;
    let height = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const render = (milliseconds: number) => {
      context.clearRect(0, 0, width, height);
      drawFrame(context, width, height, reducedMotion ? 0 : milliseconds / 1000);
      if (!reducedMotion && !document.hidden) frame = window.requestAnimationFrame(render);
    };

    const handleVisibility = () => {
      window.cancelAnimationFrame(frame);
      if (!document.hidden && !reducedMotion) frame = window.requestAnimationFrame(render);
    };

    resize();
    render(0);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [drawFrame]);

  return canvasRef;
}

export function LinesWaveCanvas() {
  const canvasRef = useAnimatedCanvas((context, width, height, seconds) => {
    const lineCount = Math.max(34, Math.min(58, Math.round(width / 8)));
    const centerX = width * 0.5;
    // Keep the ribbon broad on phones instead of deriving its width from the
    // short viewport side and collapsing it into a narrow central strand.
    const amplitude = Math.max(width * 0.76, Math.min(height * 0.32, 420));

    context.lineWidth = Math.max(0.65, height / 1500);
    for (let line = 0; line < lineCount; line += 1) {
      const offset = (line / Math.max(1, lineCount - 1) - 0.5) * amplitude * 1.72;
      context.beginPath();
      for (let y = -8; y <= height + 8; y += 5) {
        const normalizedY = y / height;
        const envelope = Math.sin(normalizedY * Math.PI);
        const primary = Math.sin(normalizedY * Math.PI * 2.05 + seconds * 0.24 + line * 0.035);
        const secondary = Math.sin(normalizedY * Math.PI * 4.2 - seconds * 0.11 + line * 0.085);
        const x = centerX + offset * (0.22 + 0.78 * Math.abs(primary)) + secondary * amplitude * 0.105 * envelope;
        if (y === -8) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `rgba(8,8,8,${0.026 + (line % 6) * 0.004})`;
      context.stroke();
    }
  });

  return createElement('canvas', {
    'aria-hidden': true,
    ref: canvasRef,
    style: { height: '100%', inset: 0, pointerEvents: 'none', position: 'absolute', width: '100%' },
  });
}

function DotsWaveCanvas() {
  const canvasRef = useAnimatedCanvas((context, width, height, seconds) => {
    const gap = Math.max(12, Math.min(20, width / 42));
    const columns = Math.ceil(width / gap) + 2;
    const rows = Math.ceil(height / gap) + 2;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const scale = Math.max(width, height);

    for (let row = -1; row < rows; row += 1) {
      for (let column = -1; column < columns; column += 1) {
        const baseX = column * gap;
        const baseY = row * gap;
        const nx = (baseX - centerX) / scale;
        const ny = (baseY - centerY) / scale;
        const distance = Math.sqrt(nx * nx + ny * ny);
        const wave = Math.sin(distance * 32 - seconds * 1.15 + nx * 7) * gap * 0.52;
        const sway = Math.sin(ny * 10 + seconds * 0.38) * gap * 0.45;
        const x = baseX + sway + wave * ny;
        const y = baseY + wave * 0.72;
        const light = (Math.sin(distance * 28 - seconds * 1.15) + 1) * 0.5;
        const radius = 0.65 + light * 1.35;
        context.beginPath();
        context.fillStyle = `rgba(8,8,8,${0.045 + light * 0.19})`;
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
  });

  return createElement('canvas', {
    'aria-hidden': true,
    ref: canvasRef,
    style: { height: '100%', inset: 0, pointerEvents: 'none', position: 'absolute', width: '100%' },
  });
}

function AuthPreview() {
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <View style={localStyles.preview}>
      <Image accessibilityLabel="VOLNA" contentFit="contain" source={require('../../assets/volna-auth-logo.png')} style={localStyles.logo} />
      <View style={localStyles.tabs}><View style={localStyles.activeTab}><Text style={localStyles.activeTabText}>Вход</Text></View><Text style={localStyles.tabText}>Регистрация</Text></View>
      <View style={localStyles.input}><AtSign color="#6f7b86" size={20} /><TextInput placeholder="Логин" placeholderTextColor="#8e99a4" style={localStyles.textInput} /></View>
      <View style={localStyles.input}><LockKeyhole color="#6f7b86" size={20} /><TextInput placeholder="Пароль" placeholderTextColor="#8e99a4" secureTextEntry={!passwordVisible} style={localStyles.textInput} /><Pressable accessibilityLabel={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'} hitSlop={8} onPress={() => setPasswordVisible((value) => !value)}><Eye color="#6f7b86" size={20} /></Pressable></View>
      <View style={localStyles.button}><Text style={localStyles.buttonText}>Войти</Text></View>
      <Text style={localStyles.caption}>Тест живого фона · основная авторизация не изменена</Text>
    </View>
  );
}

export default function WaveBackgroundTestScreen({ variant = 'lines' }: { variant?: WaveVariant }) {
  return (
    <View style={localStyles.screen}>
      {Platform.OS === 'web' ? variant === 'lines' ? <LinesWaveCanvas /> : <DotsWaveCanvas /> : null}
      <AuthPreview />
    </View>
  );
}

const localStyles = StyleSheet.create({
  screen: { flex: 1, minHeight: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: '#fff' },
  preview: { width: '100%', maxWidth: 320, gap: 12, zIndex: 1 },
  logo: { width: 150, height: 36, marginBottom: 10, alignSelf: 'center' },
  tabs: { height: 44, padding: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(243,245,247,0.82)' },
  activeTab: { flex: 1, height: 36, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.94)' },
  activeTabText: { color: '#111', fontSize: 14, fontWeight: '500' },
  tabText: { flex: 1, color: '#6f7b86', fontSize: 14, fontWeight: '500', textAlign: 'center' },
  input: { height: 50, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(200,209,218,0.86)', borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.82)' },
  textInput: { flex: 1, height: '100%', color: '#111', fontSize: 16, outlineStyle: 'none' } as never,
  button: { height: 46, marginTop: 4, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050505' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  caption: { marginTop: 6, color: '#6f7b86', fontSize: 12, textAlign: 'center' },
});
