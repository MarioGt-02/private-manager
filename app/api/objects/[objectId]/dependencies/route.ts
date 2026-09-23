import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { objectIdSchema } from "@/lib/archive/schemas";
import { addDependency, DependencyError, getDependencies, removeDependency } from "@/lib/db/dependencies";

export const runtime = "nodejs";

const bodySchema = z.object({ dependsOnObjectId: z.string().trim().min(1).max(200) });

function dependencyError(error: unknown) {
  if (error instanceof DependencyError) {
    switch (error.code) {
      case "SELF_DEPENDENCY": return dataError(400, "SELF_DEPENDENCY", "An Object cannot depend on itself.");
      case "CIRCULAR_DEPENDENCY": return dataError(400, "CIRCULAR_DEPENDENCY", "This would create a circular dependency.");
      case "DEPENDENCY_ARCHIVED": return dataError(400, "DEPENDENCY_ARCHIVED", "Archived Objects cannot be added as dependencies.");
      case "OBJECT_NOT_FOUND": return dataError(404, "OBJECT_NOT_FOUND", "Object not found.");
      case "DEPENDENCY_NOT_FOUND": return dataError(404, "DEPENDENCY_NOT_FOUND", "Dependency Object not found.");
      case "DEPENDENCY_NOT_EXISTS": return dataError(404, "DEPENDENCY_NOT_EXISTS", "Dependency does not exist.");
    }
  }
  return dataError(500, "DATABASE_ERROR", "Could not save the dependency.");
}

export async function GET(_request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  if (!id.success) return dataError(400, "INVALID_REQUEST", "Invalid Object ID.");
  try {
    return NextResponse.json({ dependencies: await getDependencies(id.data) }, { headers: privateHeaders });
  } catch (error) {
    return dependencyError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return dataError(400, "INVALID_REQUEST", "Invalid dependency request.");
  try {
    return NextResponse.json({ dependencies: await addDependency(id.data, input.data.dependsOnObjectId) }, { headers: privateHeaders });
  } catch (error) {
    return dependencyError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return dataError(400, "INVALID_REQUEST", "Invalid dependency request.");
  try {
    return NextResponse.json({ dependencies: await removeDependency(id.data, input.data.dependsOnObjectId) }, { headers: privateHeaders });
  } catch (error) {
    return dependencyError(error);
  }
}
