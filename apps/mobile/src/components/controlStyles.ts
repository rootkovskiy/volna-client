import { Platform, type ViewStyle } from 'react-native';

export const whiteControlShadow: ViewStyle = Platform.OS === 'web'
  ? ({ boxShadow: 'rgba(17, 17, 17, 0.1) 0px 2px 5px' } as ViewStyle)
  : {
      shadowColor: '#111',
      shadowOpacity: 0.1,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    };
