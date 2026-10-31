import { useEffect, useRef, useState } from 'react';
import { examples } from '../examples';
import type { AnalyzeResponse, ApplyResponse, ConfigResponse, PreviewResponse } from '../shared/api';
import type { Mode, Repair } from '../shared/types';
import { api, toApiError } from './api';
import { ErrorCard } from './components/ErrorCard';
import { ExamplePicker, SourceList } from './components/ExampleView';
import { FindingsView } from './components/FindingsView';
import { ModeBar } from './components/ModeBar';
import { PreviewCard } from './components/PreviewCard';
import { RepairPanel, repairKey } from './components/RepairPanel';
import { RevisedPack } from './components/RevisedPack';
import type { Load } from './load';

const idle = { status: 'idle' } as const;

export default function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [mode, setMode] = useState<Mode>('fixture');
  const [slug, setSlug] = useState(examples[0]!.slug);
  const [preview, setPreview] = useState<Load<PreviewResponse>>(idle);
  const [analysis, setAnalysis] = useState<Load<AnalyzeResponse>>(idle);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [applied, setApplied] = useState<Load<ApplyResponse>>(idle);

  // Only the newest request may update the screen. A late answer for a previous example or
  // mode is dropped, so results can never appear under the wrong preview.
  const latest = useRef(0);

  const example = examples.find((candidate) => candidate.slug === slug) ?? examples[0]!;

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  // Any change of mode or example discards the old preview, results and selections, then asks for a fresh preview.
  useEffect(() => {
    const id = ++latest.current;
    setAnalysis(idle);
    setApplied(idle);
    setSelected(new Set());
    setPreview({ status: 'loading' });
    api
      .preview(mode, example.input)
      .then((value) => {
        if (latest.current === id) setPreview({ status: 'ready', value });
      })
      .catch((error: unknown) => {
        if (latest.current === id) setPreview({ status: 'error', error: toApiError(error) });
      });
  }, [mode, example]);

  async function approveAndAnalyze() {
    if (preview.status !== 'ready' || analysis.status === 'loading') return;
    const id = ++latest.current;
    setAnalysis({ status: 'loading' });
    setApplied(idle);
    setSelected(new Set());
    try {
      const value = await api.analyze(mode, example.input, preview.value.hash);
      if (latest.current === id) setAnalysis({ status: 'ready', value });
    } catch (error) {
      if (latest.current === id) setAnalysis({ status: 'error', error: toApiError(error) });
    }
  }

  function toggleRepair(repair: Repair) {
    const key = repairKey(repair);
    setApplied(idle);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function applyRepairs() {
    if (analysis.status !== 'ready' || applied.status === 'loading') return;
    const approvedRepairs = analysis.value.repairs.filter((repair) => selected.has(repairKey(repair)));
    if (approvedRepairs.length === 0) return;
    const id = ++latest.current;
    setApplied({ status: 'loading' });
    try {
      const value = await api.apply(example.input, analysis.value.output, approvedRepairs);
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
      <ExamplePicker slug={slug} onSelect={setSlug} />
      <SourceList example={example} />

      <PreviewCard preview={preview} busy={analysis.status === 'loading'} onApprove={approveAndAnalyze} />

      {analysis.status === 'error' && <ErrorCard error={analysis.error} title="Analysis failed" />}
      {analysis.status === 'ready' && (
        <>
          <FindingsView analysis={analysis.value} example={example} />
          <RepairPanel
            analysis={analysis.value}
            example={example}
            selected={selected}
            applied={applied}
            onToggle={toggleRepair}
            onApply={applyRepairs}
          />
        </>
      )}
      {applied.status === 'ready' && <RevisedPack applied={applied.value} example={example} />}
    </main>
  );
}
