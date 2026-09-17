import { BoardClient } from "@/components/board/BoardClient";
import { redirect } from "next/navigation";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { getObjects } from "@/lib/db/queries";
import type { ManagedObject } from "@/lib/types/object";

// The board reads from PostgreSQL on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    await requireAuth();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
  let objects: ManagedObject[] = [];
  let error: string | null = null;

  try {
    objects = await getObjects();
  } catch {
    error =
      "Could not load objects from the database. Check DATABASE_URL and run the migrations.";
  }

  return <BoardClient initialObjects={objects} initialError={error} />;
}

