import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "edge";

// DELETE /api/memories/[collectionId]/[memoryId] - Memory löschen
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; memoryId: string }> }
) {
  try {
    const { collectionId, memoryId } = await params;
    const sql = neon(process.env.DATABASE_URL!);

    const result = await sql`
      DELETE FROM saved_memories
      WHERE id = ${memoryId} AND collection_id = ${collectionId}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    // Update collection's updated_at
    await sql`
      UPDATE memory_collections
      SET updated_at = NOW()
      WHERE id = ${collectionId}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting memory:", error);
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}
