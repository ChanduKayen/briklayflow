/**
 * Material-style indeterminate linear progress bar.
 * Place at the top of a content area while data is loading.
 */
export function LinearProgress({ className = '' }: { className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-valuemin={0}
      aria-valuemax={100}
      className={`bk-linear-progress ${className}`}
    >
      <div className="bk-linear-progress-track" />
    </div>
  );
}
