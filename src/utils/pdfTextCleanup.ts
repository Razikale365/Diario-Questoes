export const stripPdfPageArtifacts = (text: string, pageNumber: number): string => {
  return text
    .split('\n')
    .filter((line) => {
      const normalized = line.trim();
      if (normalized === String(pageNumber)) return false;
      if (/^7FONTES(?:\s+CONCURSOS)?$/i.test(normalized)) return false;
      return true;
    })
    .join('\n');
};
