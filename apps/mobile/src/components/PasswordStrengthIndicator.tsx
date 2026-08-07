import { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { getPasswordStrength } from '../domain';
import { styles } from '../styles';

const strengthLabels = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' } as const;
const strengthLevels = { low: 1, medium: 2, high: 3 } as const;

export function PasswordStrengthIndicator({ password }: { password: string }) {
  const strength = getPasswordStrength(password);
  const level = password ? strengthLevels[strength] : 0;
  const label = password ? `Надёжность: ${strengthLabels[strength]}` : 'Начните вводить пароль';
  const previousLevel = useRef(0);
  const barProgress = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  const fillColor = strength === 'low' ? '#d93025' : strength === 'medium' ? '#e2a400' : '#2fa84f';

  useEffect(() => {
    const oldLevel = previousLevel.current;
    previousLevel.current = level;
    barProgress.forEach((progress) => progress.stopAnimation());

    const changedIndexes = level > oldLevel
      ? Array.from({ length: level - oldLevel }, (_, index) => oldLevel + index)
      : Array.from({ length: oldLevel - level }, (_, index) => oldLevel - index - 1);

    const animation = Animated.sequence(changedIndexes.map((index) => Animated.timing(barProgress[index], {
      toValue: index < level ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    })));
    animation.start();
    return () => animation.stop();
  }, [barProgress, level]);

  return (
    <View accessibilityLabel={password ? `Надёжность пароля: ${strengthLabels[strength]}` : 'Начните вводить пароль'} accessibilityRole="text" style={styles.passwordStrengthWrap}>
      <View style={styles.passwordStrengthBars}>
        {barProgress.map((progress, index) => <View key={index} style={styles.passwordStrengthBar}><Animated.View style={[styles.passwordStrengthBarFill, { backgroundColor: fillColor, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /></View>)}
      </View>
      <Text style={[styles.passwordStrengthLabel, password && styles[`passwordStrengthLabel${strength === 'low' ? 'Low' : strength === 'medium' ? 'Medium' : 'High'}`]]}>{label}</Text>
      {password && strength === 'low' ? <Text style={styles.passwordStrengthHint}>Минимум 6 символов, включая латинскую букву и цифру.</Text> : null}
    </View>
  );
}
