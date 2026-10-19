"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="primary" startIcon={<Printer />} onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
