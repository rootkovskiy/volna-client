import { Disc3, KeyRound, LogOut, MessageSquare, Settings, ShieldCheck, Star, UserRound, UsersRound, X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppImage as Image } from './AppImage';
import { getAvatarInitial } from '../domain';
import { styles } from '../styles';
import type { Profile } from '../types';
import { VerifiedName } from './VerifiedBadge';
import { VolnaSwitch } from './VolnaSwitch';

export function SideMenu({
  isOpen,
  adminMode,
  isAdmin,
  onClose,
  onChangeAdminMode,
  onLogout,
  onOpenEdit,
  onOpenProfile,
  onShowMyCommunities,
  onShowMyMusic,
  profile,
  onShowMessages,
  onShowModeration,
  onShowSecurity,
  onShowSubscription,
  onShowSettings,
  showSubscription,
  showModeration,
}: {
  isOpen: boolean;
  adminMode: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onChangeAdminMode: (enabled: boolean) => void;
  onLogout: () => void;
  onOpenEdit: () => void;
  onOpenProfile: () => void;
  onShowMyCommunities: () => void;
  onShowMyMusic: () => void;
  profile: Profile;
  onShowMessages: () => void;
  onShowModeration: () => void;
  onShowSecurity: () => void;
  onShowSubscription: () => void;
  onShowSettings: () => void;
  showModeration: boolean;
  showSubscription: boolean;
}) {
  const openEditProfile = () => {
    onClose();
    onOpenEdit();
  };

  return (
    <View style={styles.sideMenuPanel}>
      <View style={styles.sideMenuHeader}>
        <Text style={styles.sideMenuTitle}>Меню</Text>
        <Pressable onPress={onClose} style={styles.sideMenuClose}>
          <X color="#111" size={24} strokeWidth={2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.sideMenuScrollContent} showsVerticalScrollIndicator={false} style={styles.sideMenuScroll}>
      <Pressable onPress={onOpenProfile} style={styles.sideMenuProfileCard}>
        {profile.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.sideMenuProfileAvatar} resizeMode="cover" />
        ) : (
          <View style={styles.sideMenuProfileAvatar}>
            <Text style={styles.sideMenuProfileAvatarText}>{getAvatarInitial(profile.name)}</Text>
          </View>
        )}
        <View style={styles.sideMenuProfileCopy}>
          <VerifiedName isVerified={profile.isVerified} name={profile.name} style={styles.sideMenuProfileName} />
          <Text numberOfLines={1} style={styles.sideMenuProfileUsername}>@{profile.username}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onShowMessages} style={styles.sideMenuItem}>
        <MessageSquare color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Сообщения</Text>
      </Pressable>
      <Pressable onPress={onShowMyMusic} style={styles.sideMenuItem}>
        <Disc3 color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Мои треки</Text>
      </Pressable>
      <Pressable onPress={onShowMyCommunities} style={styles.sideMenuItem}>
        <UsersRound color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Мои сообщества</Text>
      </Pressable>
      <Pressable onPress={openEditProfile} style={styles.sideMenuItem}>
        <UserRound color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Редактировать профиль</Text>
      </Pressable>
      <Pressable onPress={onShowSettings} style={styles.sideMenuItem}>
        <Settings color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Настройки и приватность</Text>
      </Pressable>
      {showModeration ? (
        <Pressable onPress={onShowModeration} style={styles.sideMenuItem}>
          <ShieldCheck color="#111" size={22} strokeWidth={2} />
          <Text style={styles.sideMenuText}>Модерация</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onShowSecurity} style={styles.sideMenuItem}>
        <KeyRound color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Пароль и безопасность</Text>
      </Pressable>
      {showSubscription ? (
        <Pressable onPress={onShowSubscription} style={styles.sideMenuItem}>
          <Star color="#111" size={22} strokeWidth={2} />
          <Text style={styles.sideMenuText}>Подписка</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onLogout} style={styles.sideMenuItem}>
        <LogOut color="#111" size={22} strokeWidth={2} />
        <Text style={styles.sideMenuText}>Выйти</Text>
      </Pressable>
      {isAdmin ? (
        <View style={styles.sideMenuAdminModeCard}>
          <View style={styles.sideMenuAdminModeCopy}>
            <ShieldCheck color="#111" size={22} strokeWidth={2} />
            <Text style={styles.sideMenuText}>Режим админа</Text>
          </View>
          <VolnaSwitch accessibilityLabel="Режим администрирования" onValueChange={onChangeAdminMode} surfaceTone="neutral" value={adminMode} />
        </View>
      ) : null}
      </ScrollView>
    </View>
  );
}

