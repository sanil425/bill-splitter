export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-between px-6 pt-24 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-emerald-600">SplitIt</h1>
        <p className="mt-3 text-lg text-neutral-600 dark:text-neutral-400">
          Snap the receipt, say who had what, and everyone gets their share.
        </p>
      </div>

      <button
        type="button"
        disabled
        className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        New split
      </button>
    </main>
  );
}
