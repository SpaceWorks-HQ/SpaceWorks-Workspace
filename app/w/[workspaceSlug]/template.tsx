import { WorkspaceTools } from "@/components/command-palette/WorkspaceTools";
/** Area-owned global tools; leaves the coordinator's layout and chrome intact. */
export default function WorkspaceTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <WorkspaceTools />
      {children}
    </>
  );
}
