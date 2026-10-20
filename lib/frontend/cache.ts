import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "./revalidation";
export const revalidatePath = trackedRevalidation(nextRevalidatePath);
