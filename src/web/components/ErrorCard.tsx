import type { ApiErrorBody } from '../../shared/api';

export function ErrorCard({ error, title }: { error: ApiErrorBody['error']; title: string }) {
  return (
    <div role="alert" className="card error" data-testid="error-card" data-error-code={error.code}>
      <h3>{title}</h3>
      <p>{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul>
          {error.issues.map((issue, index) => (
            <li key={index}>
              <code>{issue.code}</code> at <code>{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      )}
      {error.omitted ? <p>And {error.omitted} more issue(s) not shown.</p> : null}
      {error.rawOutput !== undefined && (
        <details>
          <summary>What the model returned</summary>
          <pre>{error.rawOutput}</pre>
        </details>
      )}
    </div>
  );
}
