"use client";

import { useState, useEffect, useRef } from "react";
import { useMemory } from "@/contexts/MemoryContext";

interface MemorySelectorProps {
  onViewMemories?: (collectionId: string) => void;
}

export default function MemorySelector({ onViewMemories }: MemorySelectorProps) {
  const {
    collections,
    activeCollectionId,
    setActiveCollection,
    loadCollections,
  } = useMemory();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const activeCollection = collections.find((c) => c.id === activeCollectionId);

  const handleSelectCollection = (id: string | null) => {
    setActiveCollection(id);
    setIsOpen(false);
  };

  const handleViewActive = () => {
    if (activeCollectionId) {
      onViewMemories?.(activeCollectionId);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-amber-400 transition-colors border border-gray-700/50 text-sm"
        title={activeCollection ? activeCollection.name : "Kein Memory"}
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
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        <span className="max-w-[120px] truncate">
          {activeCollection ? activeCollection.name : "Memory"}
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-gray-800 border border-gray-700/50 rounded-lg shadow-xl z-50 py-2">
          {/* Active Collection with View option */}
          {activeCollection && (
            <>
              <button
                onClick={handleViewActive}
                className="w-full px-4 py-2 text-left text-sm text-amber-400 hover:bg-gray-700 flex items-center gap-2"
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                {activeCollection.name} öffnen
              </button>
              <div className="border-t border-gray-700/50 my-2" />
            </>
          )}

          {/* No Memory option */}
          <button
            onClick={() => handleSelectCollection(null)}
            className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-700 ${
              !activeCollectionId ? "text-amber-400" : "text-gray-300"
            }`}
          >
            Kein Memory
          </button>

          {/* Collections List */}
          {collections.length > 0 && (
            <>
              <div className="border-t border-gray-700/50 my-2" />
              <div className="max-h-64 overflow-y-auto">
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={() => handleSelectCollection(collection.id)}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between ${
                      activeCollectionId === collection.id
                        ? "text-amber-400"
                        : "text-gray-300"
                    }`}
                  >
                    <span className="truncate">{collection.name}</span>
                    {activeCollectionId === collection.id && (
                      <svg
                        className="w-4 h-4 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {collections.length === 0 && (
            <p className="px-4 py-2 text-xs text-gray-500 text-center">
              Noch keine Memories vorhanden
            </p>
          )}
        </div>
      )}
    </div>
  );
}
