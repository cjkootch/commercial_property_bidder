"use client";

import { useEffect, useRef, useState, useTransition } from "react";

// Floating chat bubble, two modes:
//  - "buyer": signed-in thread (messages passed from the server component;
//    server action inserts + revalidates, so the list refreshes on send).
//  - "anon": homepage visitors — email + question, replies come by email.
//    Never mints a session (see startChat).
export type ChatMsg = { id: string; sender: string; body: string; at: string };

export function ChatWidget(props: {
  mode: "buyer" | "anon";
  accent?: string;
  messages?: ChatMsg[];
  sendAction?: (formData: FormData) => Promise<void>;
  startAction?: (formData: FormData) => Promise<{ ok: boolean }>;
}) {
  const accent = props.accent ?? "#2f7d4f";
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, props.messages?.length]);

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        aria-label={open ? "Close chat" : "Chat with us"}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition hover:scale-105 print:hidden"
        style={{ backgroundColor: accent }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4.2 3.36A1 1 0 0 1 3 18.58V6Z"
              fill="#fff"
            />
          </svg>
        )}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-50 flex max-h-[70vh] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl print:hidden">
          <div className="px-4 py-3 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
            Questions? We answer fast.
          </div>

          {props.mode === "buyer" ? (
            <>
              <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
                {(props.messages ?? []).length === 0 ? (
                  <p className="p-2 text-center text-xs text-gray-400">
                    Ask about any job, pricing, or your account — replies land here and in your
                    email.
                  </p>
                ) : (
                  (props.messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        m.sender === "buyer"
                          ? "ml-auto text-white"
                          : "bg-gray-100 text-gray-800"
                      }`}
                      style={m.sender === "buyer" ? { backgroundColor: accent } : undefined}
                    >
                      {m.body}
                      <div className={`mt-0.5 text-[10px] ${m.sender === "buyer" ? "text-white/70" : "text-gray-400"}`}>
                        {m.at}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form
                ref={formRef}
                action={(fd) =>
                  startTransition(async () => {
                    await props.sendAction?.(fd);
                    formRef.current?.reset();
                  })
                }
                className="flex gap-2 border-t border-gray-100 p-3"
              >
                <input
                  name="body"
                  required
                  maxLength={2000}
                  placeholder="Type a message…"
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none"
                />
                <button
                  disabled={pending}
                  className="rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: accent }}
                >
                  Send
                </button>
              </form>
            </>
          ) : sent ? (
            <p className="p-5 text-sm text-gray-600">
              Got it — we&apos;ll reply to your email shortly. 🌱
            </p>
          ) : (
            <form
              action={(fd) =>
                startTransition(async () => {
                  const r = await props.startAction?.(fd);
                  if (r?.ok) setSent(true);
                })
              }
              className="space-y-2.5 p-4"
            >
              <p className="text-xs text-gray-500">
                Ask us anything — we reply by email, usually same day.
              </p>
              <input
                type="email"
                name="email"
                required
                placeholder="you@yourcompany.com"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none"
              />
              <textarea
                name="body"
                required
                maxLength={2000}
                rows={3}
                placeholder="Your question…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none"
              />
              <button
                disabled={pending}
                className="w-full rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                {pending ? "Sending…" : "Send"}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </>
  );
}
