export type InputKind = 'examples' | 'custom';

interface Props {
  kind: InputKind;
  onKind: (kind: InputKind) => void;
}

const TABS: readonly { kind: InputKind; label: string }[] = [
  { kind: 'examples', label: 'Built-in examples' },
  { kind: 'custom', label: 'Custom input' },
];

export function InputTabs({ kind, onKind }: Props) {
  return (
    <div role="tablist" aria-label="Input source" className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.kind}
          type="button"
          role="tab"
          id={`tab-${tab.kind}`}
          aria-selected={kind === tab.kind}
          aria-controls={`panel-${tab.kind}`}
          className={kind === tab.kind ? 'tab selected' : 'tab'}
          onClick={() => onKind(tab.kind)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
