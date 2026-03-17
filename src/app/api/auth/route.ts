import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (password === process.env.AUTH_PASSWORD) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { error: "Falsches Passwort" },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: "Authentifizierung fehlgeschlagen" },
      { status: 500 }
    );
  }
}
