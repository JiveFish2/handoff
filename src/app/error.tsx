"use client";

// Shown when the console cannot read the bridge's database. The bridge itself keeps working:
// webhooks wait for Shopify's retries and queued deliveries for QStash's.
export default function ConsoleError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1360px] gap-4 px-4 py-5 sm:px-6">
      <section className="grid gap-3 rounded-[10px] border p-6" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-[21px] font-semibold">The console can&apos;t reach its database right now.</h1>
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--mute)", maxWidth: "62ch" }}>
          Orders are not lost: Shopify keeps retrying its webhooks and the queue keeps retrying deliveries until the
          database answers again. Try again in a minute.
        </p>
        <div>
          <button type="button" className="btn" onClick={reset}>Try again</button>
        </div>
      </section>
    </main>
  );
}
