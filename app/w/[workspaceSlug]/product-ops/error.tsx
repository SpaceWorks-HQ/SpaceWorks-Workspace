"use client";
import { Button } from "@/components/ui/button";
export default function Error({reset}:{reset:()=>void}){return <div role="alert" className="space-y-4"><h2 className="text-h2">Couldn&apos;t load product tools.</h2><p>Try again to load the saved records.</p><Button onClick={reset}>Try again</Button></div>;}
