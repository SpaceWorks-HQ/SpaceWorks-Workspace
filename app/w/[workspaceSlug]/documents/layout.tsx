import { DocumentsNav } from "@/components/documents/DocumentsNav";
export default function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <DocumentsNav />
      {children}
    </div>
  );
}
