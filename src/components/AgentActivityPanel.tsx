"use client";

import { SubQuestion, Source } from "@/lib/types";

function SourceBadge({ source }: { source: Source }) {
  const isVector = source.type === "vector_store";
  return (
    <div
      className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
        isVector ? "bg-indigo-950/50 border border-indigo-800/50" : "bg-emerald-950/50 border border-emerald-800/50"
      }`}
    >
      <span className="shrink-0 mt-0.5">
        {isVector ? (
          <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        )}
      </span>
      <div className="min-w-0">
        <div className={`font-medium truncate ${isVector ? "text-indigo-300" : "text-emerald-300"}`}>
          {source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {source.title}
            </a>
          ) : (
            source.title
          )}
        </div>
        {source.snippet && (
          <p className="text-gray-500 mt-0.5 line-clamp-2">{source.snippet}</p>
        )}
      </div>
    </div>
  );
}

function PulsingDot({ color }: { color: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`}
      />
      <span
        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`}
      />
    </span>
  );
}

export default function AgentActivityPanel({
  subQuestions,
  allSources,
  status,
}: {
  subQuestions: SubQuestion[];
  allSources: Source[];
  status: string;
}) {
  if (subQuestions.length === 0 && !status) return null;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Status */}
      {status && (
        <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2">
          <PulsingDot color="bg-amber-400" />
          <span className="text-sm text-amber-300 font-medium">{status}</span>
        </div>
      )}

      {/* Sub-Questions */}
      {subQuestions.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Teilfragen ({subQuestions.filter((sq) => sq.status === "done").length}/{subQuestions.length})
            </h3>
            <div className="space-y-2">
              {subQuestions.map((sq) => (
                <div
                  key={sq.id}
                  className={`p-3 rounded-lg border transition-all duration-300 ${
                    sq.status === "running"
                      ? "border-amber-500/50 bg-amber-950/20 shadow-lg shadow-amber-500/5"
                      : sq.status === "done"
                      ? "border-green-700/50 bg-green-950/20"
                      : sq.status === "error"
                      ? "border-red-700/50 bg-red-950/20"
                      : "border-gray-700/50 bg-gray-800/30"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      {sq.status === "running" && <PulsingDot color="bg-amber-400" />}
                      {sq.status === "done" && (
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {sq.status === "error" && (
                        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      {sq.status === "pending" && (
                        <div className="w-4 h-4 rounded-full border-2 border-gray-600" />
                      )}
                    </div>
                    <p className="text-sm text-gray-300 leading-snug">{sq.question}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sources */}
          {allSources.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-700/50">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Quellen ({allSources.length})
              </h3>
              <div className="space-y-1.5">
                {allSources.map((source, i) => (
                  <SourceBadge key={i} source={source} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
