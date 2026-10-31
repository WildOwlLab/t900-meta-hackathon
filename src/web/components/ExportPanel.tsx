import type { AnalyzeResponse, ApplyResponse } from '../../shared/api';
import {
  REPORT_JSON_FILENAME,
  REPORT_SUMMARY_FILENAME,
  evidenceReportJson,
  evidenceReportSummary,
  packFilename,
  revisedPackMarkdown,
  revisedPackText,
  type ExportContext,
  type ExportSource,
} from '../../shared/export';
import type { AnalysisInput } from '../../shared/types';
import { downloadText } from '../download';

interface Props {
  input: AnalysisInput;
  analysis: AnalyzeResponse;
  applied: ApplyResponse | null;
  source: ExportSource;
}

/** Exports are built in the browser from what is already on screen. Nothing is uploaded. */
export function ExportPanel({ input, analysis, applied, source }: Props) {
  const context = (): ExportContext => ({ input, analysis, applied, source, generatedAt: new Date().toISOString() });
  const packLabel = applied ? 'Revised pack' : 'Pack';

  return (
    <section aria-labelledby="export-heading" data-testid="export">
      <h2 id="export-heading">Export</h2>
      <p className="note">Exports are built in your browser from what is on screen. Nothing is uploaded.</p>

      <h3>{applied ? 'Export Revised Context Pack' : 'Export Context Pack (no repairs applied yet)'}</h3>
      <div className="inline">
        <button
          type="button"
          onClick={() => {
            const ctx = context();
            downloadText(packFilename(ctx, 'md'), 'text/markdown', revisedPackMarkdown(ctx));
          }}
        >
          {packLabel}: Markdown (.md)
        </button>
        <button
          type="button"
          onClick={() => {
            const ctx = context();
            downloadText(packFilename(ctx, 'txt'), 'text/plain', revisedPackText(ctx));
          }}
        >
          {packLabel}: Plain text (.txt)
        </button>
      </div>

      <h3>Export Evidence Report</h3>
      <div className="inline">
        <button type="button" onClick={() => downloadText(REPORT_JSON_FILENAME, 'application/json', evidenceReportJson(context()))}>
          Report: JSON (.json)
        </button>
        <button
          type="button"
          onClick={() => downloadText(REPORT_SUMMARY_FILENAME, 'text/markdown', evidenceReportSummary(context()))}
        >
          Report: Summary (.md)
        </button>
      </div>
    </section>
  );
}
