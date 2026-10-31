import type { Example } from '../../examples';
import type { AnalyzeResponse, ApplyResponse } from '../../shared/api';
import type { Repair } from '../../shared/types';
import type { Load } from '../load';
import { ErrorCard } from './ErrorCard';

export const repairKey = (repair: Repair): string => `${repair.requirementId}|${repair.passageId}`;

interface PanelProps {
  analysis: AnalyzeResponse;
  example: Example;
  selected: ReadonlySet<string>;
  applied: Load<ApplyResponse>;
  onToggle: (repair: Repair) => void;
  onApply: () => void;
}

/** Nothing is selected by default. A repair is applied only after the user ticks it and clicks Apply. */
export function RepairPanel({ analysis, example, selected, applied, onToggle, onApply }: PanelProps) {
  const count = analysis.repairs.filter((repair) => selected.has(repairKey(repair))).length;

  return (
    <section aria-labelledby="repairs-heading" data-testid="repairs">
      <h2 id="repairs-heading">Proposed repairs</h2>
      <p className="note">
        A repair adds one original source passage to the pack. It never writes new text. Nothing changes until you tick a
        repair and apply it.
      </p>

      {analysis.repairs.length === 0 ? (
        <p className="empty">No repairs proposed.</p>
      ) : (
        <ul className="repairs">
          {analysis.repairs.map((repair) => {
            const passage = example.input.sources.find((candidate) => candidate.id === repair.passageId);
            return (
              <li key={repairKey(repair)}>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={selected.has(repairKey(repair))}
                    onChange={() => onToggle(repair)}
                    disabled={applied.status === 'loading'}
                  />
                  <span>
                    Add <code>{repair.passageId}</code> ({passage?.title}) for <code>{repair.requirementId}</code>
                  </span>
                </label>
                {passage && <blockquote>{passage.text}</blockquote>}
              </li>
            );
          })}
        </ul>
      )}

      {analysis.repairs.length > 0 && (
        <button type="button" className="primary" onClick={onApply} disabled={count === 0 || applied.status === 'loading'}>
          {count === 0 ? 'Apply approved repairs' : `Apply ${count} approved repair${count === 1 ? '' : 's'}`}
        </button>
      )}
      {applied.status === 'error' && <ErrorCard error={applied.error} title="Could not apply the repairs" />}
    </section>
  );
}
