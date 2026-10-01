export interface MorphErrorProps {
  id: string;
  type: string;
  error: string;
}

/** Rendered in place of any component whose props fail validation. Shows no model output. */
export function MorphError({ id, type, error }: MorphErrorProps) {
  return (
    <div
      role="alert"
      data-morph-error={id}
      className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
    >
      <p className="font-medium">This panel could not be shown.</p>
      <p className="mt-1 text-xs text-red-700">
        {type}: {error}
      </p>
    </div>
  );
}
