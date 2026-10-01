"use client";
import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies the page link (or opens the share sheet where there is one). */
export function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.origin + window.location.pathname;
    try {
      if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "MORPH", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Cancelled share sheet or blocked clipboard: nothing to recover.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={share} className="rounded-full">
      {copied ? <Check /> : <Share2 />}
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}
