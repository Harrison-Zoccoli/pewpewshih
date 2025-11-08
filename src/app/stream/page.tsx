'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function StreamerJoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("Control Booth");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();

    if (!normalizedCode || !trimmedName) {
      setError("Enter a game code and streamer name.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/game/${normalizedCode}/streamer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmedName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to connect as streamer.");
      }

      router.push(
        `/stream/${normalizedCode}?name=${encodeURIComponent(trimmedName)}`,
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
      <main className="w-full max-w-3xl rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-12 shadow-2xl backdrop-blur">
        <Link href="/" className="text-sm text-slate-300 hover:text-white">
          ← Back to landing
        </Link>
        <h1 className="mt-6 text-3xl font-bold text-white sm:text-4xl">
          Stream the Phone Tag Labs showdown
        </h1>
        <p className="mt-2 text-sm text-fuchsia-100/80">
          Connect a single control booth device to showcase the live feed and
          leaderboard. Only one streamer can attach to a lobby at a time.
        </p>
        <form onSubmit={handleSubmit} className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="sm:col-span-1">
            <label
              htmlFor="code"
              className="text-xs font-semibold uppercase tracking-[0.4em] text-fuchsia-200"
            >
              Game code
            </label>
            <input
              id="code"
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="AFMSZ"
              autoComplete="off"
              maxLength={5}
              className="mt-2 w-full rounded-xl border border-fuchsia-500/40 bg-black/40 px-4 py-3 text-lg uppercase tracking-[0.3em] text-white outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-300/60"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label
              htmlFor="name"
              className="text-xs font-semibold uppercase tracking-[0.4em] text-fuchsia-200"
            >
              Streamer name
            </label>
            <input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Control Booth"
              maxLength={32}
              className="mt-2 w-full rounded-xl border border-fuchsia-500/40 bg-black/40 px-4 py-3 text-lg text-white outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-300/60"
              required
            />
          </div>
          {error ? (
            <p className="sm:col-span-2 text-sm text-rose-200">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="sm:col-span-2 mt-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-sky-400 px-8 py-3 text-base font-semibold uppercase tracking-[0.4em] text-slate-950 shadow-lg shadow-fuchsia-500/40 transition hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Connecting..." : "Enter control booth"}
          </button>
        </form>
      </main>
    </div>
  );
}
