// Generated from app/w/[workspaceSlug]/chat/[channelSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";


export async function loadgenerateMetadata({ params }: PageProps<"/w/[workspaceSlug]/chat/[channelSlug]">) {
const { channelSlug } = await params;
return { title: `#${decodeURIComponent(channelSlug).slice(0, 80)}` };

}
