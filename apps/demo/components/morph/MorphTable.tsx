"use client";
import type { RendererProps } from "morph-react";
import type { z } from "zod";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** One cell: a customer gets an avatar, a segment a badge, a signed change a colour. */
function Cell({ column, value }: { column: string; value: string }) {
  if (column === "name" && value) {
    return (
      <span className="flex items-center gap-2.5">
        <Avatar size="sm">
          <AvatarFallback className="bg-accent text-[10px] font-medium text-accent-foreground">
            {initials(value)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate font-medium">{value}</span>
      </span>
    );
  }
  if (column === "segment" && value) return <Badge variant="secondary">{value}</Badge>;
  if (column === "change" && /^[-+−]/.test(value)) {
    return <span className={/^[-−]/.test(value) ? "text-danger" : "text-success"}>{value}</span>;
  }
  return <>{value}</>;
}

export function MorphTable({ props }: RendererProps<z.infer<typeof TableProps>>) {
  return (
    <Card size="sm" className="morph-rise">
      <CardHeader className="pr-20">
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {props.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{props.emptyText ?? "No rows."}</p>
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
                <TableRow
                  key={r.id}
                  data-row={r.id}
                  className="transition-colors hover:bg-accent/50"
                >
                  {props.columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "max-w-[16rem] truncate",
                        c.align === "right" && "text-right tabular-nums",
                      )}
                    >
                      <Cell column={c.key} value={String(r.cells[c.key] ?? "")} />
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
