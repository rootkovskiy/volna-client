import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { AtSign, CalendarDays, Check, ChevronDown, Eye, EyeOff, KeyRound, LockKeyhole, Mail, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AppImage as Image } from '../components/AppImage';
import { apiFetch as fetch, apiUrl, readApiError, reportApiError } from '../api/client';
import { getPasswordStrength, isValidEmailInput, normalizeAsciiPassword, normalizeEmailInput, normalizeUsernameInput, validateDisplayName, validateRequiredText, validateUsername } from '../domain';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';
import { AnimatedSegmentedControl } from '../components/AnimatedSegmentedControl';
import { AppSheetModal } from '../components/AppSheetModal';
import { useWebVisualViewport } from '../hooks/useWebVisualViewport';
import { LinesWaveCanvas } from './WaveBackgroundTestScreen';
import { styles } from '../styles';
import type { Account, Session } from '../types';

const telegramRegistrationDraftKey = 'volna-telegram-registration-draft';

type TelegramRegistrationDraft = {
  username: string;
  name: string;
  birthYear: string;
  inviteCode: string;
  inviteValidationToken: string;
  communityRulesAccepted: boolean;
};

const communityRules = [
  'Не публикуйте, не продавайте и не продвигайте запрещённые вещества, товары, услуги и другой незаконный контент.',
  'Запрещены мошенничество, фишинг, выдача себя за другого человека и любые схемы обмана.',
  'Запрещены угрозы, призывы к насилию, дискриминация и целенаправленные оскорбления.',
  'Не публикуйте чужие персональные данные, личную переписку, фото или видео без согласия участников.',
  'Запрещены сексуальная эксплуатация и любой сексуальный контент с участием несовершеннолетних.',
  'Не рассылайте спам и не размещайте массовую, навязчивую или обманную рекламу.',
];

function readTelegramRegistrationDraft(): TelegramRegistrationDraft | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(telegramRegistrationDraftKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TelegramRegistrationDraft>;
    if (![value.username, value.name, value.birthYear, value.inviteCode, value.inviteValidationToken].every((item) => typeof item === 'string') || typeof value.communityRulesAccepted !== 'boolean') return null;
    return value as TelegramRegistrationDraft;
  } catch {
    return null;
  }
}

export function AuthScreen({
  isLoading,
  onAuthenticated,
}: {
  isLoading: boolean;
  onAuthenticated: (session: Session) => Promise<void>;
}) {
  const restoredRegistrationDraft = useRef(readTelegramRegistrationDraft()).current;
  const [mode, setMode] = useState<'login' | 'register'>(restoredRegistrationDraft ? 'register' : 'login');
  const [username, setUsername] = useState(restoredRegistrationDraft?.username ?? '');
  const [usernameState, setUsernameState] = useState<'invalid' | 'checking' | 'available' | 'taken'>('invalid');
  const [hasUsernameFieldBeenFocused, setHasUsernameFieldBeenFocused] = useState(false);
  const [isUsernameHintExpanded, setIsUsernameHintExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [name, setName] = useState(restoredRegistrationDraft?.name ?? '');
  const [hasNameFieldBeenEdited, setHasNameFieldBeenEdited] = useState(false);
  const [hasNameFieldBeenBlurred, setHasNameFieldBeenBlurred] = useState(false);
  const [birthYear, setBirthYear] = useState(restoredRegistrationDraft?.birthYear ?? '');
  const [inviteCode, setInviteCode] = useState(restoredRegistrationDraft?.inviteCode ?? '');
  const [inviteValidationToken, setInviteValidationToken] = useState(restoredRegistrationDraft?.inviteValidationToken ?? '');
  const [email, setEmail] = useState('');
  const [registrationMethod, setRegistrationMethod] = useState<'TELEGRAM' | 'EMAIL'>('TELEGRAM');
  const [telegramProof, setTelegramProof] = useState('');
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const acceptTelegramProofRef = useRef<(proof: string, purpose: 'login' | 'register') => Promise<void>>(async () => undefined);
  const handledTelegramProofsRef = useRef(new Set<string>());
  const inviteInputRef = useRef<TextInput>(null);
  const authScrollRef = useRef<ScrollView>(null);
  const [isInviteInputFocused, setIsInviteInputFocused] = useState(false);
  const registrationDetailsProgress = useRef(new Animated.Value(1)).current;
  const loginCredentialsProgress = useRef(new Animated.Value(1)).current;
  const authTabProgress = useRef(new Animated.Value(restoredRegistrationDraft ? 1 : 0)).current;
  const primaryActionOpacity = useRef(new Animated.Value(0.7)).current;
  const [authTabsWidth, setAuthTabsWidth] = useState(0);
  const [isUsernameLoginExpanded, setIsUsernameLoginExpanded] = useState(false);
  const [isBirthYearPickerOpen, setIsBirthYearPickerOpen] = useState(false);
  const [hasAcceptedCommunityRules, setHasAcceptedCommunityRules] = useState(restoredRegistrationDraft?.communityRulesAccepted ?? false);
  const [isCommunityRulesOpen, setIsCommunityRulesOpen] = useState(false);
  const [modeErrors, setModeErrors] = useState<Record<'login' | 'register', string | null>>({ login: null, register: null });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegister = mode === 'register';
  const inviteViewport = useWebVisualViewport(isRegister && isInviteInputFocused);
  const error = modeErrors[mode];
  const setError = (nextError: string | null) => {
    setModeErrors((current) => ({ ...current, [mode]: nextError }));
  };
  const currentYear = new Date().getFullYear();
  const birthYearOptions = Array.from({ length: currentYear - 18 - 1940 + 1 }, (_, index) => currentYear - 18 - index);
  const normalizedRegistrationEmail = email.trim().toLowerCase();
  const parsedRegistrationBirthYear = Number(birthYear);
  const isInviteCodeComplete = /^[A-Z0-9]{6}$/.test(inviteCode);
  const registrationNameError = isRegister ? validateDisplayName(name) : null;
  const areRegistrationDetailsComplete = usernameState === 'available'
    && !validateUsername(username)
    && !validateDisplayName(name)
    && /^\d{4}$/.test(birthYear)
    && parsedRegistrationBirthYear >= 1940
    && parsedRegistrationBirthYear <= currentYear - 18
    && (registrationMethod === 'TELEGRAM'
      || isValidEmailInput(normalizedRegistrationEmail) && getPasswordStrength(password) !== 'low' && password === passwordConfirmation);
  const isPrimaryActionDisabled = isSubmitting
    || isTelegramLoading
    || isLoading
    || (isRegister && !inviteValidationToken && !isInviteCodeComplete)
    || (isRegister && Boolean(inviteValidationToken) && (!areRegistrationDetailsComplete || !hasAcceptedCommunityRules));

  useEffect(() => {
    if (!isRegister || !isInviteInputFocused) return;
    if (Platform.OS === 'web' && !inviteViewport.keyboardVisible) return;
    const timer = setTimeout(() => authScrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [inviteViewport.keyboardVisible, isInviteInputFocused, isRegister]);

  const expandUsernameLogin = () => {
    loginCredentialsProgress.setValue(0);
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsUsernameLoginExpanded(true);
    requestAnimationFrame(() => Animated.timing(loginCredentialsProgress, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start());
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.classList.add('volna-auth-document');
    return () => document.documentElement.classList.remove('volna-auth-document');
  }, []);

  useEffect(() => {
    Animated.timing(authTabProgress, {
      toValue: isRegister ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [authTabProgress, isRegister]);

  useEffect(() => {
    Animated.timing(primaryActionOpacity, {
      toValue: isPrimaryActionDisabled ? 0.7 : 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isPrimaryActionDisabled, primaryActionOpacity]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const consumeStoredTelegramProof = () => {
      try {
        const stored = window.localStorage.getItem('volna-telegram-auth');
        if (!stored) return;
        const payload = JSON.parse(stored) as { proof?: unknown; purpose?: unknown };
        window.localStorage.removeItem('volna-telegram-auth');
        if (typeof payload.proof !== 'string') return;
        void acceptTelegramProofRef.current(payload.proof, payload.purpose === 'register' ? 'register' : 'login');
      } catch {
        try { window.localStorage.removeItem('volna-telegram-auth'); } catch { /* Storage can be unavailable in restricted browser contexts. */ }
      }
    };
    const params = new URLSearchParams(window.location.search);
    const callbackProof = params.get('telegram_auth');
    const callbackPurpose = params.get('telegram_purpose');
    if (callbackProof && window.opener) {
      window.opener.postMessage({ type: 'volna-telegram-auth', proof: callbackProof, purpose: callbackPurpose }, window.location.origin);
      window.close();
      return;
    }
    if (callbackProof) {
      window.history.replaceState({}, '', window.location.pathname);
      void acceptTelegramProofRef.current(callbackProof, callbackPurpose === 'register' ? 'register' : 'login');
    }
    const receiveTelegram = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'volna-telegram-auth' || typeof event.data.proof !== 'string') return;
      void acceptTelegramProofRef.current(event.data.proof, event.data.purpose === 'register' ? 'register' : 'login');
    };
    const receiveTelegramStorage = (event: StorageEvent) => {
      if (event.key !== 'volna-telegram-auth' || !event.newValue) return;
      consumeStoredTelegramProof();
    };
    const receiveTelegramFocus = () => consumeStoredTelegramProof();
    window.addEventListener('message', receiveTelegram);
    window.addEventListener('storage', receiveTelegramStorage);
    window.addEventListener('focus', receiveTelegramFocus);
    consumeStoredTelegramProof();
    return () => {
      window.removeEventListener('message', receiveTelegram);
      window.removeEventListener('storage', receiveTelegramStorage);
      window.removeEventListener('focus', receiveTelegramFocus);
    };
  }, []);

  const acceptTelegramProof = async (proof: string, purpose: 'login' | 'register') => {
    if (handledTelegramProofsRef.current.has(proof)) return;
    handledTelegramProofsRef.current.add(proof);
    setIsTelegramLoading(true);
    setError(null);
    try {
      if (purpose === 'login') {
        const response = await fetch(`${apiUrl}/auth/oauth/telegram`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proof }) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось войти через Telegram'));
        const result = await response.json() as { token?: string; account: Account };
        await onAuthenticated({ token: result.token ?? '', account: result.account });
        return;
      }
      const response = await fetch(`${apiUrl}/auth/oauth/telegram/status?proof=${encodeURIComponent(proof)}`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось подтвердить Telegram'));
      await response.json();
      setTelegramProof(proof);
      await submit(proof);
    } catch (reason) {
      handledTelegramProofsRef.current.delete(proof);
      setTelegramProof('');
      reportApiError(reason instanceof Error ? reason.message : 'Не удалось подтвердить Telegram');
    } finally {
      setIsTelegramLoading(false);
    }
  };
  acceptTelegramProofRef.current = acceptTelegramProof;

  const startTelegramAuth = async () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      reportApiError('Telegram-вход для приложения подключим перед выпуском в App Store и Google Play');
      return;
    }
    setIsTelegramLoading(true);
    setError(null);
    try {
      const purpose = isRegister ? 'register' : 'login';
      if (purpose === 'register') {
        window.sessionStorage.setItem(telegramRegistrationDraftKey, JSON.stringify({ username, name, birthYear, inviteCode, inviteValidationToken, communityRulesAccepted: hasAcceptedCommunityRules } satisfies TelegramRegistrationDraft));
      }
      const response = await fetch(`${apiUrl}/auth/oauth/telegram/start?purpose=${purpose}`);
      if (!response.ok) throw new Error(await readApiError(response, 'Вход через Telegram пока недоступен'));
      const result = await response.json() as { authorizationUrl: string };
      window.location.assign(result.authorizationUrl);
    } catch (reason) {
      reportApiError(reason instanceof Error ? reason.message : 'Не удалось открыть Telegram');
    } finally {
      setIsTelegramLoading(false);
    }
  };

  useEffect(() => {
    if (!isRegister || !inviteValidationToken) return;
    const normalized = username.trim().toLowerCase();
    if (!/^(?=.{3,20}$)(?=.*[a-z])[a-z0-9_]+$/.test(normalized)) { setUsernameState('invalid'); return; }
    setUsernameState('checking');
    const controller = new AbortController();
    const timeout = setTimeout(() => void fetch(`${apiUrl}/auth/username-available?username=${encodeURIComponent(normalized)}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error('lookup failed'); return response.json() as Promise<{ available: boolean }>; })
      .then((result) => setUsernameState(result.available ? 'available' : 'taken'))
      .catch((reason: unknown) => { if (!(reason instanceof Error) || reason.name !== 'AbortError') setUsernameState('invalid'); }), 350);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [inviteValidationToken, isRegister, username]);

  const validateInvite = async () => {
    setError(null);
    if (!/^[A-Z0-9]{6}$/.test(inviteCode)) { setError('Введите шестизначный инвайт'); return; }
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/auth/invite/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode }) });
      if (!response.ok) {
        if (response.status === 429) throw new Error('Слишком много попыток.');
        throw new Error(await readApiError(response, 'Инвайт не существует или уже использован'));
      }
      const result = await response.json() as { validationToken: string };
      registrationDetailsProgress.setValue(0);
      if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setInviteValidationToken(result.validationToken);
      requestAnimationFrame(() => Animated.timing(registrationDetailsProgress, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start());
    } catch (validationError) { setError(validationError instanceof Error ? validationError.message : 'Не удалось проверить инвайт'); }
    finally { setIsSubmitting(false); }
  };

  const submit = async (telegramProofOverride?: string) => {
    setError(null);

    const usernameError = validateUsername(username);
    const minimumPasswordLength = 6;
    const passwordError = isRegister && registrationMethod === 'TELEGRAM' ? null : validateRequiredText(
      password,
      `Пароль должен быть минимум ${minimumPasswordLength} символов`,
      minimumPasswordLength,
    );
    const passwordStrengthError = isRegister && registrationMethod === 'EMAIL' && getPasswordStrength(password) === 'low'
      ? 'Выберите пароль средней или высокой надёжности'
      : null;
    const passwordConfirmationError = isRegister && registrationMethod === 'EMAIL' && password !== passwordConfirmation ? 'Пароли не совпадают' : null;
    const nameError = isRegister ? validateDisplayName(name) : null;
    const parsedBirthYear = Number(birthYear);
    const birthYearError = isRegister && (!/^\d{4}$/.test(birthYear) || parsedBirthYear < 1940)
      ? 'Укажите точный год рождения'
      : isRegister && parsedBirthYear > new Date().getFullYear() - 18
        ? 'VOLNA доступна только пользователям старше 18 лет'
        : null;
    const inviteCodeError = isRegister && !/^[A-Z0-9]{6}$/.test(inviteCode) ? 'Введите шестизначный код регистрации' : null;
    const normalizedEmail = email.trim().toLowerCase();
    const emailError = isRegister && registrationMethod === 'EMAIL' && !isValidEmailInput(normalizedEmail) ? 'Укажите корректную почту' : null;
    const effectiveTelegramProof = telegramProofOverride || telegramProof;
    const telegramError = isRegister && registrationMethod === 'TELEGRAM' && !effectiveTelegramProof ? 'Подтвердите аккаунт Telegram' : null;
    const communityRulesError = isRegister && !hasAcceptedCommunityRules ? 'Подтвердите согласие с правилами сообщества' : null;
    const validationError = usernameError || emailError || telegramError || passwordError || passwordStrengthError || passwordConfirmationError || nameError || birthYearError || inviteCodeError || (isRegister && !inviteValidationToken ? 'Сначала подтвердите инвайт' : null) || communityRulesError;

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl}/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          ...(isRegister ? { name, birthYear: parsedBirthYear, inviteCode, inviteValidationToken, authMethod: registrationMethod, communityRulesAccepted: hasAcceptedCommunityRules, ...(registrationMethod === 'EMAIL' ? { email: normalizedEmail, password } : { telegramProof: effectiveTelegramProof }) } : { password }),
        }),
      });

      if (!response.ok) {
        if ([502, 503, 504].includes(response.status)) {
          throw new Error('Сервер VOLNA временно недоступен. Попробуйте ещё раз через несколько секунд');
        }
        const fallback = isRegister ? 'Не удалось зарегистрироваться' : 'Неверный логин или пароль';
        throw new Error(await readApiError(response, fallback));
      }

      const result = (await response.json()) as { token?: string; account: Account };
      if (isRegister && Platform.OS === 'web' && typeof window !== 'undefined') window.sessionStorage.removeItem(telegramRegistrationDraftKey);
      await onAuthenticated({ token: result.token ?? '', account: result.account });
    } catch (submitError) {
      reportApiError(submitError instanceof Error ? submitError.message : 'Ошибка авторизации');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.authBackground}>
      {Platform.OS === 'web'
        ? <LinesWaveCanvas />
        : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.authShell}
      >
      <ScrollView
        ref={authScrollRef}
        contentContainerStyle={[
          styles.authPanel,
          Platform.OS === 'web' && isInviteInputFocused && inviteViewport.keyboardVisible
            ? { paddingBottom: inviteViewport.bottomInset + 35 }
            : null,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.authScroll}
        testID="volna-auth-scroll"
      >
        <Image accessibilityLabel="VOLNA" resizeMode="contain" source={require('../../assets/volna-auth-logo.png')} style={styles.authLogo} />

        <View onLayout={(event) => setAuthTabsWidth(event.nativeEvent.layout.width)} style={styles.authTabs}>
          {authTabsWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.authTabIndicator, {
            width: (authTabsWidth - 8) / 2,
            transform: [{ translateX: authTabProgress.interpolate({ inputRange: [0, 1], outputRange: [0, (authTabsWidth - 8) / 2] }) }],
          }]} /> : null}
          <Pressable
            onPress={() => {
              if (isRegister) {
                setIsUsernameLoginExpanded(false);
                if (Platform.OS === 'web' && typeof window !== 'undefined') window.sessionStorage.removeItem(telegramRegistrationDraftKey);
              }
              setMode('login');
            }}
            style={styles.authTab}
          >
            <Text style={[styles.authTabText, !isRegister && styles.authTabTextActive]}>Вход</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              primaryActionOpacity.stopAnimation();
              primaryActionOpacity.setValue(isInviteCodeComplete ? 1 : 0.7);
              setMode('register');
            }}
            style={styles.authTab}
          >
            <Text style={[styles.authTabText, isRegister && styles.authTabTextActive]}>Регистрация</Text>
          </Pressable>
        </View>

        {isRegister ? (
            <View style={styles.authInviteCard}>
              <View style={styles.authInviteHeader}><View style={styles.authInviteIconCircle}><KeyRound color="#111" size={23} strokeWidth={1.9} /></View></View>
              <View style={styles.authInviteInputArea}>
                <Pressable accessibilityLabel="Введите шестизначный инвайт-код" accessibilityRole="button" onPress={() => inviteInputRef.current?.focus()} style={styles.authInviteSlots}>
                  {Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.authInviteSlot, inviteCode.length === index && styles.authInviteSlotActive]}><Text style={styles.authInviteCharacter}>{inviteCode[index] || ''}</Text></View>)}
                  <TextInput ref={inviteInputRef} autoCapitalize="characters" autoComplete="one-time-code" autoCorrect={false} caretHidden maxLength={6} onBlur={() => setIsInviteInputFocused(false)} onChangeText={(value) => { setInviteCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setInviteValidationToken(''); setHasAcceptedCommunityRules(false); setError(null); }} onFocus={() => setIsInviteInputFocused(true)} onSubmitEditing={() => { if (isInviteCodeComplete) void validateInvite(); }} returnKeyType="next" style={styles.authInviteHiddenInput} textContentType="oneTimeCode" value={inviteCode} />
                </Pressable>
                {inviteValidationToken ? <Text style={styles.authInviteSuccess}>Инвайт успешно активирован</Text> : null}
              </View>
            </View>
        ) : null}

        {!isRegister ? <><View style={styles.oauthRow}>
          <Pressable disabled={isTelegramLoading || isLoading} onPress={() => void startTelegramAuth()} style={[styles.oauthButton, (isTelegramLoading || isLoading) && styles.disabledButton]}>{isTelegramLoading ? <ActivityIndicator color="#fff" /> : <><FontAwesome6 color="#fff" iconStyle="brand" name="telegram" size={18} /><Text style={styles.oauthText}>Telegram</Text></>}</Pressable>
        </View><View style={styles.authDividerRow}>
          <View style={styles.authDivider} />
          <Text style={styles.authDividerText}>или</Text>
          <View style={styles.authDivider} />
        </View></> : null}

        {!isRegister && !isUsernameLoginExpanded ? (
          <Pressable accessibilityLabel="Войти по username и паролю" accessibilityRole="button" onPress={expandUsernameLogin} style={[styles.primaryAuthButton, styles.primaryAuthButtonLogin, styles.authUsernameLoginButton]}>
            <AtSign color="#111" size={20} strokeWidth={1.9} />
            <Text style={[styles.primaryAuthText, styles.primaryAuthTextLogin]}>username</Text>
          </Pressable>
        ) : null}

        {(isRegister ? Boolean(inviteValidationToken) : isUsernameLoginExpanded) ? <Animated.View style={{ opacity: isRegister ? registrationDetailsProgress : loginCredentialsProgress, transform: [{ translateY: (isRegister ? registrationDetailsProgress : loginCredentialsProgress).interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        {isRegister ? <><View style={styles.authNameInput}><TextInput autoCapitalize="words" autoCorrect={false} maxLength={30} onBlur={() => setHasNameFieldBeenBlurred(true)} onChangeText={(value) => { setName(value); setHasNameFieldBeenEdited(true); }} onFocus={() => setHasNameFieldBeenBlurred(false)} placeholder="Имя" placeholderTextColor="#8e99a4" returnKeyType="next" style={styles.authNameTextInput} value={name} />{hasNameFieldBeenEdited ? <View accessibilityLabel={registrationNameError ? 'Имя заполнено неверно' : 'Имя заполнено верно'} style={styles.authUsernameStatus}>{registrationNameError ? <X color="#c62828" size={19} strokeWidth={2.4} /> : <Check color="#2fa84f" size={20} strokeWidth={2.4} />}</View> : null}</View>{hasNameFieldBeenEdited && hasNameFieldBeenBlurred && registrationNameError ? <Text style={styles.authFieldError}>{registrationNameError}</Text> : null}<View style={styles.authBirthYearGroup}><Pressable accessibilityLabel="Выбрать год рождения" accessibilityRole="button" onPress={() => setIsBirthYearPickerOpen(true)} style={styles.authYearSelect}><CalendarDays color="#6f7b86" size={20} strokeWidth={1.9} /><Text style={[styles.authYearSelectText, !birthYear && styles.authYearSelectPlaceholder]}>{birthYear || 'Год рождения'}</Text><ChevronDown color="#6f7b86" size={19} strokeWidth={2} /></Pressable><Text style={styles.authBirthYearHint}><Text style={styles.authBirthYearHintStrong}>Укажите точный год рождения.</Text>{'\n'}Год рождения не будет отображаться в профиле без вашего явного согласия. VOLNA — приложение 18+.</Text></View></> : null}
        <View style={isRegister ? styles.authUsernameGroup : undefined}>
        <View style={[styles.authIconInput, isRegister && styles.authGroupedInput]}>
          <AtSign color="#6f7b86" size={20} strokeWidth={1.9} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            onChangeText={(value) => setUsername(normalizeUsernameInput(value, 20))}
            onFocus={() => { if (isRegister) setHasUsernameFieldBeenFocused(true); }}
            onSubmitEditing={() => void submit()}
            placeholder="Логин"
            placeholderTextColor="#8e99a4"
            returnKeyType="next"
            style={styles.authIconTextInput}
            value={username}
          />
          {isRegister && hasUsernameFieldBeenFocused ? <View style={styles.authUsernameStatus}>{usernameState === 'checking' ? <ActivityIndicator color="#7d8894" size="small" /> : null}{usernameState === 'available' ? <Check color="#2fa84f" size={20} strokeWidth={2.4} /> : null}{usernameState === 'invalid' || usernameState === 'taken' ? <X color="#c62828" size={19} strokeWidth={2.4} /> : null}</View> : null}
        </View>
        {isRegister ? <View style={styles.authUsernameHint}><Text style={styles.authUsernameHintTitle}>Не используйте чужие username публичных лиц или сообществ!</Text><Pressable accessibilityRole="button" onPress={() => { if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setIsUsernameHintExpanded((expanded) => !expanded); }}><Text style={styles.authUsernameHintLink}>{isUsernameHintExpanded ? 'Скрыть' : 'Подробнее'}</Text></Pressable>{isUsernameHintExpanded ? <Text style={styles.authUsernameHintBody}>Администрация вправе отвязать занятый вами юзернейм, если он в интернете явно ассоциируется с другим человеком или организацией. Если у вас есть сомнения по поводу выбранного юзернейма, обратитесь к администрации приложения для получения галочки, которая будет гарантировать, что юзернейм останется закреплён за вашим профилем.</Text> : null}</View> : null}
        </View>
        {isRegister ? <View style={styles.authMethodGroup}><Text style={styles.authMethodLabel}>Способ входа</Text><AnimatedSegmentedControl onChange={setRegistrationMethod} options={[{ value: 'TELEGRAM', label: 'Telegram' }, { value: 'EMAIL', label: 'Email' }]} value={registrationMethod} containerStyle={styles.authMethodSegment} /></View> : null}
        {isRegister && registrationMethod === 'EMAIL' ? <View style={styles.authIconInput}><Mail color="#6f7b86" size={20} strokeWidth={1.9} /><TextInput autoCapitalize="none" autoComplete="email" autoCorrect={false} keyboardType="email-address" maxLength={254} onChangeText={(value) => setEmail(normalizeEmailInput(value))} placeholder="Почта" placeholderTextColor="#8e99a4" returnKeyType="next" style={styles.authIconTextInput} textContentType="emailAddress" value={email} /></View> : null}
        {(!isRegister || registrationMethod === 'EMAIL') ? <View style={styles.authIconInput}>
          <LockKeyhole color="#6f7b86" size={20} strokeWidth={1.9} />
          <TextInput
            onChangeText={(value) => setPassword(isRegister ? normalizeAsciiPassword(value) : value)}
            onSubmitEditing={() => void submit()}
            placeholder="Пароль"
            placeholderTextColor="#8e99a4"
            returnKeyType="done"
            secureTextEntry={!isPasswordVisible}
            style={styles.authIconTextInput}
            value={password}
          />
          <Pressable accessibilityLabel={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'} accessibilityRole="button" hitSlop={8} onPress={() => setIsPasswordVisible((visible) => !visible)} style={styles.authPasswordVisibility}>{isPasswordVisible ? <EyeOff color="#6f7b86" size={20} strokeWidth={1.9} /> : <Eye color="#6f7b86" size={20} strokeWidth={1.9} />}</Pressable>
        </View> : null}
        {isRegister && registrationMethod === 'EMAIL' ? <View style={styles.authIconInput}><LockKeyhole color="#6f7b86" size={20} strokeWidth={1.9} /><TextInput onChangeText={(value) => setPasswordConfirmation(normalizeAsciiPassword(value))} onSubmitEditing={() => void submit()} placeholder="Повторите пароль" placeholderTextColor="#8e99a4" returnKeyType="done" secureTextEntry={!isPasswordVisible} style={styles.authIconTextInput} value={passwordConfirmation} /><View accessibilityLabel={passwordConfirmation.length > 0 && password === passwordConfirmation ? 'Пароли совпадают' : 'Пароли не совпадают'} style={styles.authPasswordVisibility}>{passwordConfirmation.length > 0 && password === passwordConfirmation ? <Check color="#2fa84f" size={20} strokeWidth={2.4} /> : <X color="#c62828" size={20} strokeWidth={2.4} />}</View></View> : null}
        {isRegister && registrationMethod === 'EMAIL' ? <PasswordStrengthIndicator password={password} /> : null}
        </Animated.View> : null}

        {error ? <Text style={styles.authError}>{error}</Text> : null}

        {isRegister && inviteValidationToken ? <View style={styles.authRulesConsentRow}>
          <Pressable accessibilityLabel="Согласие с правилами сообщества" accessibilityRole="checkbox" accessibilityState={{ checked: hasAcceptedCommunityRules }} hitSlop={8} onPress={() => { setHasAcceptedCommunityRules((accepted) => !accepted); setError(null); }} style={[styles.authRulesCheckbox, hasAcceptedCommunityRules && styles.authRulesCheckboxChecked]}>
            {hasAcceptedCommunityRules ? <Check color="#fff" size={16} strokeWidth={2.6} /> : null}
          </Pressable>
          <Text style={styles.authRulesConsentText}>Я согласен с <Text accessibilityRole="link" onPress={() => setIsCommunityRulesOpen(true)} style={styles.authRulesLink}>правилами сообщества</Text></Text>
        </View> : null}

        {isRegister || isUsernameLoginExpanded ? <Animated.View style={{ opacity: primaryActionOpacity }}>
          <Pressable
            accessibilityState={{ disabled: isPrimaryActionDisabled }}
            disabled={isPrimaryActionDisabled}
            onPress={() => isRegister && !inviteValidationToken ? void validateInvite() : isRegister && registrationMethod === 'TELEGRAM' && !telegramProof ? void startTelegramAuth() : void submit()}
            style={[styles.primaryAuthButton, !isRegister && styles.primaryAuthButtonLogin]}
          >
            {isSubmitting || isLoading ? (
              <ActivityIndicator color={isRegister ? '#fff' : '#111'} />
            ) : (
              <Text style={[styles.primaryAuthText, !isRegister && styles.primaryAuthTextLogin]}>{isRegister ? inviteValidationToken ? 'Зарегистрироваться' : 'Продолжить' : 'Войти'}</Text>
            )}
          </Pressable>
        </Animated.View> : null}
      </ScrollView>
      <AppSheetModal isVisible={isBirthYearPickerOpen} onClose={() => setIsBirthYearPickerOpen(false)} scroll title="Год рождения">
        <View style={styles.authYearOptions}>
          {birthYearOptions.map((year) => (
            <Pressable key={year} onPress={() => { setBirthYear(String(year)); setIsBirthYearPickerOpen(false); }} style={styles.authYearOption}>
              <Text style={[styles.authYearOptionText, birthYear === String(year) && styles.authYearOptionTextActive]}>{year}</Text>
            </Pressable>
          ))}
        </View>
      </AppSheetModal>
      <AppSheetModal
        contentContainerStyle={styles.authRulesModalContent}
        footer={<Pressable accessibilityRole="button" onPress={() => setIsCommunityRulesOpen(false)} style={styles.authRulesCloseButton}><Text style={styles.authRulesCloseText}>Понятно</Text></Pressable>}
        isVisible={isCommunityRulesOpen}
        onClose={() => setIsCommunityRulesOpen(false)}
        scroll
        title="Правила сообщества"
      >
        <Text style={styles.authRulesIntro}>VOLNA — безопасное пространство для людей и творческих сообществ. Используя приложение, соблюдайте законы страны своего пребывания и эти базовые правила:</Text>
        {communityRules.map((rule, index) => <View key={rule} style={styles.authRulesItem}><Text style={styles.authRulesNumber}>{index + 1}</Text><Text style={styles.authRulesText}>{rule}</Text></View>)}
        <Text style={styles.authRulesModeration}>Контент, нарушающий правила, может быть скрыт или удалён, а доступ к аккаунту — ограничен.</Text>
      </AppSheetModal>
      </KeyboardAvoidingView>
    </View>
  );
}

