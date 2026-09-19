import { Heart } from 'lucide-react-native';

export function ConnectLikeIcon({ liked, size }: { liked: boolean; size: number }) {
  return <Heart color={liked ? '#ff3b5c' : '#fff'} fill={liked ? '#ff3b5c' : 'transparent'} size={size} strokeWidth={liked ? 0 : 2} />;
}
