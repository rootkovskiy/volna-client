import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CatalogBackArea } from '../components/CatalogBackArea';
import { CatalogInnerHeader } from '../components/CatalogInnerHeader';
import { MusicCategoryTile, musicCategoryStyles } from '../components/MusicCategoryTile';
import { PlaylistGrid } from '../components/PlaylistGrid';
import { styles } from '../styles';
import { covers } from './demo-shared';

// A fictional navigation stack, without App routing, account state or audio.
export function CatalogBackDemo() {
  const [route, setRoute] = useState<'playlists' | 'playlist' | null>('playlists');
  const onBack = () => setRoute(current => current === 'playlist' ? 'playlists' : null);
  return <View style={{ height: 350 }}>
    <CatalogBackArea routeKey={route} onBack={onBack}>
      {route ? <CatalogInnerHeader
        title={route === 'playlist' ? 'Ночной город' : 'Мои плейлисты'}
        subtitle={route === 'playlist' ? '0 тр.' : undefined}
        backLabel={route === 'playlist' ? 'Назад к плейлистам — пример' : 'Назад к категориям — пример'}
        onBack={onBack}
      /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        {route === null ? <View style={musicCategoryStyles.row}><View style={musicCategoryStyles.slot}>
          <MusicCategoryTile label="Мои плейлисты" artworkUrl={covers[0]} onPress={() => setRoute('playlists')} />
        </View><View style={musicCategoryStyles.slot} /><View style={musicCategoryStyles.slot} /></View>
          : route === 'playlists' ? <PlaylistGrid
            playlists={Array.from({ length: 9 }, (_, index) => ({ id: `example-${index}`, name: index === 0 ? 'Ночной город' : `Плейлист ${index + 1}`, artworkUrl: covers[index % covers.length] }))}
            onOpen={() => setRoute('playlist')}
          /> : <Text style={styles.emptyProfileTabText}>В плейлисте пока нет треков</Text>}
      </ScrollView>
    </CatalogBackArea>
  </View>;
}
