'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();

    if (!normalizedCode || !trimmedName) {
      setError("Enter a game code and display name.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/game/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: normalizedCode, name: trimmedName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to join game.");
      }

      router.push(
        `/lobby/${normalizedCode}?name=${encodeURIComponent(trimmedName)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something broke.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-20 text-slate-100">
      <main className="w-full max-w-lg rounded-3xl border border-white/5 bg-white/5 p-10 shadow-xl backdrop-blur">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to landing
        </Link>
        <h1 className="mt-6 text-3xl font-bold text-white sm:text-4xl">
          Join a Phone Tag Labs lobby
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Ask the host for the lobby code, enter your callsign, and we will drop
          you straight into the waiting room.
        </p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div>
            <label
              htmlFor="code"
              className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400"
            >
              Game code
            </label>
            <input
              id="code"
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="E.g. X9FQ2"
              autoComplete="off"
              maxLength={5}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-lg uppercase tracking-[0.3em] text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/60"
              required
            />
          </div>
          <div>
            <label
              htmlFor="name"
              className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400"
            >
              Your name
            </label>
            <input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Crewmate alias"
              maxLength={24}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-lg text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/60"
              required
            />
          </div>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-emerald-500 px-8 py-3 text-base font-semibold text-emerald-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Connecting..." : "Join lobby"}
          </button>
        </form>
      </main>
    </div>
  );
}
