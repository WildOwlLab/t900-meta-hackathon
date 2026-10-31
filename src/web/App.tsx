import { useEffect, useMemo, useRef, useState } from 'react';
import { examples } from '../examples';
import type { AnalyzeResponse, ApplyResponse, ConfigResponse, PreviewResponse } from '../shared/api';
import type { ExportSource } from '../shared/export';
import type { AnalysisInput, Mode, Repair } from '../shared/types';
import { api, toApiError } from './api';
import { CustomEditor } from './components/CustomEditor';
import { ErrorCard } from './components/ErrorCard';
import { ExamplePicker, SourceList } from './components/ExampleView';
import { ExportPanel } from './components/ExportPanel';
import { FindingsView } from './components/FindingsView';
import { InputTabs, type InputKind } from './components/InputTabs';
import { ModeBar } from './components/ModeBar';
import { PreviewCard } from './components/PreviewCard';
import { RepairPanel, repairKey } from './components/RepairPanel';
import { RevisedPack } from './components/RevisedPack';
import { checkDraft, emptyDraft, inputKey, type Draft } from './draft';
import type { Load } from './load';

const idle = { status: 'idle' } as const;
/** Wait for typing to pause before asking the server for a fresh preview. */
const PREVIEW_DEBOUNCE_MS = 350;

export default function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [mode, setMode] = useState<Mode>('fixture');
  const [kind, setKind] = useState<InputKind>('examples');
  const [slug, setSlug] = useState(examples[0]!.slug);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [preview, setPreview] = useState<Load<PreviewResponse>>(idle);
  const [analysis, setAnalysis] = useState<Load<AnalyzeResponse>>(idle);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [applied, setApplied] = useState<Load<ApplyResponse>>(idle);

  // Only the newest request may update the screen. A late answer for a previous input or
  // mode is dropped, so results can never appear under the wrong preview.
  const latest = useRef(0);

  const example = examples.find((candidate) => candidate.slug === slug) ?? examples[0]!;
  const check = useMemo(() => checkDraft(draft), [draft]);

  // The request being previewed and analysed: a built-in example, or the custom draft once it is valid.
  const input: AnalysisInput | null = kind === 'examples' ? example.input : check.ok ? check.input : null;
  const key = input ? inputKey(input) : null;
  const builtIn = key ? examples.find((candidate) => inputKey(candidate.input) === key) : undefined;

  // Fixture mode only has hand-written answers for the built-in examples. Say so up front.
  const blockedReason =
    mode === 'fixture' && kind === 'custom' && input && !builtIn
      ? 'Fixture mode has hand-written outputs only for the built-in examples, so your own text cannot be analysed here. Switch to Live mode to analyze it. The preview above shows exactly what live mode would send.'
      : null;

  const source: ExportSource = builtIn
    ? { kind: 'example', slug: builtIn.slug, title: builtIn.title }
    : { kind: 'custom' };

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  // Any change of mode or input discards the old preview, results and selections, then asks for a fresh preview.
  useEffect(() => {
    const id = ++latest.current;
    setAnalysis(idle);
    setApplied(idle);
    setSelected(new Set());
    if (!input) {
      setPreview(idle);
      return;
    }
    setPreview({ status: 'loading' });
    const timer = setTimeout(
      () => {
        api
          .preview(mode, input)
          .then((value) => {
            if (latest.current === id) setPreview({ status: 'ready', value });
          })
          .catch((error: unknown) => {
            if (latest.current === id) setPreview({ status: 'error', error: toApiError(error) });
          });
      },
      kind === 'custom' ? PREVIEW_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
    // `key` stands for the content of `input`.
  }, [mode, key, kind]);

  async function approveAndAnalyze() {
    if (preview.status !== 'ready' || !input || blockedReason || analysis.status === 'loading') return;
    const id = ++latest.current;
    setAnalysis({ status: 'loading' });
    setApplied(idle);
    setSelected(new Set());
    try {
      const value = await api.analyze(mode, input, preview.value.hash);
      if (latest.current === id) setAnalysis({ status: 'ready', value });
    } catch (error) {
      if (latest.current === id) setAnalysis({ status: 'error', error: toApiError(error) });
    }
  }

  function toggleRepair(repair: Repair) {
    const repairId = repairKey(repair);
    setApplied(idle);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(repairId)) next.delete(repairId);
      else next.add(repairId);
      return next;
    });
  }

  async function applyRepairs() {
    if (analysis.status !== 'ready' || !input || applied.status === 'loading') return;
    const approvedRepairs = analysis.value.repairs.filter((repair) => selected.has(repairKey(repair)));
    if (approvedRepairs.length === 0) return;
    const id = ++latest.current;
    setApplied({ status: 'loading' });
    try {
      const value = await api.apply(input, analysis.value.output, approvedRepairs);
      if (latest.current === id) setApplied({ status: 'ready', value });
    } catch (error) {
      if (latest.current === id) setApplied({ status: 'error', error: toApiError(error) });
    }
  }

  return (
    <main>
      <header>
        <h1>T900 Evidence Check</h1>
        <p>
          Checks whether a context pack holds the evidence a task needs. Review exactly what would be sent, approve it,
          then read the findings and choose which repairs to apply.
        </p>
      </header>

      <ModeBar config={config} mode={mode} onMode={setMode} />

      <section aria-labelledby="input-heading">
        <h2 id="input-heading">Input</h2>
        <InputTabs kind={kind} onKind={setKind} />
      </section>

      {kind === 'examples' ? (
        <div id="panel-examples" role="tabpanel" aria-labelledby="tab-examples">
          <ExamplePicker slug={slug} onSelect={setSlug} />
          <SourceList example={example} />
        </div>
      ) : (
        <CustomEditor draft={draft} check={check} onChange={setDraft} />
      )}

      {input ? (
        <PreviewCard preview={preview} busy={analysis.status === 'loading'} blockedReason={blockedReason} onApprove={approveAndAnalyze} />
      ) : (
        <p className="note" data-testid="preview-waiting">
          The outbound text preview appears once the input is valid.
        </p>
      )}

      {analysis.status === 'error' && <ErrorCard error={analysis.error} title="Analysis failed" />}
      {analysis.status === 'ready' && input && (
        <>
          <FindingsView analysis={analysis.value} input={input} />
          <RepairPanel
            analysis={analysis.value}
            input={input}
            selected={selected}
            applied={applied}
            onToggle={toggleRepair}
            onApply={applyRepairs}
          />
        </>
      )}
      {applied.status === 'ready' && input && <RevisedPack applied={applied.value} input={input} />}
      {analysis.status === 'ready' && input && (
        <ExportPanel
          input={input}
          analysis={analysis.value}
          applied={applied.status === 'ready' ? applied.value : null}
          source={source}
        />
      )}
    </main>
  );
}
