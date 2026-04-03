"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function SignupSuccessContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const timer = window.setTimeout(() => {
      setCooldownSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  const handleResendVerification = async () => {
    if (!email) {
      setResendError("Email address missing. Please go back and sign up again.");
      setResendSuccess(null);
      return;
    }

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      setResendError(error.message);
      setIsResending(false);
      return;
    }

    setResendSuccess("Verification email resent. Please check your inbox.");
    setCooldownSeconds(30);
    setIsResending(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#0e0c20] text-[#e7e2ff]">
      <section className="w-full max-w-2xl rounded-2xl border border-[#47436c]/30 bg-[#252147]/40 p-8 md:p-10 shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#ff706e] text-[#0e0c20] mb-5">
          <span className="material-symbols-outlined">mark_email_read</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-3">Check your email</h1>
        <p className="text-[#e7e2ff]/80 text-base md:text-lg leading-relaxed mb-7">
          {email
            ? `Success. We sent a verification link to ${email}. Please verify and authorise your account before logging in.`
            : "Success. We sent a verification link. Please verify and authorise your account before logging in."}
        </p>
        {resendError && (
          <p className="mb-4 rounded-lg border border-red-400/50 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            {resendError}
          </p>
        )}
        {resendSuccess && (
          <p className="mb-4 rounded-lg border border-green-400/50 bg-green-900/40 px-4 py-3 text-sm text-green-200">
            {resendSuccess}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={isResending || !email || cooldownSeconds > 0}
            className="inline-flex items-center rounded-full border border-[#ff706e]/60 px-5 py-2.5 font-bold text-[#ff706e] hover:bg-[#ff706e]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResending
              ? "Resending..."
              : cooldownSeconds > 0
              ? `Resend available in ${cooldownSeconds}s`
              : "Resend verification email"}
          </button>
          <Link
            href="/login"
            className="inline-flex items-center rounded-full bg-[#ff706e] text-[#0e0c20] px-5 py-2.5 font-bold hover:opacity-90 transition-opacity"
          >
            Back to login
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function SignupSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center p-6 bg-[#0e0c20] text-[#e7e2ff]">
          <section className="w-full max-w-2xl rounded-2xl border border-[#47436c]/30 bg-[#252147]/40 p-8 md:p-10 shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-3">Check your email</h1>
            <p className="text-[#e7e2ff]/80 text-base md:text-lg leading-relaxed">
              Loading verification details...
            </p>
          </section>
        </main>
      }
    >
      <SignupSuccessContent />
    </Suspense>
  );
}
