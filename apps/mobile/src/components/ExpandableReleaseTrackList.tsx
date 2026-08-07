import type { ReactNode } from 'react';
import { AnimatedReleaseTrackList } from './AnimatedReleaseTrackList';
import { CompactPlaylistTrackList } from './CompactPlaylistTrackList';

export function ExpandableReleaseTrackList({
  children,
  expanded,
  itemCount,
}: {
  children: ReactNode;
  expanded: boolean;
  itemCount: number;
}) {
  if (!itemCount) return null;

  return (
    <AnimatedReleaseTrackList expanded={expanded}>
      <CompactPlaylistTrackList itemCount={itemCount}>
        {children}
      </CompactPlaylistTrackList>
    </AnimatedReleaseTrackList>
  );
}
