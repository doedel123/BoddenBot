import { NextRequest, NextResponse } from "next/server";
import { extractText } from "unpdf";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Keine Datei hochgeladen" }, { status: 400 });
    }

    const filename = file.name.toLowerCase();

    if (filename.endsWith(".md") || filename.endsWith(".txt")) {
      const text = await file.text();
      return NextResponse.json({
        filename: file.name,
        content: text,
        type: "text",
      });
    }

    if (filename.endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      const { text, totalPages } = await extractText(new Uint8Array(arrayBuffer));
      const content = Array.isArray(text) ? text.join("\n") : text;
      return NextResponse.json({
        filename: file.name,
        content,
        type: "pdf",
        pages: totalPages,
      });
    }

    return NextResponse.json(
      { error: "Nur PDF und MD/TXT Dateien werden unterstützt" },
      { status: 400 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload fehlgeschlagen";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
