"use client";

import { useState, useEffect } from "react";
import { useMemory } from "@/contexts/MemoryContext";

interface MemoryDialogProps {
  open: boolean;
  onClose: () => void;
  question: string;
  answer: string;
  onSaved?: () => void;
}

export default function MemoryDialog({
  open,
  onClose,
  question,
  answer,
  onSaved,
}: MemoryDialogProps) {
  const {
    collections,
    activeCollectionId,
    loadCollections,
    createCollection,
    saveMemory,
  } = useMemory();

  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadCollections();
      if (activeCollectionId) {
        setSelectedCollectionId(activeCollectionId);
        setIsCreatingNew(false);
      } else if (collections.length > 0) {
        setSelectedCollectionId(collections[0].id);
        setIsCreatingNew(false);
      } else {
        setIsCreatingNew(true);
      }
    }
  }, [open, activeCollectionId, collections.length, loadCollections]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let collectionId = selectedCollectionId;

      // Create new collection if needed
      if (isCreatingNew) {
        if (!newCollectionName.trim()) {
          alert("Bitte geben Sie einen Namen für den Memory ein");
          setSaving(false);
          return;
        }
        const newCollection = await createCollection(newCollectionName.trim());
        if (!newCollection) {
          alert("Fehler beim Erstellen des Memory");
          setSaving(false);
          return;
        }
        collectionId = newCollection.id;
      }

      // Save memory
      const memory = await saveMemory(collectionId, question, answer);
      if (memory) {
        onSaved?.();
        onClose();
      } else {
        alert("Fehler beim Speichern");
      }
    } catch (error) {
      console.error("Error saving:", error);
      alert("Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const questionPreview =
    question.length > 100 ? question.slice(0, 100) + "..." : question;
  const answerPreview =
    answer.length > 200 ? answer.slice(0, 200) + "..." : answer;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700/50 p-6 max-w-2xl w-full mx-4">
        <h2 className="text-xl font-bold text-white mb-4">
          Memory speichern
        </h2>

        {/* Preview */}
        <div className="mb-4 space-y-2">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Frage
            </label>
            <p className="text-sm text-gray-300 bg-gray-900/50 p-2 rounded">
              {questionPreview}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Antwort
            </label>
            <p className="text-sm text-gray-300 bg-gray-900/50 p-2 rounded">
              {answerPreview}
            </p>
          </div>
        </div>

        {/* Collection Selection */}
        <div className="mb-6">
          <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
            Speichern in
          </label>

          {collections.length > 0 && !isCreatingNew ? (
            <>
              <select
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white focus:outline-none focus:border-amber-500"
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setIsCreatingNew(true);
                  setNewCollectionName("");
                }}
                className="mt-2 text-sm text-amber-500 hover:text-amber-400"
              >
                ➕ Neuer Memory
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Name des neuen Memory"
                className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
              />
              {collections.length > 0 && (
                <button
                  onClick={() => {
                    setIsCreatingNew(false);
                    setSelectedCollectionId(collections[0].id);
                  }}
                  className="mt-2 text-sm text-amber-500 hover:text-amber-400"
                >
                  ← Zu bestehendem Memory
                </button>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Speichere...
              </>
            ) : (
              "Speichern"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
