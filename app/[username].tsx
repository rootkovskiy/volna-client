import { useLocalSearchParams } from 'expo-router';
import MobileApp from '../apps/mobile/App';
import type { AppTab, ProfileMode } from '../apps/mobile/src/types';

const ROUTE_TABS: Record<string, AppTab> = {
  feed: 'feed',
  events: 'events',
  community: 'locations',
  connect: 'community',
  music: 'music',
  messages: 'messages',
  profile: 'profile',
};
export default function UsernameRoute() {
  const { username, post, section, edit, create, chat, cabinet } = useLocalSearchParams<{ username?: string | string[]; post?: string | string[]; section?: string | string[]; edit?: string | string[]; create?: string | string[]; chat?: string | string[]; cabinet?: string | string[] }>();
  const value = Array.isArray(username) ? username[0] : username;
  const postId = Array.isArray(post) ? post[0] : post;
  const normalizedValue = value?.trim().toLowerCase();
  const initialTab = normalizedValue ? ROUTE_TABS[normalizedValue] : undefined;
  const sectionValue = Array.isArray(section) ? section[0] : section;
  const profileSections: Record<string, ProfileMode> = { edit: 'edit', settings: 'settings', security: 'security', subscription: 'subscription', notifications: 'notifications', moderation: 'moderation', music: 'myMusic', communities: 'myCommunities' };
  const createValue = Array.isArray(create) ? create[0] : create;
  const profileMode = normalizedValue === 'profile' && sectionValue ? profileSections[sectionValue] : normalizedValue === 'events' && createValue === '1' ? 'createEvent' : normalizedValue === 'community' && createValue === '1' ? 'createCommunity' : undefined;
  const isInternalRoute = Boolean(initialTab || profileMode);
  return <MobileApp initialChatUsername={normalizedValue === 'messages' ? (Array.isArray(chat) ? chat[0] : chat) : undefined} initialCommunityCabinetUsername={normalizedValue === 'community' ? (Array.isArray(cabinet) ? cabinet[0] : cabinet) : undefined} initialEditEntity={!isInternalRoute && (Array.isArray(edit) ? edit[0] : edit) === '1'} initialPostId={isInternalRoute ? undefined : postId} initialProfileMode={profileMode} initialTab={initialTab} initialUsername={isInternalRoute ? undefined : value} />;
}
