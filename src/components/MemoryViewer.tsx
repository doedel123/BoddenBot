"use client";

import { useState, useEffect } from "react";
import { useMemory } from "@/contexts/MemoryContext";
import { SavedMemory } from "@/lib/types";

interface MemoryViewerProps {
  open: boolean;
  onClose: () => void;
  collectionId: string;
}

export default function MemoryViewer({
  open,
  onClose,
  collectionId,
}: MemoryViewerProps) {
  const {
    collections,
    loadMemories,
    deleteMemory,
    deleteCollection,
    renameCollection,
  } = useMemory();

  const [memories, setMemories] = useState<SavedMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const collection = collections.find((c) => c.id === collectionId);

  useEffect(() => {
    if (open && collectionId) {
      loadMemoriesData();
    }
  }, [open, collectionId]);

  useEffect(() => {
    if (collection) {
      setNewName(collection.name);
    }
  }, [collection]);

  const loadMemoriesData = async () => {
    setLoading(true);
    const data = await loadMemories(collectionId);
    setMemories(data);
    setLoading(false);
  };

  const handleDeleteMemory = async (memoryId: string) => {
    if (!confirm("Dieses Memory wirklich löschen?")) return;

    setDeletingId(memoryId);
    const success = await deleteMemory(collectionId, memoryId);
    if (success) {
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    }
    setDeletingId(null);
  };

  const handleDeleteCollection = async () => {
    if (
      !confirm(
        `Memory "${collection?.name}" wirklich löschen? Alle gespeicherten Q&As gehen verloren.`
      )
    )
      return;

    const success = await deleteCollection(collectionId);
    if (success) {
      onClose();
    }
  };

  const handleRename = async () => {
    if (!newName.trim()) return;

    const success = await renameCollection(collectionId, newName.trim());
    if (success) {
      setIsRenaming(false);
    }
  };

  const handleExport = () => {
    const exportData = {
      collection: collection?.name,
      createdAt: collection?.createdAt,
      memories: memories.map((m) => ({
        question: m.userQuestion,
        answer: m.assistantAnswer,
        savedAt: m.createdAt,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${collection?.name || "memory"}_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!open || !collection) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/95 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4 flex-1">
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-amber-500 flex-1"
                  autoFocus
                />
                <button
                  onClick={handleRename}
                  className="px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-500"
                >
                  ✓
                </button>
                <button
                  onClick={() => {
                    setIsRenaming(false);
                    setNewName(collection.name);
                  }}
                  className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white">
                  {collection.name}
                </h1>
                <button
                  onClick={() => setIsRenaming(true)}
                  className="text-sm text-gray-400 hover:text-amber-400"
                >
                  Umbenennen
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-sm flex items-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Exportieren
            </button>
            <button
              onClick={handleDeleteCollection}
              className="px-3 py-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors text-sm"
            >
              Memory löschen
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              ✕ Schließen
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="text-sm text-gray-500 mb-6">
          {memories.length} gespeicherte{" "}
          {memories.length === 1 ? "Frage" : "Fragen"}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12 text-gray-500">
            Lade Memories...
          </div>
        )}

        {/* Empty State */}
        {!loading && memories.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">Noch keine Memories gespeichert</p>
            <p className="text-gray-600 text-sm mt-2">
              Klicken Sie auf das Bookmark-Icon neben einer Antwort zum Speichern
            </p>
          </div>
        )}

        {/* Memories List */}
        {!loading && memories.length > 0 && (
          <div className="space-y-4">
            {memories.map((memory) => (
              <div
                key={memory.id}
                className="bg-gray-800 border border-gray-700/50 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="text-xs text-gray-500">
                    {new Date(memory.createdAt).toLocaleString("de-DE", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <button
                    onClick={() => handleDeleteMemory(memory.id)}
                    disabled={deletingId === memory.id}
                    className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {deletingId === memory.id ? "Lösche..." : "Löschen"}
                  </button>
                </div>

                <details className="group">
                  <summary className="cursor-pointer text-sm text-gray-300 hover:text-white flex items-center gap-2 mb-2">
                    <svg
                      className="w-4 h-4 transition-transform group-open:rotate-90"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span className="font-medium">Frage:</span>
                    <span className="line-clamp-1">
                      {memory.userQuestion}
                    </span>
                  </summary>
                  <div className="ml-6 mt-2 text-sm text-gray-400 whitespace-pre-wrap">
                    {memory.userQuestion}
                  </div>
                </details>

                <details className="group mt-2">
                  <summary className="cursor-pointer text-sm text-gray-300 hover:text-white flex items-center gap-2">
                    <svg
                      className="w-4 h-4 transition-transform group-open:rotate-90"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span className="font-medium">Antwort:</span>
                    <span className="line-clamp-1">
                      {memory.assistantAnswer.slice(0, 100)}...
                    </span>
                  </summary>
                  <div className="ml-6 mt-2 text-sm text-gray-400 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {memory.assistantAnswer}
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
