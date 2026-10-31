import { useRef, type KeyboardEvent } from 'react';

export type InputKind = 'examples' | 'custom';

interface Props {
  kind: InputKind;
  onKind: (kind: InputKind) => void;
}

const TABS: readonly { kind: InputKind; label: string }[] = [
  { kind: 'examples', label: 'Built-in examples' },
  { kind: 'custom', label: 'Custom input' },
];

/** A tab list that follows the standard keyboard pattern: arrows, Home and End move between tabs. */
export function InputTabs({ kind, onKind }: Props) {
  const buttons = useRef<Partial<Record<InputKind, HTMLButtonElement | null>>>({});

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order = TABS.map((tab) => tab.kind);
    const at = order.indexOf(kind);
    const target =
      event.key === 'ArrowRight' ? order[(at + 1) % order.length]
      : event.key === 'ArrowLeft' ? order[(at - 1 + order.length) % order.length]
      : event.key === 'Home' ? order[0]
      : event.key === 'End' ? order[order.length - 1]
      : undefined;
    if (!target) return;
    event.preventDefault();
    onKind(target);
    buttons.current[target]?.focus();
  }

  return (
    <div role="tablist" aria-label="Input source" className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.kind}
          ref={(element) => {
            buttons.current[tab.kind] = element;
          }}
          type="button"
          role="tab"
          id={`tab-${tab.kind}`}
          aria-selected={kind === tab.kind}
          aria-controls={`panel-${tab.kind}`}
          tabIndex={kind === tab.kind ? 0 : -1}
          className={kind === tab.kind ? 'tab selected' : 'tab'}
          onClick={() => onKind(tab.kind)}
          onKeyDown={onKeyDown}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
