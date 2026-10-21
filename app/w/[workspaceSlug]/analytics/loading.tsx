import { BrandLoader } from "@/components/brand/BrandLoader";
export default function Loading() {
  return (
    <div role="status" className="p-6">
      <BrandLoader />
      <p>Preparing your report…</p>
    </div>
  );
}
