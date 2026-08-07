import {
  Image as ExpoImage,
  ImageBackground as ExpoImageBackground,
  type ImageBackgroundProps,
  type ImageProps,
  type ImageSource,
} from 'expo-image';
import { forwardRef } from 'react';
import {
  Animated,
  Image as ReactNativeImage,
  Platform,
  type ImageURISource,
} from 'react-native';

type CachePolicy = NonNullable<ImageProps['cachePolicy']>;
type AppImageSource = ImageProps['source'];

const privateHeaderNames = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
]);

function sourceItems(source: AppImageSource): Array<ImageSource | string | number> {
  if (source == null) return [];
  return Array.isArray(source) ? source as Array<ImageSource | string | number> : [source as ImageSource | string | number];
}

function sourceUri(source: ImageSource | string | number) {
  if (typeof source === 'string') return source;
  if (typeof source === 'number') return null;
  return source.uri ?? null;
}

function sourceHasPrivateHeaders(source: ImageSource | string | number) {
  if (typeof source !== 'object' || !source.headers) return false;
  return Object.keys(source.headers).some((name) => privateHeaderNames.has(name.toLowerCase()));
}

/**
 * Public network images use Expo's bounded platform-managed memory + disk cache.
 * Private/authenticated and device-local images never persist through this layer.
 */
export function resolveAppImageCachePolicy(
  source: AppImageSource,
  requestedPolicy?: ImageProps['cachePolicy'],
): CachePolicy {
  if (requestedPolicy === 'none') return 'none';

  const items = sourceItems(source);
  if (items.some(sourceHasPrivateHeaders)) {
    return Platform.OS === 'web' ? 'none' : 'memory';
  }

  const isLocal = items.some((item) => {
    const uri = sourceUri(item);
    if (uri == null) return true;
    return !/^https?:\/\//i.test(uri);
  });

  if (isLocal) return 'memory';
  return requestedPolicy ?? 'memory-disk';
}

const AppImageBase = forwardRef<ExpoImage, ImageProps>(function AppImage(
  { cachePolicy, source, ...props },
  ref,
) {
  return (
    <ExpoImage
      {...props}
      cachePolicy={resolveAppImageCachePolicy(source, cachePolicy)}
      ref={ref}
      source={source}
    />
  );
});

type AppImageComponent = typeof AppImageBase & {
  getSize: typeof ReactNativeImage.getSize;
  prefetch: typeof ExpoImage.prefetch;
  resolveAssetSource: (source: number | ImageURISource) => ImageURISource;
};

export const AppImage = Object.assign(AppImageBase, {
  getSize: ReactNativeImage.getSize,
  prefetch: ExpoImage.prefetch,
  resolveAssetSource: ReactNativeImage.resolveAssetSource,
}) as AppImageComponent;

export const AppAnimatedImage = Animated.createAnimatedComponent(AppImageBase);

export function AppImageBackground({
  cachePolicy,
  source,
  ...props
}: ImageBackgroundProps) {
  return (
    <ExpoImageBackground
      {...props}
      cachePolicy={resolveAppImageCachePolicy(source, cachePolicy)}
      source={source}
    />
  );
}
