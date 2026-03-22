const PAGE_INDEX_API_KEY = process.env.PAGE_INDEX_API_KEY;

export async function GET() {
  if (!PAGE_INDEX_API_KEY) {
    return Response.json(
      { error: "PAGE_INDEX_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.pageindex.ai/docs?limit=100", {
      headers: { api_key: PAGE_INDEX_API_KEY },
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `PageIndex API error: ${res.status} ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
