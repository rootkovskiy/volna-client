import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Camera, ImageIcon, UserRound } from 'lucide-react-native';
import { AppImage as Image } from './AppImage';

type AvatarEditButtonProps = {
  avatarUrl: string | null;
  entityType: 'account' | 'community';
  onPress: () => void;
};

export function AvatarEditButton({ avatarUrl, entityType, onPress }: AvatarEditButtonProps) {
  const supportsHover = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(hover: hover)').matches);
  const cameraVisibility = useRef(new Animated.Value(supportsHover ? 0 : 1)).current;

  const animateCamera = (visible: boolean) => {
    if (!supportsHover) return;
    Animated.timing(cameraVisibility, {
      duration: visible ? 140 : 110,
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
    }).start();
  };

  const PlaceholderIcon = entityType === 'account' ? UserRound : ImageIcon;
  const label = entityType === 'account' ? 'Изменить фото профиля' : 'Изменить фото сообщества';

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onBlur={() => animateCamera(false)}
      onFocus={() => animateCamera(true)}
      onHoverIn={() => animateCamera(true)}
      onHoverOut={() => animateCamera(false)}
      onPress={onPress}
      style={styles.button}
    >
      {avatarUrl ? (
        <Image resizeMode="cover" source={{ uri: avatarUrl }} style={styles.preview} />
      ) : (
        <View style={[styles.preview, styles.placeholder]}>
          <PlaceholderIcon color="#6f7b86" size={34} strokeWidth={1.7} />
        </View>
      )}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.cameraBadge,
          { opacity: cameraVisibility },
        ]}
      >
        <Camera color="#fff" size={23} strokeWidth={2} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    borderColor: 'rgb(226, 231, 236)',
    overflow: 'hidden',
    backgroundColor: '#f3f5f7',
  },
  preview: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#f3f5f7',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  cameraBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.30)',
  },
});
