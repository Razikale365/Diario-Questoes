export const stripPdfPageArtifacts = (text: string, pageNumber: number): string => {
  const contentLines = text
    .split('\n')
    .filter((line) => {
      const normalized = line.trim();
      if (normalized === String(pageNumber)) return false;
      if (/^7FONTES(?:\s+CONCURSOS)?$/i.test(normalized)) return false;
      if (/^\d{11}\s*-\s*.+$/.test(normalized)) return false;
      if (/^www\.estrategiaconcursos\.com\.br$/i.test(normalized)) return false;
      if (/^Eduardo Da Rocha$/i.test(normalized)) return false;
      if (/^\d+(?:ª|a)\s+Rodada$/i.test(normalized)) return false;
      if (
        /^Rodadas Avançadas de Simulados\b.*-\s*\d{2}\/\d{2}\/\d{4}$/i.test(
          normalized,
        )
      ) {
        return false;
      }
      if (
        /^SEFAZ-CE\b.*Rodadas Avançadas de Simulados\b.*\(Pós-Edital\)$/i.test(
          normalized,
        )
      ) {
        return false;
      }
      if (/^==[a-f0-9]+==$/i.test(normalized)) return false;
      if (/^Caderno de Prova$/i.test(normalized)) return false;
      if (/^Nome:\s*_+$/i.test(normalized)) return false;
      return true;
    });

  const rawContent = contentLines.join('\n');
  const promotionalTailMatch = rawContent.match(
    /(?:O\s+QUE\s+VOCÊ\s+ACHOU|Conte-nos\s+como|N\s*ÃO\s+É\s+ASSINANTE|C\s*ONHEÇA\s+NOSSO\s+SISTEMA\s+DE\s+QUESTÕES)/iu,
  );
  const content = promotionalTailMatch?.index === undefined
    ? rawContent
    : rawContent.slice(0, promotionalTailMatch.index).trimEnd();
  const finalAlternativeMarkers = Array.from(
    content.matchAll(/(^|[\s:;])(?:\(e\)|e\)|E\.)\s+/giu),
  );
  const finalAlternativeMarker = finalAlternativeMarkers.at(-1);
  if (!finalAlternativeMarker || finalAlternativeMarker.index === undefined) return content;

  const finalAlternativeTail = content.slice(finalAlternativeMarker.index);
  const physicalPageToken = new RegExp(`\\s+${pageNumber}(?=\\s|$)`, 'gu');
  const matches = Array.from(finalAlternativeTail.matchAll(physicalPageToken));
  const footerMatch = matches.at(-1);
  if (!footerMatch || footerMatch.index === undefined) return content;

  return content
    .slice(0, finalAlternativeMarker.index + footerMatch.index)
    .trimEnd();
};
