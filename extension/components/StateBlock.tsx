/**
 * Loading, empty and error states.
 *
 * The error variant exists to make one rule structural: **never leave the reader
 * with nothing.** It always offers whatever is available — the saved report, the
 * official Companies House record, a retry — rather than only stating what went
 * wrong. An error screen with no way forward is where a user decides the extension
 * does not work.
 */

import type { ApiFailureKind } from '../lib/types.js';
import { useT } from '../lib/i18n/index.js';
import { formatDate } from '../lib/format.js';

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div class="stack" aria-busy="true" aria-live="polite">
      <p class="hint">{label ?? t('state.loading')}</p>
      <div class="skeleton" style="width: 70%" />
      <div class="skeleton" style="width: 45%" />
      <div class="skeleton" style="width: 60%" />
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return <p class="hint">{message}</p>;
}

export interface ErrorBlockProps {
  kind: ApiFailureKind;
  message: string;
  retryAfterSeconds?: number;
  fallbackUrl?: string;
  /** Present when an older saved report can be shown instead. */
  savedAt?: string;
  onRetry?: () => void;
  onShowSaved?: () => void;
}

export function ErrorBlock(props: ErrorBlockProps) {
  const { t } = useT();

  // A malformed number cannot be fixed by trying again, and offering a retry
  // would invite the user to press it repeatedly.
  const retryable = props.kind !== 'bad-request' && props.kind !== 'not-found';

  return (
    <div class="stack" role="alert">
      <div class="banner warn">{props.message}</div>

      {props.retryAfterSeconds !== undefined && (
        <p class="hint">{t('state.retryIn', { seconds: props.retryAfterSeconds })}</p>
      )}

      <div class="row">
        {retryable && props.onRetry !== undefined && (
          <button type="button" onClick={props.onRetry}>
            {t('state.retry')}
          </button>
        )}

        {props.savedAt !== undefined && props.onShowSaved !== undefined && (
          <button type="button" onClick={props.onShowSaved}>
            {t('state.showSaved', { date: formatDate(props.savedAt.slice(0, 10)) })}
          </button>
        )}

        {/* Always last, and always present when we know the company: whatever
            else failed, the official record is one click away. */}
        {props.fallbackUrl !== undefined && (
          <a class="button-like" href={props.fallbackUrl} target="_blank" rel="noreferrer">
            {t('state.viewOnRegister')}
          </a>
        )}
      </div>
    </div>
  );
}
