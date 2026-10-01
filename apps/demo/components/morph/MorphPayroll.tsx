"use client";
import type { RendererProps } from "@morph/react";
import type { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PayrollProps } from "@/lib/morph/registry";

/** Only visible to roles with read:payroll. The demo user never sees it. */
export function MorphPayroll({ props }: RendererProps<z.infer<typeof PayrollProps>>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-slate-500">Payroll data is restricted.</CardContent>
    </Card>
  );
}
