import { Patch } from "@/components/brand/Patch";
export default function ProjectsLoading() {
  return <div role="status" className="flex flex-col items-center gap-4 py-12"><Patch pose="walk" size={112} /><p>Loading project details…</p></div>;
}
