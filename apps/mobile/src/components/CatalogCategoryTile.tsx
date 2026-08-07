import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppImageBackground as ImageBackground } from './AppImage';
import { apiFetch, apiUrl } from '../api/client';

export type CategoryCoverSurface = 'events' | 'locations';
export type CategoryCover = { surface: CategoryCoverSurface; category: string; imageUrl: string; updatedAt: string };

export const eventCategoryOptions = [
  { value: 'MUSIC', label: 'Музыка' },
  { value: 'CINEMA', label: 'Кино' },
  { value: 'EXHIBITIONS', label: 'Выставки' },
  { value: 'OTHER', label: 'Другое' },
] as const;

export const locationCategoryOptions = [
  { value: 'dance', label: 'Потанцевать' },
  { value: 'food', label: 'Выпить/Поесть' },
  { value: 'clothes', label: 'Приодеться' },
  { value: 'haircut', label: 'Подстричься' },
  { value: 'culture', label: 'Окультуриться' },
  { value: 'tattoo', label: 'Набить тату' },
  { value: 'wander', label: 'Пошляться' },
  { value: 'other', label: 'Другое' },
] as const;

export function useCategoryCovers() {
  const [covers, setCovers] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const response = await apiFetch(`${apiUrl}/category-covers`);
    if (!response.ok) return;
    const payload = await response.json() as { items: CategoryCover[] };
    setCovers(Object.fromEntries(payload.items.map((item) => [`${item.surface}:${item.category}`, item.imageUrl])));
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { covers, reload: load };
}

export function CatalogCategoryTile({
  accessibilityLabel,
  category,
  countLabel,
  coverUrl,
  onPress,
}: {
  accessibilityLabel: string;
  category: string;
  countLabel: string;
  coverUrl?: string | null;
  onPress: () => void;
}) {
  const content = (
    <>
      {coverUrl ? <View pointerEvents="none" style={localStyles.scrim} /> : null}
      <View style={localStyles.copy}>
        <Text style={[localStyles.title, coverUrl && localStyles.textOnImage]}>{category}</Text>
        <Text style={[localStyles.count, coverUrl && localStyles.metaOnImage]}>{countLabel}</Text>
      </View>
    </>
  );
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" onPress={onPress} style={localStyles.tile}>
      {coverUrl ? <ImageBackground imageStyle={localStyles.image} resizeMode="cover" source={{ uri: coverUrl }} style={localStyles.imageBackground}>{content}</ImageBackground> : content}
    </Pressable>
  );
}

const localStyles = StyleSheet.create({
  tile: { width: '48%', flexGrow: 1, aspectRatio: 3 / 4, borderRadius: 8, overflow: 'hidden', backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' },
  imageBackground: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { borderRadius: 8 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.34)' },
  copy: { padding: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#111', fontSize: 18, lineHeight: 23, fontWeight: '600', textAlign: 'center' },
  count: { marginTop: 5, color: '#6f7b86', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  textOnImage: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  metaOnImage: { color: 'rgba(255,255,255,0.88)', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
