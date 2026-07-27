export const calculatePdfPageScale = (
  availableWidth: number,
  pageWidth: number,
  zoom: number,
) => {
  if (availableWidth <= 0 || pageWidth <= 0) return 1;
  return (availableWidth / pageWidth) * zoom;
};
