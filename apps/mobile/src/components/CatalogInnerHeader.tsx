import type { ReactNode } from 'react';
import { ScreenTopBar } from './ScreenTopBar';
export function CatalogInnerHeader({ backLabel, onBack, title, subtitle, trailingAction }: {
  backLabel: string; onBack: () => void; title: string; subtitle?: string; trailingAction?: ReactNode;
}) {
  return <ScreenTopBar centered backLabel={backLabel} onBack={onBack} title={title} subtitle={subtitle} trailingAction={trailingAction} />;
}
