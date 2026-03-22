import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "edge";

// GET /api/memories/collections - Alle Collections abrufen
export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    const collections = await sql`
      SELECT id, name, created_at, updated_at
      FROM memory_collections
      ORDER BY created_at DESC
    `;

    return NextResponse.json({
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching collections:", error);
    return NextResponse.json(
      { error: "Failed to fetch collections" },
      { status: 500 }
    );
  }
}

// POST /api/memories/collections - Neue Collection erstellen
export async function POST(request: NextRequest) {
  try {
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
      INSERT INTO memory_collections (name)
      VALUES (${name.trim()})
      RETURNING id, name, created_at, updated_at
    `;

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
    console.error("Error creating collection:", error);
    return NextResponse.json(
      { error: "Failed to create collection" },
      { status: 500 }
    );
  }
}
