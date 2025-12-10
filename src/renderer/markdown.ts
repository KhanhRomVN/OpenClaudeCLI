import { marked } from 'marked';

export interface Citation {
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

export function parseMarkdown(t: string, citations?: Citation[]): string {
  if (!t) return '';

  let text = t;

  // Apply citations if present (before markdown parsing)
  if (citations && citations.length > 0) {
    // Sort citations by start_index descending to avoid index shifting
    const sortedCitations = [...citations].sort((a, b) => (b.start_index || 0) - (a.start_index || 0));
    for (const cit of sortedCitations) {
      if (cit.start_index !== undefined && cit.end_index !== undefined) {
        const before = text.slice(0, cit.start_index);
        const cited = text.slice(cit.start_index, cit.end_index);
        const after = text.slice(cit.end_index);
        const citNumber = citations.indexOf(cit) + 1;
        // Use HTML directly for citations since marked will preserve it
        const escapedUrl = (cit.url || '').replace(/"/g, '&quot;');
        const escapedTitle = (cit.title || '').replace(/"/g, '&quot;');
        text = before + `<a class="citation-link" href="${escapedUrl}" target="_blank" title="${escapedTitle}">${cited}</a><sup class="citation-num">[${citNumber}]</sup>` + after;
      }
    }
  }

  return marked.parse(text) as string;
}
