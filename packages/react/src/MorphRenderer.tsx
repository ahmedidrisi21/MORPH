import type { ComponentInstance } from "@morph/core";
import { type ComponentType, useEffect, useMemo } from "react";
import { type RendererProps, useMorphContext } from "./context";
import { MorphError } from "./MorphError";

export interface MorphRendererProps {
  instance: ComponentInstance;
}

/** Validates props against the registry before rendering; invalid props render MorphError and are traced. */
export function MorphRenderer({ instance }: MorphRendererProps) {
  const { morph, renderers, state } = useMorphContext();
  const result = useMemo(
    () => morph.registry.validateProps(instance.type, instance.props),
    [morph, instance],
  );
  const traceId = state?.traceId ?? "unknown";
  const failure = result.ok ? null : result.error;
  useEffect(() => {
    if (failure)
      morph.emit({ type: "render_error", traceId, componentId: instance.id, error: failure });
  }, [failure, morph, traceId, instance.id]);

  if (!result.ok) return <MorphError id={instance.id} type={instance.type} error={result.error} />;
  const Renderer = renderers[instance.type] as ComponentType<RendererProps<unknown>> | undefined;
  if (!Renderer)
    return <MorphError id={instance.id} type={instance.type} error="No renderer registered." />;
  return <Renderer props={result.props} id={instance.id} instance={instance} />;
}
