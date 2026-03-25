import { openai, VECTOR_STORE_ID } from "@/lib/openai";
import { claudeCreate, claudeStream, CLAUDE_MODEL_PRIMARY, CLAUDE_MODEL_FALLBACK } from "@/lib/claude";
import { SubQuestion, Source } from "@/lib/types";

export const maxDuration = 300;

/**
 * Robust JSON extraction from Claude responses.
 * Handles: pure JSON, code-fenced JSON, JSON with text before/after.
 */
function extractJSON(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();

  // 1) Try direct parse
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  // 2) Try extracting from ```json ... ``` code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // 3) Find first { and match its closing } via bracket counting
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { break; }
      }
    }
  }

  throw new Error(`Could not extract JSON from response: ${trimmed.substring(0, 100)}...`);
}

function log(step: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${step}] ${msg}`, data !== undefined ? data : "");
}

function sendEvent(
  controller: ReadableStreamDefaultController,
  type: string,
  data: unknown
) {
  const payload = JSON.stringify({ type, data });
  controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
}

// ── Step 1: Decompose question using Claude ──────────────────────────
async function decomposeQuestion(
  question: string,
  context: string
): Promise<string[]> {
  log("DECOMPOSE", "Calling Claude for decomposition", { primary: CLAUDE_MODEL_PRIMARY, fallback: CLAUDE_MODEL_FALLBACK });

  const systemPrompt = `Du bist ein juristischer Analyse-Assistent. Deine Aufgabe ist es, juristische Fragen in präzise Teilfragen aufzuteilen, die parallel recherchiert werden können.

WICHTIG: Teile die Frage IMMER auf, wenn sie:
- Mehrere Rechtsbegriffe oder Paragraphen erwähnt (z.B. "§ 32 und § 34" → 2 Teilfragen)
- Verschiedene Rechtsgebiete berührt (z.B. StGB und StPO → separate Teilfragen)
- Einen Vergleich verlangt (→ je eine Teilfrage pro Vergleichsobjekt)
- Mehrere Sätze mit unterschiedlichen Fragen enthält

Regeln:
- Teile in 2-5 Teilfragen auf, wenn die Frage komplex ist
- NUR bei wirklich einfachen Einzelfragen (ein Paragraph, ein Thema) gib eine einzige Frage zurück
- Jede Teilfrage muss eigenständig beantwortbar sein und ausreichend Kontext enthalten
- Antworte NUR mit einem JSON-Objekt: {"questions": ["Frage 1", "Frage 2", ...]}`;

  const userMsg = context
    ? `Kontext aus hochgeladenen Dokumenten:\n${context}\n\nFrage: ${question}`
    : question;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await claudeCreate({
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });

    log("DECOMPOSE", "Claude response OK", {
      model: response.model,
      stop_reason: response.stop_reason,
      blocks: response.content.length,
    });

    const raw =
      response.content.find((b: { type: string }) => b.type === "text")?.text ?? "{}";
    log("DECOMPOSE", "Raw content", raw.substring(0, 200));

    const parsed = extractJSON(raw);
    const questions = parsed.questions || parsed.sub_questions || parsed;
    const result = Array.isArray(questions) ? questions : [question];
    log("DECOMPOSE", `Decomposed into ${result.length} sub-questions`, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("DECOMPOSE", "ERROR", msg);
    throw err;
  }
}

// ── Step 2a-ii: Retrieve from PageIndex (Tree Search) ───────────────
const PAGE_INDEX_API_KEY = process.env.PAGE_INDEX_API_KEY;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TreeNode { title?: string; node_id?: string; page_index?: number; summary?: string; text?: string; nodes?: TreeNode[] }

/** Flatten tree into a compact summary string for the LLM */
function flattenTree(nodes: TreeNode[], depth = 0): string {
  const lines: string[] = [];
  for (const n of nodes) {
    const indent = "  ".repeat(depth);
    const pages = n.page_index ? ` [S.${n.page_index}]` : "";
    const summary = n.summary ? ` — ${n.summary.substring(0, 120)}` : "";
    lines.push(`${indent}- ${n.node_id || "?"}: ${n.title || "Ohne Titel"}${pages}${summary}`);
    if (n.nodes?.length) {
      lines.push(flattenTree(n.nodes, depth + 1));
    }
  }
  return lines.join("\n");
}

/** Step 1: Get document tree structure with summaries */
async function getDocumentTree(docId: string, id: string): Promise<TreeNode[]> {
  log("PAGEINDEX", `[${id}] Fetching tree for ${docId}`);
  const res = await fetch(
    `https://api.pageindex.ai/doc/${docId}/?type=tree&summary=true`,
    { headers: { api_key: PAGE_INDEX_API_KEY! } }
  );
  if (!res.ok) {
    log("PAGEINDEX", `[${id}] Tree fetch failed: ${res.status}`);
    return [];
  }
  const data = await res.json();
  // Tree is in data.result or data directly
  const tree = data.result?.nodes || data.result || data.nodes || [];
  log("PAGEINDEX", `[${id}] Tree fetched, ${Array.isArray(tree) ? tree.length : 0} top-level nodes`);
  return tree;
}

/** Step 2: Use Claude to identify relevant nodes via LLM tree search */
async function findRelevantNodes(
  question: string,
  tree: TreeNode[],
  id: string
): Promise<{ nodeIds: string[]; pageIndices: number[] }> {
  const treeStr = flattenTree(tree);
  // Truncate if tree is very large (keep under ~12k chars for the LLM)
  const truncatedTree = treeStr.length > 12000 ? treeStr.substring(0, 12000) + "\n... (gekürzt)" : treeStr;

  log("PAGEINDEX", `[${id}] LLM tree search, tree size: ${treeStr.length} chars`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await claudeCreate({
    max_tokens: 1024,
    system: `Du analysierst Dokumentstrukturen und findest relevante Abschnitte. Antworte NUR mit JSON.`,
    messages: [{
      role: "user",
      content: `Frage: ${question}\n\nDokument-Struktur:\n${truncatedTree}\n\nWelche Nodes enthalten wahrscheinlich die Antwort? Antworte als JSON:\n{"thinking": "kurze Begründung", "node_list": ["node_id1", "node_id2", ...]}`,
    }],
  });

  const raw = response.content.find((b: { type: string }) => b.type === "text")?.text ?? "{}";

  try {
    const parsed = extractJSON(raw);
    const nodeIds: string[] = (parsed.node_list as string[]) || [];
    log("PAGEINDEX", `[${id}] LLM selected ${nodeIds.length} nodes: ${nodeIds.join(", ")}`);

    // Collect page indices from selected nodes
    const pageIndices = new Set<number>();
    function collectPages(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.node_id && nodeIds.includes(n.node_id) && n.page_index) {
          // Add the page and a few surrounding pages for context
          for (let p = Math.max(1, n.page_index - 1); p <= n.page_index + 2; p++) {
            pageIndices.add(p);
          }
        }
        if (n.nodes) collectPages(n.nodes);
      }
    }
    collectPages(tree);

    return { nodeIds, pageIndices: Array.from(pageIndices).sort((a, b) => a - b).slice(0, 15) };
  } catch {
    log("PAGEINDEX", `[${id}] Failed to parse LLM response`);
    return { nodeIds: [], pageIndices: [] };
  }
}

/** Step 3: Get OCR page content for specific pages */
async function getPageContent(
  docId: string,
  pageIndices: number[],
  id: string
): Promise<string> {
  if (pageIndices.length === 0) return "";

  log("PAGEINDEX", `[${id}] Fetching ${pageIndices.length} pages: ${pageIndices.join(",")}`);
  const res = await fetch(
    `https://api.pageindex.ai/doc/${docId}/?type=ocr&format=page`,
    { headers: { api_key: PAGE_INDEX_API_KEY! } }
  );
  if (!res.ok) {
    log("PAGEINDEX", `[${id}] OCR fetch failed: ${res.status}`);
    return "";
  }

  const data = await res.json();
  const pages = data.result || data.pages || data;

  if (!Array.isArray(pages)) return "";

  // Filter to only requested pages
  const pageSet = new Set(pageIndices);
  const relevant = pages
    .filter((p: { page_index?: number }) => p.page_index && pageSet.has(p.page_index))
    .map((p: { page_index?: number; markdown?: string }) => `[Seite ${p.page_index}]\n${p.markdown || ""}`)
    .join("\n\n---\n\n");

  log("PAGEINDEX", `[${id}] Got ${relevant.length} chars of page content`);
  return relevant;
}

/** Orchestrate the full PageIndex tree search retrieval */
async function retrieveFromPageIndex(
  question: string,
  docId: string,
  id: string
): Promise<{ sources: Source[]; context: string }> {
  log("PAGEINDEX", `[${id}] Starting tree search for doc ${docId}`);
  if (!PAGE_INDEX_API_KEY) {
    log("PAGEINDEX", `[${id}] No API key configured`);
    return { sources: [], context: "" };
  }

  try {
    // Step 1: Get document tree
    const tree = await getDocumentTree(docId, id);
    if (tree.length === 0) {
      return { sources: [], context: "" };
    }

    // Step 2: LLM identifies relevant nodes
    const { nodeIds, pageIndices } = await findRelevantNodes(question, tree, id);
    if (pageIndices.length === 0) {
      log("PAGEINDEX", `[${id}] No relevant pages found`);
      return { sources: [], context: "" };
    }

    // Step 3: Fetch targeted page content
    const pageContent = await getPageContent(docId, pageIndices, id);

    const sources: Source[] = pageIndices.map((p) => ({
      type: "page_index" as const,
      title: `PageIndex S. ${p}`,
      snippet: `Node(s): ${nodeIds.join(", ")}`,
    }));

    log("PAGEINDEX", `[${id}] Tree search complete: ${sources.length} sources, ${pageContent.length} chars context`);
    return { sources, context: pageContent };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("PAGEINDEX", `[${id}] ERROR: ${msg}`);
    return { sources: [], context: "" };
  }
}

// ── Step 2a: Retrieve from OpenAI Vector Store ───────────────────────
async function retrieveFromVectorStore(
  question: string,
  id: string
): Promise<Source[]> {
  log("VECTOR", `[${id}] Calling OpenAI file_search`);
  const sources: Source[] = [];
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-nano",
      input: question,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
      include: ["file_search_call.results"],
    });

    const output = response.output;
    if (output && Array.isArray(output)) {
      for (const item of output) {
        if (
          item.type === "file_search_call" &&
          "results" in item &&
          Array.isArray(item.results)
        ) {
          for (const result of item.results) {
            sources.push({
              type: "vector_store",
              title: result.filename || "Kommentar",
              snippet: result.text?.substring(0, 500),
            });
          }
        }
      }
    }
    log("VECTOR", `[${id}] Got ${sources.length} sources`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("VECTOR", `[${id}] ERROR: ${msg}`);
    // non-fatal – continue without vector store results
  }
  return sources;
}

// ── Step 2b: Answer sub-question with Claude + web search ────────────
async function answerSubQuestion(
  subQ: SubQuestion,
  context: string,
  controller: ReadableStreamDefaultController,
  pageIndexDocId?: string
): Promise<SubQuestion> {
  sendEvent(controller, "sub_question_start", { id: subQ.id });
  log("SUB", `[${subQ.id}] Starting: "${subQ.question.substring(0, 60)}..."`);

  const allSources: Source[] = [];
  let answer = "";

  try {
    // 2a: Retrieve from vector store
    const vsSources = await retrieveFromVectorStore(subQ.question, subQ.id);
    allSources.push(...vsSources);

    const vsContext = vsSources
      .map((s) => `[${s.title}]: ${s.snippet || ""}`)
      .join("\n\n");

    if (vsSources.length > 0) {
      sendEvent(controller, "sub_question_sources", {
        id: subQ.id,
        sources: vsSources,
      });
    }

    // 2a-ii: Retrieve from PageIndex (if document selected)
    let piContext = "";
    if (pageIndexDocId) {
      const piResult = await retrieveFromPageIndex(subQ.question, pageIndexDocId, subQ.id);
      allSources.push(...piResult.sources);
      if (piResult.context) {
        piContext = piResult.context;
      }
      if (piResult.sources.length > 0) {
        sendEvent(controller, "sub_question_sources", {
          id: subQ.id,
          sources: piResult.sources,
        });
      }
    }

    const systemPrompt = `Du bist ein hochqualifizierter juristischer Assistent für deutsches Strafrecht.
Du hast Zugriff auf Websuche für aktuelle Rechtsprechung.

Antworte präzise und fundiert. Zitiere relevante Paragraphen und Kommentarstellen. Nutze Markdown-Formatierung.

${vsContext ? `Ergebnisse aus StGB/StPO-Kommentaren (Vector Store):\n${vsContext}` : ""}
${piContext ? `\nErgebnisse aus PageIndex-Dokumentanalyse:\n${piContext}` : ""}
${context ? `\nKontext aus hochgeladenen Dokumenten:\n${context}` : ""}`;

    log("SUB", `[${subQ.id}] Calling Claude streaming`);

    // 2b: Stream answer from Claude with web search
    const stream = claudeStream({
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: subQ.question }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    let eventCount = 0;
    for await (const event of stream) {
      eventCount++;
      if (event.type === "message_start") {
        log("SUB", `[${subQ.id}] Stream started`);
      }
      if (event.type === "message_stop") {
        log("SUB", `[${subQ.id}] Stream stopped after ${eventCount} events`);
      }
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        answer += event.delta.text;
        sendEvent(controller, "sub_question_delta", {
          id: subQ.id,
          delta: event.delta.text,
        });
      }
    }

    log("SUB", `[${subQ.id}] Stream done, answer length: ${answer.length}`);

    // Extract web search citations
    try {
      const finalMessage = await stream.finalMessage();
      log("SUB", `[${subQ.id}] Final message stop_reason: ${finalMessage.stop_reason}`);
      for (const block of finalMessage.content) {
        if (block.type === "text") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const citations = (block as unknown as { citations?: unknown[] }).citations;
          if (citations) {
            for (const citation of citations) {
              const c = citation as { type?: string; url?: string; title?: string };
              if (c.type === "web_search_result_location" && c.url) {
                allSources.push({
                  type: "web_search",
                  title: c.title || c.url,
                  url: c.url,
                });
              }
            }
          }
        }
      }
    } catch (citErr) {
      log("SUB", `[${subQ.id}] Citation extraction error (non-fatal)`, citErr instanceof Error ? citErr.message : citErr);
    }

    // Deduplicate sources
    const seen = new Set<string>();
    const uniqueSources = allSources.filter((s) => {
      const key = s.type + ":" + s.title + (s.url || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    log("SUB", `[${subQ.id}] Done. Sources: ${uniqueSources.length}`);

    sendEvent(controller, "sub_question_sources", {
      id: subQ.id,
      sources: uniqueSources,
    });
    sendEvent(controller, "sub_question_done", {
      id: subQ.id,
      answer,
    });

    return { ...subQ, status: "done", answer, sources: uniqueSources };
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    log("SUB", `[${subQ.id}] CAUGHT ERROR: ${errMsg}`);
    sendEvent(controller, "sub_question_done", {
      id: subQ.id,
      answer: `**Fehler:** ${errMsg}`,
      error: true,
    });
    return {
      ...subQ,
      status: "error",
      answer: `Fehler: ${errMsg}`,
      sources: allSources,
    };
  }
}

// ── Step 3: Synthesize with Claude ───────────────────────────────────
async function synthesize(
  question: string,
  subResults: SubQuestion[],
  context: string,
  controller: ReadableStreamDefaultController
) {
  log("SYNTH", `Synthesizing ${subResults.length} sub-answers`);
  sendEvent(controller, "synthesis_start", {});

  const resultsText = subResults
    .map(
      (sq) =>
        `### Teilfrage: ${sq.question}\n${sq.answer || "Keine Antwort"}\n`
    )
    .join("\n---\n");

  const systemPrompt = `Du bist ein hochqualifizierter juristischer Assistent für deutsches Strafrecht. Erstelle eine umfassende, strukturierte Synthese der Teilantworten.

Regeln:
- Nutze Markdown-Formatierung (Überschriften, Fettdruck, Listen)
- Strukturiere die Antwort logisch
- Verweise auf relevante Paragraphen (§§)
- Identifiziere Zusammenhänge zwischen den Teilantworten
- Gib eine klare Gesamteinschätzung
${context ? `\nKontext aus hochgeladenen Dokumenten:\n${context}` : ""}`;

  try {
    log("SYNTH", "Calling Claude streaming for synthesis");

    const stream = claudeStream({
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Ursprüngliche Frage: ${question}\n\nTeilantworten:\n${resultsText}\n\nErstelle eine zusammenfassende Analyse.`,
        },
      ],
    });

    let chars = 0;
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        chars += event.delta.text.length;
        sendEvent(controller, "synthesis_delta", { delta: event.delta.text });
      }
    }
    log("SYNTH", `Done. Chars streamed: ${chars}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("SYNTH", `ERROR: ${msg}`);
    sendEvent(controller, "synthesis_delta", {
      delta: `\n\n**Fehler bei Synthese:** ${msg}`,
    });
  }

  sendEvent(controller, "synthesis_done", {});
}

// ── Main handler ─────────────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json();
  const { message, context, pageIndexDocId } = body as {
    message: string;
    context?: string;
    pageIndexDocId?: string;
  };

  log("MAIN", `New request: "${message.substring(0, 80)}"`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Decompose
        sendEvent(controller, "status", { message: "Analysiere die Frage..." });
        const questions = await decomposeQuestion(message, context || "");

        const subQuestions: SubQuestion[] = questions.map((q, i) => ({
          id: `sq-${i}`,
          question: q,
          status: "pending" as const,
          sources: [],
        }));

        sendEvent(controller, "sub_questions", { subQuestions });

        // Step 2: Answer in parallel
        sendEvent(controller, "status", { message: "Bearbeite Teilfragen parallel..." });
        log("MAIN", `Running ${subQuestions.length} sub-questions in parallel`);

        const results = await Promise.all(
          subQuestions.map((sq) =>
            answerSubQuestion(sq, context || "", controller, pageIndexDocId)
          )
        );

        log("MAIN", `All sub-questions done. Errors: ${results.filter(r => r.status === "error").length}`);

        // Step 3: Synthesize
        if (results.length > 1) {
          sendEvent(controller, "status", { message: "Erstelle Gesamtanalyse..." });
          await synthesize(message, results, context || "", controller);
        } else {
          sendEvent(controller, "synthesis_done", { single: true });
        }

        log("MAIN", "Request completed successfully");
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Unbekannter Fehler";
        log("MAIN", `TOP-LEVEL ERROR: ${errMsg}`);
        sendEvent(controller, "error", { message: errMsg });
      } finally {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
