'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HomePage() {
  const router = useRouter();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hostName, setHostName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = hostName.trim();
    if (!name) {
      setError("Please enter your name");
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch("/api/game/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hostName: name }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to create game.");
      }

      router.push(
        `/lobby/${data.code}?name=${encodeURIComponent(name)}&host=1`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something broke.";
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-20 text-slate-100">
      <main className="w-full max-w-4xl space-y-16">
        <header className="text-center sm:text-left">
          <p className="text-sm uppercase tracking-[0.6em] text-slate-400">
            Phone Tag Labs
          </p>
          <h1 className="mt-6 text-4xl font-black leading-tight text-slate-50 sm:text-6xl">
            Laser tag powered by AI vision.
          </h1>
          <p className="mt-4 text-lg text-slate-300 sm:text-xl">
            Phone Tag Labs uses real-time computer vision to track every hit, every
            player, and every brag-worthy moment. Host a lobby, invite your
            squad, and get ready to duel.
          </p>
          
          {!showCreateForm ? (
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="w-full rounded-full bg-emerald-500 px-8 py-3 text-base font-semibold text-emerald-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:w-auto"
              >
                Make a game
              </button>
              <Link
                href="/join"
                className="w-full rounded-full border border-slate-700/60 px-8 py-3 text-base font-semibold text-slate-200 transition hover:border-slate-500 hover:ring-2 hover:ring-slate-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200 sm:w-auto"
              >
                Join with a code
              </Link>
              <Link
                href="/stream"
                className="w-full rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-8 py-3 text-base font-semibold text-fuchsia-100 transition hover:border-fuchsia-300 hover:bg-fuchsia-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-200 sm:w-auto"
              >
                Join as streamer
              </Link>
            </div>
          ) : (
            <div className="mt-10">
              <form onSubmit={handleCreateGame} className="space-y-6">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                  <label htmlFor="hostName" className="block text-sm font-semibold text-slate-200">
                    Your name
                  </label>
                  <input
                    id="hostName"
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="Laser Captain"
                    className="mt-2 w-full rounded-lg border border-white/20 bg-black/40 px-4 py-3 text-white placeholder-slate-500 transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
                    autoFocus
                  />
                </div>
                
                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="flex-1 rounded-full bg-emerald-500 px-8 py-3 text-base font-semibold text-emerald-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCreating ? "Creating lobby..." : "Create lobby"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setHostName("");
                      setError(null);
                    }}
                    className="rounded-full border border-slate-700/60 px-8 py-3 text-base font-semibold text-slate-200 transition hover:border-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              </form>
              
              {error ? (
                <p className="mt-4 text-sm text-rose-300">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </header>
        <section className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.4em] text-emerald-300">
              Vision
            </p>
            <p className="mt-2 text-base text-slate-200">
              AI-assisted targeting boxes keep every duel fair and every shot
              accounted for.
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.4em] text-sky-300">
              Instant lobbies
            </p>
            <p className="mt-2 text-base text-slate-200">
              Host a match in seconds and share the auto-generated code with
              your crew.
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.4em] text-fuchsia-300">
              Live scoreboard
            </p>
            <p className="mt-2 text-base text-slate-200">
              Watch players join in real time and get ready for the showdown.
            </p>
          </div>
        </section>
        <footer className="text-center text-xs text-slate-500 sm:text-left">
          Prototype built for hackathons. Hardware, computer vision, and battle
          mechanics coming soon.
        </footer>
      </main>
    </div>
  );
}
