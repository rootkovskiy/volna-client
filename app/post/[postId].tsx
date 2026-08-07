import { useLocalSearchParams } from 'expo-router';
import MobileApp from '../../apps/mobile/App';

export default function PostRoute() {
  const { postId } = useLocalSearchParams<{ postId?: string | string[] }>();
  const value = Array.isArray(postId) ? postId[0] : postId;
  return <MobileApp initialPostId={value} />;
}
