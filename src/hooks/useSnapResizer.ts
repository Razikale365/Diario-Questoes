import { useState, useCallback, useRef } from 'react';

interface UseSnapResizerProps {
  initialColSpan: number;
  initialRowSpan?: number;
  gridColumns?: number;
  snapPoints?: number[];
  rowHeight?: number;
  onResizeEnd: (dimensions: { width?: number; rowSpan?: number }) => void;
}

export const useSnapResizer = ({
  initialColSpan,
  initialRowSpan = 1,
  gridColumns = 12,
  snapPoints = [3, 6, 9, 12],
  rowHeight = 20, // Small units for fine-grained vertical control
  onResizeEnd
}: UseSnapResizerProps) => {
  const [isResizing, setIsResizing] = useState(false);
  const [currentColSpan, setCurrentColSpan] = useState(initialColSpan);
  const [currentRowSpan, setCurrentRowSpan] = useState(initialRowSpan);
  
  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
  const startColSpanRef = useRef<number>(initialColSpan);
  const startRowSpanRef = useRef<number>(initialRowSpan);
  const containerWidthRef = useRef<number>(0);

  const onMouseDown = useCallback((e: React.MouseEvent, containerElement: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    startXRef.current = e.pageX;
    startYRef.current = e.pageY;
    startColSpanRef.current = initialColSpan;
    startRowSpanRef.current = initialRowSpan;
    containerWidthRef.current = containerElement.parentElement?.clientWidth || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Horizontal Logic (Snap to columns)
      const deltaX = moveEvent.pageX - startXRef.current;
      const colWidth = containerWidthRef.current / gridColumns;
      const deltaCols = Math.round(deltaX / colWidth);
      let newCols = startColSpanRef.current + deltaCols;
      newCols = Math.max(snapPoints[0], Math.min(gridColumns, newCols));
      const nearestSnap = snapPoints.reduce((prev, curr) => 
        Math.abs(curr - newCols) < Math.abs(prev - newCols) ? curr : prev
      );

      // Vertical Logic (Snap to rows)
      const deltaY = moveEvent.pageY - startYRef.current;
      const deltaRows = Math.round(deltaY / rowHeight);
      let newRows = Math.max(1, startRowSpanRef.current + deltaRows);

      setCurrentColSpan(nearestSnap);
      setCurrentRowSpan(newRows);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      onResizeEnd({ width: currentColSpan, rowSpan: currentRowSpan });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [initialColSpan, initialRowSpan, gridColumns, snapPoints, rowHeight, currentColSpan, currentRowSpan, onResizeEnd]);

  return {
    isResizing,
    currentColSpan,
    currentRowSpan,
    onMouseDown
  };
};
