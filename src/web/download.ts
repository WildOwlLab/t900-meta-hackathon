/** How long a download link stays valid. Revoking it at once can cancel the download in Firefox and Safari. */
export const REVOKE_AFTER_MS = 60_000;

/** Save text as a file from the browser. Nothing is uploaded. */
export function downloadText(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  // Some browsers only start the download if the link is in the page when it is clicked.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
