import type { CSSProperties } from 'react';

export interface ResizableModalStyleOptions {
  width?: string;
  minWidth?: string;
  minHeight?: string;
}

export const createResizableModalStyle = ({
  width = 'min(1120px, calc(100vw - 2rem))',
  minWidth = 'min(720px, calc(100vw - 2rem))',
  minHeight = '420px',
}: ResizableModalStyleOptions = {}): CSSProperties => ({
  width,
  minWidth,
  minHeight,
  maxWidth: 'calc(100vw - 2rem)',
  maxHeight: 'calc(100vh - 2rem)',
  resize: 'both',
  overflow: 'hidden',
});

export const createPlannerTaskModalStyle = () =>
  createResizableModalStyle({
    width: 'min(1100px, calc(100vw - 2rem))',
    minWidth: 'min(760px, calc(100vw - 2rem))',
    minHeight: '520px',
  });
