/**
 * Design System 出口。
 *
 * 页面统一从 `../components` 引入，而不是逐个文件写路径：
 * 这样"这个页面用了哪些 DS 组件"一眼可见，也避免了页面绕开 DS
 * 去直接引 theme 里的色值来自造样式。
 */

export { AppText, type AppTextProps, type TextColorToken } from './AppText';
export { Banner, type BannerProps } from './Banner';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card, type CardPadding, type CardProps, type CardVariant } from './Card';
export { Dialog, type DialogProps } from './Dialog';
export { Divider, type DividerProps } from './Divider';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Header, type HeaderProps } from './Header';
export { Icon, type IconColor, type IconName, type IconProps } from './Icon';
export { IconButton, type IconButtonProps, type IconButtonTone, type IconButtonVariant } from './IconButton';
export { PlanCard, type PlanCardProps } from './PlanCard';
export { Screen, type ScreenProps } from './Screen';
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl';
export { SoundPicker, type SoundPickerProps } from './SoundPicker';
export { StateView, type StateViewProps } from './StateView';
export { StepIndicator, type StepIndicatorProps } from './StepIndicator';
export {
  StepCard,
  STEP_DURATION_LADDER,
  STEP_REST_LADDER,
  type StepCardErrors,
  type StepCardProps,
} from './StepCard';
export { SwipeRow, type SwipeRowProps } from './SwipeRow';
export { TextField, type TextFieldProps, type TextFieldVariant } from './TextField';
export { TimeStepper, type TimeStepperProps } from './TimeStepper';
