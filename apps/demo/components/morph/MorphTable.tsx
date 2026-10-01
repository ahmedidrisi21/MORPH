"use client";
import type { RendererProps } from "morph-react";
import type { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TableProps } from "@/lib/morph/registry";
import { cn } from "@/lib/utils";

export function MorphTable({ props }: RendererProps<z.infer<typeof TableProps>>) {
  return (
    <Card size="sm">
      <CardHeader className="pr-20">
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {props.rows.length === 0 ? (
          <p className="text-sm text-slate-500">{props.emptyText ?? "No rows."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {props.columns.map((c) => (
                  <TableHead key={c.key} className={cn(c.align === "right" && "text-right")}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((r) => (
                <TableRow key={r.id} data-row={r.id}>
                  {props.columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "max-w-[16rem] truncate",
                        c.align === "right" && "text-right tabular-nums",
                      )}
                    >
                      {String(r.cells[c.key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            {props.caption ? <TableCaption>{props.caption}</TableCaption> : null}
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
