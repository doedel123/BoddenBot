import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "edge";

// PATCH /api/memories/collections/[collectionId] - Collection umbenennen
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  try {
    const { collectionId } = await params;
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Collection name is required" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    const result = await sql`
      UPDATE memory_collections
      SET name = ${name.trim()}, updated_at = NOW()
      WHERE id = ${collectionId}
      RETURNING id, name, created_at, updated_at
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }

    const collection = result[0];

    return NextResponse.json({
      collection: {
        id: collection.id,
        name: collection.name,
        createdAt: collection.created_at,
        updatedAt: collection.updated_at,
      },
    });
  } catch (error) {
    console.error("Error updating collection:", error);
    return NextResponse.json(
      { error: "Failed to update collection" },
      { status: 500 }
    );
  }
}

// DELETE /api/memories/collections/[collectionId] - Collection löschen
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  try {
    const { collectionId } = await params;
    const sql = neon(process.env.DATABASE_URL!);

    const result = await sql`
      DELETE FROM memory_collections
      WHERE id = ${collectionId}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting collection:", error);
    return NextResponse.json(
      { error: "Failed to delete collection" },
      { status: 500 }
    );
  }
}
