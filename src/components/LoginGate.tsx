"use client";

import { useState, useEffect } from "react";

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("auth") === "true") {
      setAuthenticated(true);
    }
    setChecking(false);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.success) {
        sessionStorage.setItem("auth", "true");
        setAuthenticated(true);
      } else {
        setError(data.error || "Falsches Passwort");
      }
    } catch {
      setError("Verbindung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;
  if (authenticated) return <>{children}</>;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm mx-4 p-8 rounded-2xl bg-gray-900 border border-gray-800 shadow-2xl"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-bold text-white text-center mb-1">
          Bodden-Bot
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          Bitte Passwort eingeben
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          autoFocus
          className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700/50 text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 mb-3"
        />

        {error && (
          <p className="text-sm text-red-400 mb-3">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold hover:from-amber-600 hover:to-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {loading ? "Prüfe..." : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
